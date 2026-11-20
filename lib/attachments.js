/* Ekler: kaydetme, sunma, metin çıkarma önbelleği, sahipsiz ek temizliği */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { ATT_DIR, INLINE_TYPES, ORPHAN_AGE_MS, SAFE_ID } = require("./config");
const { getDb, readKindFull } = require("./db");
const { extract, VERSION: EXTRACT_VERSION } = require("./extract");
const { writeFileAtomic } = require("./fs-util");
const { send } = require("./http-util");

/* ---------- Ekler ---------- */
/* Dosyanın kendisi diskte (data/attachments/<id>), bilgileri veritabanında (attachments tablosu) */
/* Ek kullanan türler (sahipsiz ek temizliği bunlara bakar) */
const ATT_KINDS = ["tasks", "archive", "projectNotes"];   // projectNotes: ekler + html içindeki resimler
function attPath(id){ return path.join(ATT_DIR, id); }

function saveAttachment(buf, rawName, rawType){
  let name = "dosya";
  try{ name = decodeURIComponent(rawName || "") || "dosya"; }catch(e){}
  name = name.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").slice(0, 200);
  const type = /^[\w.+-]+\/[\w.+-]+$/.test(rawType || "") ? rawType.toLowerCase() : "application/octet-stream";
  const id = "a" + crypto.randomBytes(10).toString("hex");
  const meta = { id, name, type, size: buf.length, uploadedAt: new Date().toISOString() };
  writeFileAtomic(attPath(id), buf);
  getDb().prepare("INSERT INTO attachments(id, name, type, size, uploaded_at) VALUES (?, ?, ?, ?, ?)").run(id, name, type, meta.size, meta.uploadedAt);
  return meta;
}

function serveAttachment(res, id){
  if(!SAFE_ID.test(id)) return send(res, 400, { error: "Geçersiz ek kimliği" });
  const meta = getDb().prepare("SELECT name, type FROM attachments WHERE id = ?").get(id);
  if(!meta) return send(res, 404, { error: "Ek bulunamadı" });
  fs.readFile(attPath(id), (err, buf) => {
    if(err) return send(res, 404, { error: "Ek bulunamadı" });
    const inline = INLINE_TYPES.has(meta.type);
    const fname = String(meta.name || "dosya");
    const ascii = fname.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'");
    res.writeHead(200, {
      "Content-Type": inline ? meta.type : "application/octet-stream",
      "Content-Disposition": (inline ? "inline" : "attachment") + '; filename="' + ascii + '"; filename*=UTF-8\'\'' + encodeURIComponent(fname),
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      "Cache-Control": "private, max-age=31536000, immutable"
    });
    res.end(buf);
  });
}

/* Ekten çıkarılmış metin (LLM için). Sonuç att_text tablosunda önbelleğe alınır; status "v<sürüm>:<durum>" biçimindedir,
   böylece çıkarma algoritması değişince (EXTRACT_VERSION) eski sonuçlar yeniden hesaplanır.
   Durum ok/partial ise text metnin kendisi, değilse okunamama nedenidir. */
function attText(id){
  if(!SAFE_ID.test(id)) return { status: "none", text: "", reason: "Geçersiz ek kimliği" };
  const row = getDb().prepare("SELECT text, status FROM att_text WHERE id = ?").get(id);
  const pre = "v" + EXTRACT_VERSION + ":";
  if(row && row.status.startsWith(pre)){
    const st = row.status.slice(pre.length), good = st === "ok" || st === "partial";
    return { status: st, text: good ? row.text : "", reason: good ? "" : row.text };
  }
  const meta = getDb().prepare("SELECT name, type FROM attachments WHERE id = ?").get(id);
  if(!meta) return { status: "none", text: "", reason: "Ek bulunamadı" };
  let buf;
  try{ buf = fs.readFileSync(attPath(id)); }catch(e){ return { status: "none", text: "", reason: "Ek dosyası bulunamadı" }; }
  const r = extract(buf, meta.name, meta.type);
  const good = r.status === "ok" || r.status === "partial";
  getDb().prepare("INSERT INTO att_text(id, text, status, extracted_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET text = excluded.text, status = excluded.status, extracted_at = excluded.extracted_at")
    .run(id, good ? r.text : (r.reason || ""), pre + r.status, new Date().toISOString());
  return r;
}

/* Hiçbir kaydın kullanmadığı ve 1 günden eski ekleri (dosya + veritabanı satırı) siler.
   Bir tür okunamazsa hiçbir şey silinmez: bozuk veri yüzünden ek kaybetmeyelim. */
function cleanupOrphanAttachments(){
  const used = new Set();
  for(const k of ATT_KINDS){
    readKindFull(k).items.forEach(t => {   // hata fırlatırsa temizlik tümüyle atlanır
      if(!t || typeof t !== "object") return;
      if(Array.isArray(t.attachments)) t.attachments.forEach(a => { if(a && typeof a.id === "string") used.add(a.id); });
      ["descriptionHtml", "html"].forEach(f => {
        const html = typeof t[f] === "string" ? t[f] : "";
        html.replace(/\/api\/attachments\/([\w-]+)/g, (_, id) => { used.add(id); return ""; });
      });
    });
  }
  const now = Date.now();
  const delRow = getDb().prepare("DELETE FROM attachments WHERE id = ?"), delText = getDb().prepare("DELETE FROM att_text WHERE id = ?");
  let removed = 0;
  fs.readdirSync(ATT_DIR).forEach(n => {
    const id = n.replace(/\.tmp-\d+$/, "");
    if(used.has(id) || n.endsWith(".json")) return;
    const p = path.join(ATT_DIR, n);
    try{
      if(now - fs.statSync(p).mtimeMs < ORPHAN_AGE_MS) return;
      fs.unlinkSync(p);
      if(id === n){ delRow.run(id); delText.run(id); removed++; }
    }catch(e){}
  });
  /* Dosyası olmayan ve kullanılmayan satırlar */
  getDb().prepare("SELECT id FROM attachments").all().forEach(r => {
    if(!used.has(r.id) && !fs.existsSync(attPath(r.id))){ delRow.run(r.id); delText.run(r.id); }
  });
  if(removed) console.log("Kullanılmayan " + removed + " ek silindi.");
}

module.exports = { cleanupOrphanAttachments, saveAttachment, serveAttachment, attText };
