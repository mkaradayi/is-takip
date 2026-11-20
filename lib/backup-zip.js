/* Tam yedek (.zip): veritabanı + ekler tek dosyada. Bağımlılıksız ZIP yazıcı/okuyucu (zlib), indirme ve geri yükleme. */
"use strict";
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { ATT_DIR, BACKUP_DIR, KINDS, SAFE_ID, TMP_DIR } = require("./config");
const { closeStorage, dbInfo, pruneBackups, snapshotDb, stamp, startStorage, DB_FILE, DB_VERSION } = require("./db");
const { renameWithRetry } = require("./fs-util");

const FORMAT = 1;
const U32 = 0xFFFFFFFF;

/* ---------- ZIP yazıcı ---------- */
function dosTime(d){
  return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
}
/* Akışa yazar; geri basınç (drain) beklenir */
/* Akış dolarsa "drain" beklenir; bağlantı kapanır ya da hata olursa reddeder (indirme yarıda kesilince askıda kalmasın) */
function writeChunk(out, buf){
  if(out.destroyed) return Promise.reject(new Error("bağlantı kapandı"));
  if(out.write(buf)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const off = () => { out.removeListener("drain", ok); out.removeListener("close", fail); out.removeListener("error", fail); };
    const ok = () => { off(); resolve(); };
    const fail = e => { off(); reject(e instanceof Error ? e : new Error("bağlantı kapandı")); };
    out.once("drain", ok); out.once("close", fail); out.once("error", fail);
  });
}
/* entries: [{ name, data?: Buffer, file?: yol, store?: true }]. Her girdi sırayla okunur (bellek: en büyük dosya kadar).
   ZIP64 yok: dosya ya da toplam 4 GB'ı, girdi sayısı 65535'i aşarsa hata. Adlar UTF-8 (bayrak 0x0800). */
async function writeZip(out, entries){
  if(entries.length > 0xFFFF) throw new Error("Yedekte çok fazla dosya var (" + entries.length + ")");
  const { time, date } = dosTime(new Date());
  const central = [];
  let offset = 0;
  for(const e of entries){
    const raw = e.data || fs.readFileSync(e.file);
    const crc = zlib.crc32(raw) >>> 0;
    let method = 0, body = raw;
    if(!e.store && raw.length > 64){
      const def = zlib.deflateRawSync(raw, { level: 6 });
      if(def.length < raw.length){ method = 8; body = def; }
    }
    if(raw.length >= U32 || offset + body.length >= U32) throw new Error("Yedek 4 GB sınırını aşıyor");
    const name = Buffer.from(e.name, "utf8");
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(method, 8);
    lh.writeUInt16LE(time, 10); lh.writeUInt16LE(date, 12); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    await writeChunk(out, Buffer.concat([lh, name]));
    await writeChunk(out, body);
    central.push({ name, method, crc, csize: body.length, usize: raw.length, offset });
    offset += 30 + name.length + body.length;
  }
  const cdStart = offset;
  for(const c of central){
    const h = Buffer.alloc(46);
    h.writeUInt32LE(0x02014b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(20, 6); h.writeUInt16LE(0x0800, 8); h.writeUInt16LE(c.method, 10);
    h.writeUInt16LE(time, 12); h.writeUInt16LE(date, 14); h.writeUInt32LE(c.crc, 16); h.writeUInt32LE(c.csize, 20); h.writeUInt32LE(c.usize, 24);
    h.writeUInt16LE(c.name.length, 28); h.writeUInt32LE(c.offset, 42);
    await writeChunk(out, Buffer.concat([h, c.name]));
    offset += 46 + c.name.length;
  }
  if(offset >= U32) throw new Error("Yedek 4 GB sınırını aşıyor");
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(central.length, 8); eocd.writeUInt16LE(central.length, 10);
  eocd.writeUInt32LE(offset - cdStart, 12); eocd.writeUInt32LE(cdStart, 16);
  await writeChunk(out, eocd);
}

/* ---------- ZIP okuyucu ---------- */
/* Merkezi dizini okur; her girdi için read() açılmış veriyi verir (CRC ve boyut denetimli).
   maxTotal: açılmış toplam boyut sınırı (ZIP bombası). Şifreli ya da 0/8 dışı yöntem reddedilir. */
function readZip(buf, opts){
  const maxTotal = (opts && opts.maxTotal) || 2 * 1024 * 1024 * 1024;
  const bad = msg => Object.assign(new Error("Geçersiz yedek dosyası: " + msg), { status: 400 });
  if(buf.length < 22) throw bad("ZIP değil");
  let eocd = -1;
  for(let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xFFFF); i--){ if(buf.readUInt32LE(i) === 0x06054b50){ eocd = i; break; } }
  if(eocd < 0) throw bad("ZIP değil");
  const count = buf.readUInt16LE(eocd + 10), cdSize = buf.readUInt32LE(eocd + 12), cdOff = buf.readUInt32LE(eocd + 16);
  if(cdOff + cdSize > eocd) throw bad("merkezi dizin bozuk");
  const entries = []; let p = cdOff, total = 0;
  for(let i = 0; i < count; i++){
    if(p + 46 > eocd || buf.readUInt32LE(p) !== 0x02014b50) throw bad("merkezi dizin bozuk");
    const flags = buf.readUInt16LE(p + 8), method = buf.readUInt16LE(p + 10), crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), lho = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nl);
    if(flags & 1) throw bad("şifreli dosya desteklenmiyor");
    if(method !== 0 && method !== 8) throw bad("desteklenmeyen sıkıştırma (" + method + ")");
    total += usize;
    if(total > maxTotal) throw bad("açılmış boyut çok büyük");
    entries.push({ name, method, crc, csize, usize, lho });
    p += 46 + nl + xl + cl;
  }
  entries.forEach(e => {
    e.read = () => {
      if(e.lho + 30 > buf.length || buf.readUInt32LE(e.lho) !== 0x04034b50) throw bad(e.name + " yerel başlığı bozuk");
      const start = e.lho + 30 + buf.readUInt16LE(e.lho + 26) + buf.readUInt16LE(e.lho + 28);
      if(start + e.csize > buf.length) throw bad(e.name + " eksik");
      const data = buf.subarray(start, start + e.csize);
      let out;
      if(e.method === 0) out = data;
      else{
        try{ out = zlib.inflateRawSync(data, { maxOutputLength: Math.max(1, e.usize) }); }
        catch(err){ throw bad(e.name + " açılamadı"); }
      }
      if(out.length !== e.usize || (zlib.crc32(out) >>> 0) !== e.crc) throw bad(e.name + " bozuk (CRC)");
      return out;
    };
  });
  return entries;
}

/* ---------- Yedek içeriği ---------- */
function stampName(){
  const d = new Date(), pad = n => String(n).padStart(2, "0");
  return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + "-" + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
}
function attachmentFiles(){
  return fs.readdirSync(ATT_DIR).filter(n => SAFE_ID.test(n) && fs.statSync(path.join(ATT_DIR, n)).isFile());
}
/* Yedek ZIP'ini akışa yazar: manifest (store; istemci açmadan okur), veritabanının tutarlı kopyası, ekler.
   Model ayarları (ai-models.json) ve .env dahil değildir (API anahtarları). */
async function writeBackup(out){
  const snap = snapshotDb();
  try{
    const atts = attachmentFiles();
    const info = dbInfo();
    const manifest = { app: "is-takip", format: FORMAT, createdAt: new Date().toISOString(), dbVersion: info.dbVersion,
      counts: info.counts, attachments: atts.length };
    await writeZip(out, [{ name: "manifest.json", data: Buffer.from(JSON.stringify(manifest, null, 2), "utf8"), store: true },
      { name: "is-takip.db", file: snap }].concat(atts.map(n => ({ name: "attachments/" + n, file: path.join(ATT_DIR, n) }))));
    return manifest;
  }finally{ try{ fs.unlinkSync(snap); }catch(e){} }
}
/* İndirme rotası: GET /api/backup/download */
async function sendBackup(res){
  res.writeHead(200, {
    "Content-Type": "application/zip",
    "Content-Disposition": 'attachment; filename="is-takip-yedek-' + stampName() + '.zip"',
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  try{ await writeBackup(res); res.end(); }
  catch(e){ console.error("Yedek ZIP'i oluşturulamadı:", e.message); res.destroy(e); }
}
/* ---------- Geri yükleme ---------- */
let busy = false;   // aynı anda tek geri yükleme
const bad = msg => Object.assign(new Error(msg), { status: 400 });

/* Yüklenen ZIP'i hiçbir şeye dokunmadan doğrular ve dir altına açar → { manifest, dbFile, attDir, attCount } */
function extractAndValidate(buf, dir){
  const entries = readZip(buf, { maxTotal: 4 * 1024 * 1024 * 1024 });
  let man = null, dbe = null; const atts = [], seen = new Set();
  for(const e of entries){
    if(seen.has(e.name)) throw bad("Geçersiz yedek dosyası: aynı adla iki girdi (" + e.name + ")");
    seen.add(e.name);
    if(e.name === "manifest.json") man = e;
    else if(e.name === "is-takip.db") dbe = e;
    else if(e.name === "attachments/" && e.usize === 0) continue;                       // klasör girdisi (elle sıkıştırılmış ZIP)
    else if(/^attachments\/[\w-]{1,64}$/.test(e.name)) atts.push(e);
    else throw bad("Geçersiz yedek dosyası: beklenmeyen girdi \"" + e.name.slice(0, 80) + "\"");   // yol kaçışı (../), alt klasör vb.
  }
  if(!man || !dbe) throw bad("Bu bir İş Takip yedeği değil (manifest.json ya da is-takip.db yok).");
  let manifest;
  try{ manifest = JSON.parse(man.read().toString("utf8")); }catch(e){ if(e.status) throw e; throw bad("Yedeğin manifest.json dosyası okunamadı."); }
  if(!manifest || manifest.app !== "is-takip") throw bad("Bu bir İş Takip yedeği değil.");
  if(!(manifest.format >= 1 && manifest.format <= FORMAT)) throw bad("Bu yedek uygulamanın daha yeni bir sürümüyle alınmış (biçim " + manifest.format + ").");

  fs.mkdirSync(path.join(dir, "attachments"), { recursive: true });
  const dbFile = path.join(dir, "is-takip.db");
  fs.writeFileSync(dbFile, dbe.read());
  validateDb(dbFile);
  atts.forEach(e => fs.writeFileSync(path.join(dir, e.name), e.read()));   // ad deseni yukarıda doğrulandı
  return { manifest, dbFile, attDir: path.join(dir, "attachments"), attCount: atts.length };
}
/* Veritabanı dosyası gerçekten bu uygulamanın ve sağlam mı? (açıp kapatır; Windows'ta dosya kilidi kalmasın) */
function validateDb(file){
  const { DatabaseSync } = require("node:sqlite");
  let d;
  try{ d = new DatabaseSync(file, { readOnly: true }); }
  catch(e){ throw bad("Yedekteki veritabanı açılamadı."); }
  try{
    let chk;
    try{ chk = d.prepare("PRAGMA quick_check").get(); }catch(e){ throw bad("Yedekteki veritabanı bozuk ya da SQLite değil."); }
    if(!chk || Object.values(chk)[0] !== "ok") throw bad("Yedekteki veritabanı bozuk.");
    const v = d.prepare("PRAGMA user_version").get().user_version;
    if(v > DB_VERSION) throw bad("Yedek uygulamanın daha yeni bir sürümüyle alınmış (şema " + v + ").");
    const tables = new Set(d.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(r => r.name));
    if(!tables.has("meta") || !tables.has("items")) throw bad("Yedekteki veritabanı bu uygulamaya ait değil.");
    for(const r of d.prepare("SELECT kind, data FROM items").iterate()){
      if(!KINDS.includes(r.kind)) throw bad("Yedekte bilinmeyen kayıt türü: " + String(r.kind).slice(0, 40));
      let o; try{ o = JSON.parse(r.data); }catch(e){ o = null; }
      if(!o || typeof o !== "object" || Array.isArray(o)) throw bad("Yedekteki bir " + r.kind + " kaydı bozuk.");
    }
  }finally{ d.close(); }
}
/* Mevcut durumun tam yedeğini dosyaya yazar (backup/geri-yukleme-oncesi-<zaman>.zip); tek yedek kuralıyla diğer yedekler silinir */
async function preRestoreBackup(){
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const f = path.join(BACKUP_DIR, "geri-yukleme-oncesi-" + stamp() + ".zip");
  const tmp = f + ".part";
  const out = fs.createWriteStream(tmp);
  try{
    await writeBackup(out);
    await new Promise((res, rej) => { out.once("error", rej); out.end(res); });
  }catch(e){ out.destroy(); try{ fs.unlinkSync(tmp); }catch(_){} throw e; }
  renameWithRetry(tmp, f);
  pruneBackups(f);
  return f;
}
/* Veritabanı ve ek klasörünü yenileriyle değiştirir. Herhangi bir adım başarısız olursa eski dosyalar geri taşınır
   ve veritabanı yeniden açılır (veri kaybı yok). Bu sırada gelen /api/* istekleri 503 alır (getDb() null). */
function swapIn(newDb, newAtt){
  const tag = ".old-" + stamp();
  const oldDb = DB_FILE + tag, oldAtt = ATT_DIR + tag;
  const s = { db: false, newDb: false, att: false, newAtt: false };
  closeStorage();
  try{
    if(fs.existsSync(DB_FILE + "-journal")) throw new Error("veritabanı günlük dosyası (-journal) duruyor");
    if(fs.existsSync(DB_FILE)){ renameWithRetry(DB_FILE, oldDb); s.db = true; }
    renameWithRetry(newDb, DB_FILE); s.newDb = true;
    if(fs.existsSync(ATT_DIR)){ renameWithRetry(ATT_DIR, oldAtt); s.att = true; }
    renameWithRetry(newAtt, ATT_DIR); s.newAtt = true;
    startStorage();
  }catch(e){
    console.error("Geri yükleme başarısız, eski veri geri alınıyor:", e.message);
    closeStorage();
    try{
      if(s.newAtt) renameWithRetry(ATT_DIR, newAtt);
      if(s.att) renameWithRetry(oldAtt, ATT_DIR);
      if(s.newDb) fs.rmSync(DB_FILE, { force: true });
      if(s.db) renameWithRetry(oldDb, DB_FILE);
    }finally{
      fs.mkdirSync(ATT_DIR, { recursive: true });
      startStorage();
    }
    const why = ["EPERM", "EBUSY", "EACCES"].includes(e.code) ? "veri klasöründeki bir dosya kullanımda (" + e.code + "). Açık olan ek dosyalarını kapatıp tekrar deneyin." : e.message;
    throw Object.assign(new Error("Geri yükleme yapılamadı, mevcut veri korundu: " + why), { status: 500 });
  }
  fs.rmSync(oldDb, { force: true });
  try{ fs.rmSync(oldAtt, { recursive: true, force: true }); }catch(e){ console.warn("Uyarı: eski ek klasörü silinemedi: " + oldAtt); }
}
/* POST /api/backup/restore: ham .zip gövdesi → doğrula → öncesini yedekle → değiştir */
async function restoreBackup(buf){
  if(busy) throw Object.assign(new Error("Başka bir geri yükleme sürüyor"), { status: 409 });
  busy = true;
  const dir = path.join(TMP_DIR, "restore-" + stamp() + "-" + process.hrtime.bigint());
  try{
    const x = extractAndValidate(buf, dir);
    const pre = await preRestoreBackup();
    swapIn(x.dbFile, x.attDir);
    const info = dbInfo();
    console.log("Yedekten geri yüklendi (" + (x.manifest.createdAt || "?") + "): " + Object.keys(info.counts).map(k => info.counts[k] + " " + k).join(", ") + ", " + x.attCount + " ek. Öncesi: " + pre);
    return { ok: true, createdAt: String(x.manifest.createdAt || ""), counts: info.counts, attachments: x.attCount, preRestore: path.relative(path.dirname(BACKUP_DIR), pre).replace(/\\/g, "/") };
  }finally{
    busy = false;
    try{ fs.rmSync(dir, { recursive: true, force: true }); }catch(e){}
  }
}

/* Açılışta: yarım kalmış geçici dosyaları temizler */
function cleanupTmp(){
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
}

module.exports = { writeZip, readZip, writeBackup, sendBackup, restoreBackup, cleanupTmp, stampName, FORMAT };
