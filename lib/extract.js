/* İş Takip — eklerden metin çıkarma (LLM'e vermek için). Bağımlılık yok: yalnızca Node'un yerleşik zlib'i.
   extract(buf, name, type) → { status, text, reason }
     status: "ok" (okunabilir) | "partial" (kısmen okunabilir) | "none" (metin bulunamadı / okunamadı) | "unsupported" (desteklenmeyen tür)
   Desteklenen: txt/md/csv/tsv/json/log/xml, html, eml, docx, pdf (yalnızca metin katmanı olanlar, en iyi çaba). */
"use strict";
const zlib = require("zlib");

const MAX_CHARS = 200000;   // dosya başına en fazla bu kadar karakter saklanır
const VERSION = 1;          // algoritma değişirse artırılır; önbellekteki eski sonuçlar yeniden çıkarılır

/* ---------- Yardımcılar ---------- */
function ext(name){ const m = /\.([a-z0-9]+)$/i.exec(name || ""); return m ? m[1].toLowerCase() : ""; }
function tidy(s){
  return String(s).replace(/\r\n?/g, "\n").replace(/[\t\f\v ]+\n/g, "\n").replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n").replace(/[\u0000-\u0008\u000b\u000e-\u001f]/g, "").trim();
}
function decodeBytes(buf, charset){
  charset = String(charset || "").toLowerCase().replace(/^"|"$/g, "");
  if(buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) return buf.slice(3).toString("utf8");
  if(buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) return buf.slice(2).toString("utf16le");
  if(charset && !/utf-?8/.test(charset)){
    try{ return new TextDecoder(charset === "iso-8859-9" || charset === "latin5" ? "windows-1254" : charset).decode(buf); }catch(e){}
  }
  const u = buf.toString("utf8");
  /* Geçersiz UTF-8 baytları "�" olur: fazlaysa dosya büyük olasılıkla Windows-1254 (Türkçe ANSI) */
  const bad = (u.match(/�/g) || []).length;
  if(bad > 0 && bad > u.length / 200){ try{ return new TextDecoder("windows-1254").decode(buf); }catch(e){} }
  return u;
}
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ccedil: "ç", Ccedil: "Ç", ouml: "ö", Ouml: "Ö", uuml: "ü", Uuml: "Ü", hellip: "…", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", bull: "•" };
function decodeEntities(s){
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if(e[0] === "#"){ const c = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); try{ return String.fromCodePoint(c); }catch(_){ return m; } }
    return ENT[e] != null ? ENT[e] : m;
  });
}
function htmlToText(html){
  return decodeEntities(String(html)
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|tr|h[1-6]|table|blockquote)>/gi, "\n").replace(/<(td|th)[^>]*>/gi, "\t")
    .replace(/<li[^>]*>/gi, "• ").replace(/<[^>]+>/g, ""));
}
/* Okunabilirlik: harf/rakam/boşluk/noktalama oranı */
function quality(text){
  if(!text) return 0;
  const sample = text.slice(0, 20000);
  const good = (sample.match(/[\p{L}\p{N}\s.,;:!?()\-–—'"%/&@#*+=\[\]{}<>«»“”‘’…•]/gu) || []).length;
  return good / sample.length;
}
function result(text, kind){
  text = tidy(text);
  if(text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS) + "\n[… metin kısaltıldı]";
  if(!text) return { status: "none", text: "", reason: kind === "pdf" ? "PDF'te metin katmanı bulunamadı (taranmış belge olabilir)" : "Metin bulunamadı" };
  const q = quality(text);
  if(q < 0.6) return { status: "none", text: "", reason: kind === "pdf" ? "PDF metni çözülemedi (özel yazı tipi ya da taranmış belge)" : "Metin okunamadı" };
  if(q < 0.88 || (kind === "pdf" && text.length < 40)) return { status: "partial", text, reason: "Metnin bir kısmı okunamadı" };
  return { status: "ok", text, reason: "" };
}

/* ---------- EML (MIME) ---------- */
function qpDecode(s){
  const bytes = []; s = s.replace(/=\r?\n/g, "");
  for(let i = 0; i < s.length; i++){
    if(s[i] === "=" && /^[0-9A-F]{2}$/i.test(s.substr(i + 1, 2))){ bytes.push(parseInt(s.substr(i + 1, 2), 16)); i += 2; }
    else{ const b = Buffer.from(s[i], "latin1"); bytes.push(b[0]); }
  }
  return Buffer.from(bytes);
}
/* RFC 2047: =?charset?B|Q?...?= parçaları. Ardışık parçalar arasındaki boşluk yok sayılır ve aynı karakter
   setindeki parçaların baytları birleştirilip öyle çözülür (çok baytlı harf iki parçaya bölünmüş olabilir). */
function decodeHeaderWords(v){
  v = String(v || "");
  const re = /=\?([^?]+)\?([bq])\?([^?]*)\?=/gi;
  let out = "", last = 0, run = null, m;
  const flushRun = () => { if(run){ out += decodeBytes(Buffer.concat(run.bufs), run.cs); run = null; } };
  while((m = re.exec(v))){
    const between = v.slice(last, m.index);
    if(!(run && /^\s*$/.test(between))){ flushRun(); out += between; }
    let buf;
    try{ buf = m[2].toLowerCase() === "b" ? Buffer.from(m[3], "base64") : qpDecode(m[3].replace(/_/g, " ")); }catch(e){ buf = Buffer.from(m[0]); }
    const cs = m[1].toLowerCase();
    if(run && run.cs === cs) run.bufs.push(buf); else { flushRun(); run = { cs, bufs: [buf] }; }
    last = re.lastIndex;
  }
  flushRun();
  return out + v.slice(last);
}
function parseHeaders(block){
  const h = {};
  block.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/).forEach(line => {
    const i = line.indexOf(":"); if(i > 0) h[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  });
  return h;
}
function param(v, name){ const m = new RegExp(name + '\\s*=\\s*"?([^";]+)"?', "i").exec(v || ""); return m ? m[1] : ""; }
/* MIME parçasını özyinelemeli gezer; düz metin varsa onu, yoksa html'den türetilmiş metni toplar */
function walkMime(raw, out, depth){
  if(depth > 8) return;
  const sep = raw.search(/\r?\n\r?\n/);
  const head = parseHeaders(sep < 0 ? raw : raw.slice(0, sep));
  const body = sep < 0 ? "" : raw.slice(sep).replace(/^\r?\n\r?\n/, "");
  const ctype = (head["content-type"] || "text/plain").toLowerCase();
  if(ctype.startsWith("multipart/")){
    const b = param(head["content-type"], "boundary"); if(!b) return;
    raw.split("--" + b).slice(1).forEach(part => { if(!part.startsWith("--")) walkMime(part.replace(/^\r?\n/, ""), out, depth + 1); });
    return;
  }
  if(/attachment/i.test(head["content-disposition"] || "") || !ctype.startsWith("text/")) return;
  const enc = (head["content-transfer-encoding"] || "").toLowerCase();
  const buf = enc === "base64" ? Buffer.from(body.replace(/\s+/g, ""), "base64") : enc === "quoted-printable" ? qpDecode(body) : Buffer.from(body, "latin1");
  const text = decodeBytes(buf, param(head["content-type"], "charset"));
  if(ctype.startsWith("text/plain")) out.plain.push(text);
  else if(ctype.startsWith("text/html")) out.html.push(htmlToText(text));
}
function fromEml(buf){
  const raw = buf.toString("latin1");
  const sep = raw.search(/\r?\n\r?\n/);
  const h = parseHeaders(sep < 0 ? raw : raw.slice(0, sep));
  const out = { plain: [], html: [] };
  walkMime(raw, out, 0);
  const head = [["Konu", h.subject], ["Kimden", h.from], ["Kime", h.to], ["Tarih", h.date]]
    .filter(x => x[1]).map(x => x[0] + ": " + decodeHeaderWords(x[1])).join("\n");
  return head + "\n\n" + (out.plain.length ? out.plain : out.html).join("\n\n");
}

/* ---------- ZIP (docx) ---------- */
function zipEntry(buf, wanted){
  let eocd = -1;
  for(let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--){ if(buf.readUInt32LE(i) === 0x06054b50){ eocd = i; break; } }
  if(eocd < 0) throw new Error("ZIP dizini bulunamadı");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for(let n = 0; n < count && p + 46 <= buf.length; n++){
    if(buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nlen).toString("utf8");
    if(name === wanted){
      if(buf.readUInt32LE(off) !== 0x04034b50) throw new Error("ZIP yerel başlığı bozuk");
      const start = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
      const data = buf.slice(start, start + csize);
      if(method === 0) return data;
      if(method === 8) return zlib.inflateRawSync(data);
      throw new Error("Desteklenmeyen ZIP sıkıştırması: " + method);
    }
    p += 46 + nlen + xlen + clen;
  }
  return null;
}
function fromDocx(buf){
  const xml = zipEntry(buf, "word/document.xml");
  if(!xml) throw new Error("word/document.xml yok");
  return decodeEntities(xml.toString("utf8")
    .replace(/<w:tab\/>/g, "\t").replace(/<w:(br|cr)\/>/g, "\n")
    .replace(/<\/w:p>/g, "\n").replace(/<\/w:tc>/g, "\t").replace(/<[^>]+>/g, ""));
}

/* ---------- PDF (en iyi çaba) ---------- */
function pdfStreams(buf){
  const s = buf.toString("latin1"), out = [];
  const re = /stream\r?\n/g; let m;
  while((m = re.exec(s))){
    const start = m.index + m[0].length;
    const end = s.indexOf("endstream", start); if(end < 0) break;
    const dict = s.slice(Math.max(0, s.lastIndexOf("obj", m.index) ), m.index);
    let data = buf.slice(start, end);
    if(/\/FlateDecode/.test(dict)){
      try{ data = zlib.inflateSync(data); }
      catch(e){ try{ data = zlib.inflateSync(data, { finishFlush: zlib.constants.Z_SYNC_FLUSH }); }catch(e2){ data = null; } }
    } else if(/\/Filter/.test(dict)) data = null;   // DCT (resim) vb.: metin yok
    if(data) out.push({ dict, data: data.toString("latin1") });
    re.lastIndex = end + 9;
  }
  return out;
}
function hexToBytes(h){ h = h.replace(/[^0-9a-f]/gi, ""); if(h.length % 2) h += "0"; return Buffer.from(h, "hex"); }
function utf16beHex(h){ const b = hexToBytes(h); let s = ""; for(let i = 0; i + 1 < b.length; i += 2) s += String.fromCharCode(b.readUInt16BE(i)); return s; }
/* Tüm ToUnicode CMap'lerini birleştirir: kod (hex) → Unicode metin */
function buildCmap(streams){
  const map = new Map(); const lens = new Set();
  streams.filter(x => /begincmap/.test(x.data)).forEach(x => {
    const d = x.data;
    for(const blk of d.match(/beginbfchar[\s\S]*?endbfchar/g) || []){
      for(const m of blk.matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]*)>/gi)){ map.set(m[1].toLowerCase(), utf16beHex(m[2])); lens.add(m[1].length); }
    }
    for(const blk of d.match(/beginbfrange[\s\S]*?endbfrange/g) || []){
      for(const m of blk.matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]+)>\s*(<([0-9a-f]+)>|\[([^\]]*)\])/gi)){
        const a = parseInt(m[1], 16), z = parseInt(m[2], 16), w = m[1].length; lens.add(w);
        if(z - a > 5000) continue;
        if(m[4] != null){
          const base = hexToBytes(m[4]);
          for(let c = a; c <= z; c++){
            const b = Buffer.from(base); b.writeUInt16BE((base.readUInt16BE(base.length - 2) + (c - a)) & 0xffff, base.length - 2);
            map.set(c.toString(16).padStart(w, "0"), utf16beHex(b.toString("hex")));
          }
        } else {
          const list = [...m[5].matchAll(/<([0-9a-f]+)>/gi)].map(x => utf16beHex(x[1]));
          for(let c = a; c <= z && c - a < list.length; c++) map.set(c.toString(16).padStart(w, "0"), list[c - a]);
        }
      }
    }
  });
  return { map, lens: [...lens].sort((a, b) => b - a) };
}
function decodeWithCmap(bytes, cm){
  if(!cm.map.size) return null;
  const hex = bytes.toString("hex"); let out = "", i = 0, hit = 0, miss = 0;
  while(i < hex.length){
    let done = false;
    for(const w of cm.lens){ const k = hex.substr(i, w); if(k.length === w && cm.map.has(k)){ out += cm.map.get(k); i += w; hit++; done = true; break; } }
    if(!done){ i += cm.lens[cm.lens.length - 1] || 2; miss++; }
  }
  return hit && hit >= miss ? out : null;
}
function literalBytes(s, i){
  /* s[i] === "(" ; iç içe parantez ve kaçışları çözer → [bytes, sonİndeks] */
  const out = []; let depth = 1; i++;
  while(i < s.length && depth > 0){
    const c = s[i];
    if(c === "\\"){
      const n = s[i + 1];
      const map = { n: 10, r: 13, t: 9, b: 8, f: 12, "(": 40, ")": 41, "\\": 92 };
      if(map[n] != null){ out.push(map[n]); i += 2; continue; }
      if(/[0-7]/.test(n)){ const o = /^[0-7]{1,3}/.exec(s.slice(i + 1, i + 4))[0]; out.push(parseInt(o, 8) & 255); i += 1 + o.length; continue; }
      if(n === "\r" || n === "\n"){ i += n === "\r" && s[i + 2] === "\n" ? 3 : 2; continue; }
      i++; continue;
    }
    if(c === "(") depth++;
    else if(c === ")"){ depth--; if(!depth) break; }
    out.push(s.charCodeAt(i) & 255); i++;
  }
  return [Buffer.from(out), i + 1];
}
function bytesToText(b, cm){
  const viaMap = decodeWithCmap(b, cm);
  if(viaMap != null) return viaMap;
  if(b.length >= 2 && b[0] === 0xFE && b[1] === 0xFF) return utf16beHex(b.slice(2).toString("hex"));
  return new TextDecoder("windows-1252").decode(b);
}
/* İçerik akışındaki metin komutlarını okur:
   Tj / TJ (dizideki büyük negatif aralık = kelime boşluğu) / ' / "  → metin
   Td/TD (dikey kayma varsa) , T* , ET → yeni satır; Tm → dikey konum değiştiyse yeni satır */
function contentText(s, cm){
  let out = "", i = 0, strs = [], nums = [], lastY = null;
  const nl = () => { if(out && !out.endsWith("\n")) out += "\n"; };
  while(i < s.length){
    const c = s[i];
    if(c === "("){ const [b, j] = literalBytes(s, i); strs.push(bytesToText(b, cm)); i = j; continue; }
    if(c === "<"){
      if(s[i + 1] === "<"){ i += 2; continue; }
      const j = s.indexOf(">", i); if(j < 0) break;
      strs.push(bytesToText(hexToBytes(s.slice(i + 1, j)), cm)); i = j + 1; continue;
    }
    if(c === "["){
      let j = i + 1, txt = "";
      while(j < s.length && s[j] !== "]"){
        if(s[j] === "("){ const [b, k] = literalBytes(s, j); txt += bytesToText(b, cm); j = k; }
        else if(s[j] === "<"){ const k = s.indexOf(">", j); if(k < 0) break; txt += bytesToText(hexToBytes(s.slice(j + 1, k)), cm); j = k + 1; }
        else if(/[-+\d.]/.test(s[j])){
          let k = j; while(k < s.length && /[-+\d.]/.test(s[k])) k++;
          if(parseFloat(s.slice(j, k)) < -180 && txt && !/\s$/.test(txt)) txt += " ";
          j = k;
        }
        else j++;
      }
      strs.push(txt); i = j + 1; continue;
    }
    if(c === "%"){ const j = s.indexOf("\n", i); i = j < 0 ? s.length : j; continue; }
    if(/[-+\d.]/.test(c)){
      let j = i; while(j < s.length && /[-+\d.]/.test(s[j])) j++;
      nums.push(parseFloat(s.slice(i, j))); i = j; continue;
    }
    if(c === "/"){ let j = i + 1; while(j < s.length && !/[\s/\[\]()<>{}%]/.test(s[j])) j++; i = j; continue; }   // ad (/F1 vb.)
    if(/[A-Za-z'"*]/.test(c)){
      let j = i; while(j < s.length && /[A-Za-z'"*0-9]/.test(s[j])) j++;
      const op = s.slice(i, j); i = j;
      if(op === "Tj" || op === "TJ") out += strs.join("");
      else if(op === "'" || op === '"'){ nl(); out += strs.join(""); }
      /* Yalnızca dikey kayma yeni satırdır. Yatay yeniden konumlama (harf aralığı ayarı) boşluk sayılmaz:
         PDF'lerde gerçek boşluklar zaten karakter olarak bulunur (aksi halde "Y önlendir me" gibi bölünmeler oluşuyordu). */
      else if(op === "Td" || op === "TD"){ const ty = nums[nums.length - 1]; if(ty) nl(); }
      else if(op === "T*" || op === "ET") nl();
      else if(op === "Tm"){ const y = nums[nums.length - 1]; if(lastY != null && Math.abs(y - lastY) > 0.5) nl(); lastY = y; }
      strs = []; nums = [];
      continue;
    }
    i++;
  }
  return out;
}
function fromPdf(buf){
  const head = buf.slice(0, 1024).toString("latin1");
  if(!/%PDF-/.test(head)) throw new Error("PDF değil");
  if(/\/Encrypt\s/.test(buf.toString("latin1"))) return { encrypted: true, text: "" };
  const streams = pdfStreams(buf);
  const cm = buildCmap(streams);
  const parts = streams.filter(x => /\b(BT)\b[\s\S]*?\b(ET)\b/.test(x.data) && !/begincmap/.test(x.data)).map(x => contentText(x.data, cm));
  return { encrypted: false, text: parts.join("\n") };
}

/* ---------- Ana giriş ---------- */
const TEXT_EXT = new Set(["txt", "md", "markdown", "csv", "tsv", "json", "log", "xml", "yaml", "yml", "ini", "sql"]);
function extract(buf, name, type){
  const e = ext(name); type = String(type || "").toLowerCase();
  try{
    if(e === "pdf" || type === "application/pdf"){
      const r = fromPdf(buf);
      if(r.encrypted) return { status: "none", text: "", reason: "Şifreli PDF okunamaz" };
      return result(r.text, "pdf");
    }
    if(e === "docx" || type.includes("wordprocessingml")) return result(fromDocx(buf), "docx");
    if(e === "eml" || type === "message/rfc822") return result(fromEml(buf), "eml");
    if(e === "html" || e === "htm" || type === "text/html") return result(htmlToText(decodeBytes(buf, param(type, "charset"))), "html");
    if(TEXT_EXT.has(e) || type.startsWith("text/") || type === "application/json"){
      if(buf.includes(0) && !(buf[0] === 0xFF && buf[1] === 0xFE)) return { status: "none", text: "", reason: "İkili (binary) dosya" };
      return result(decodeBytes(buf), "text");
    }
    if(e === "doc") return { status: "unsupported", text: "", reason: "Eski Word biçimi (.doc) desteklenmiyor; .docx olarak kaydedin" };
    return { status: "unsupported", text: "", reason: "Bu dosya türünden metin çıkarılamıyor; LLM'e yalnızca dosya adı gider" };
  }catch(err){
    return { status: "none", text: "", reason: "Dosya okunamadı (" + err.message + ")" };
  }
}

module.exports = { extract, VERSION, MAX_CHARS };
