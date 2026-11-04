/* İş Takip — minimal yerel sunucu.
   Bağımlılık yok (sadece Node.js yerleşik modülleri).
   - public/ klasörünü sunar
   - /api/state  (GET)  → tasks + projects + archive + units
   - /api/:kind  (PUT)  → kind: tasks | projects | archive | units, gövde: { items: [...] }
   - /api/attachments      (POST) → ham dosya gövdesi, X-File-Name başlığı → { id, name, size, type }
   - /api/attachments/:id  (GET)  → ek dosyasını indirir
   - /api/ai/chat          (POST) → { messages, board, modelId } → seçilen modele (OpenRouter ya da OpenAI uyumlu yerel sunucu) aracılık eder.
   - /api/ai/models        (GET/PUT) → kayıtlı AI modelleri (anahtarlar tarayıcıya gönderilmez)
   - /api/ai/models/test   (POST) → { baseUrl, apiKey?, id? } → sunucunun /models listesini döndürür
     Araçları (kart oluştur/düzenle/taşı) tarayıcı çalıştırır; anahtar yalnızca sunucuda kalır.
   Veriler data/*.json dosyalarına atomik olarak yazılır (önce geçici dosya, sonra yeniden adlandırma).
   Ekler data/attachments/ altında durur.
   Sunucu yalnızca bu bilgisayardan (127.0.0.1) erişilebilir. */

"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

/* .env (bağımlılıksız): KEY=VALUE satırları; # yorum; tırnaklar soyulur. Ortamda zaten olan değer korunur. */
function loadEnv(file){
  let text;
  try{ text = fs.readFileSync(file, "utf8"); }catch(e){ return; }
  text.replace(/^﻿/, "").split(/\r?\n/).forEach(line => {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if(!m || line.trim().startsWith("#")) return;
    let v = m[2];
    const q = /^(["'])(.*?)\1(?:\s+#.*)?$/.exec(v);   // "değer"  ya da  "değer" # yorum
    v = q ? q[2] : v.replace(/\s+#.*$/, "");
    if(process.env[m[1]] === undefined) process.env[m[1]] = v;
  });
}
loadEnv(path.join(__dirname, ".env"));

const PORT = parseInt(process.env.PORT, 10) || 3000;
const HOST = process.env.HOST || "127.0.0.1";
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, "data");
const BACKUP_DIR = path.join(DATA_DIR, "backup");
const ATT_DIR = path.join(DATA_DIR, "attachments");
const KINDS = ["tasks", "projects", "archive", "units"];
const SCHEMA_VERSION = 1;
const MAX_BODY = 10 * 1024 * 1024;
const MAX_UPLOAD = 25 * 1024 * 1024;
const KEEP_BACKUPS = 30;
const ORPHAN_AGE_MS = 24 * 60 * 60 * 1000;
const SAFE_ID = /^[\w-]{1,64}$/;
/* Tarayıcıda satır içi gösterilmesi güvenli türler; geri kalan her şey indirme olarak sunulur (HTML/SVG çalıştırılmaz). */
const INLINE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp", "application/pdf"]);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

fs.mkdirSync(ATT_DIR, { recursive: true });

function filePath(kind){ return path.join(DATA_DIR, kind + ".json"); }

/* ---------- Okuma ---------- */
/* { items, updatedAt } döner. updatedAt, istemcinin çakışma kontrolü için kullandığı sürüm damgasıdır. */
function readKindFull(kind){
  const p = filePath(kind);
  if(!fs.existsSync(p)) return { items: [], updatedAt: "" };
  const text = fs.readFileSync(p, "utf8").replace(/^﻿/, "").trim();
  if(!text) return { items: [], updatedAt: "" };
  const data = JSON.parse(text); // bozuksa hata fırlatır; sessizce boş dönmeyiz
  if(Array.isArray(data)) return { items: data, updatedAt: "" };   // eski/elle yazılmış düz dizi
  if(data && Array.isArray(data.items)) return { items: data.items, updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : "" };
  throw new Error(kind + ".json beklenen biçimde değil");
}

/* Windows'ta antivirüs/dizinleyici dosyayı kısa süre tutabilir; rename'i birkaç kez dene. */
function renameWithRetry(from, to){
  for(let i = 0; ; i++){
    try{ fs.renameSync(from, to); return; }
    catch(e){
      if(i >= 5 || !["EPERM", "EBUSY", "EACCES"].includes(e.code)) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50 * (i + 1));
    }
  }
}

/* ---------- Atomik yazma (her tür için sıralı) ---------- */
const queues = {};
/* baseUpdatedAt verilmişse ve dosyadaki sürümle uyuşmuyorsa (başka sekme/pencere yazmış) 409 ile reddeder. */
function writeKind(kind, items, baseUpdatedAt){
  const run = () => new Promise((resolve, reject) => {
    const p = filePath(kind);
    const tmp = p + ".tmp-" + process.pid;
    try{
      if(typeof baseUpdatedAt === "string" && readKindFull(kind).updatedAt !== baseUpdatedAt){
        return reject(Object.assign(new Error("Veri başka bir pencerede değişti"), { status: 409 }));
      }
    }catch(e){ return reject(e); }
    const updatedAt = new Date().toISOString();
    const payload = JSON.stringify({ schemaVersion: SCHEMA_VERSION, updatedAt, items }, null, 2);
    try{
      const fd = fs.openSync(tmp, "w");
      fs.writeSync(fd, payload);
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      renameWithRetry(tmp, p);
      resolve(updatedAt);
    }catch(e){
      try{ fs.unlinkSync(tmp); }catch(_){}
      reject(e);
    }
  });
  queues[kind] = (queues[kind] || Promise.resolve()).then(run, run);
  return queues[kind];
}

/* ---------- Açılışta yedek ---------- */
function backupOnStartup(){
  const existing = KINDS.filter(k => fs.existsSync(filePath(k)));
  if(!existing.length) return;
  const d = new Date();
  const pad = n => String(n).padStart(2, "0");
  const stamp = d.getFullYear() + pad(d.getMonth()+1) + pad(d.getDate()) + "-" + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
  const dir = path.join(BACKUP_DIR, stamp);
  fs.mkdirSync(dir, { recursive: true });
  existing.forEach(k => fs.copyFileSync(filePath(k), path.join(dir, k + ".json")));
  const all = fs.readdirSync(BACKUP_DIR).filter(n => fs.statSync(path.join(BACKUP_DIR, n)).isDirectory()).sort();
  all.slice(0, Math.max(0, all.length - KEEP_BACKUPS)).forEach(n => {
    fs.rmSync(path.join(BACKUP_DIR, n), { recursive: true, force: true });
  });
}

/* ---------- Ekler ---------- */
function attPath(id){ return path.join(ATT_DIR, id); }
function attMetaPath(id){ return path.join(ATT_DIR, id + ".json"); }

function writeFileAtomic(p, data){
  const tmp = p + ".tmp-" + process.pid;
  try{
    const fd = fs.openSync(tmp, "w");
    fs.writeSync(fd, data);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    renameWithRetry(tmp, p);
  }catch(e){
    try{ fs.unlinkSync(tmp); }catch(_){}
    throw e;
  }
}

function saveAttachment(buf, rawName, rawType){
  let name = "dosya";
  try{ name = decodeURIComponent(rawName || "") || "dosya"; }catch(e){}
  name = name.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").slice(0, 200);
  const type = /^[\w.+-]+\/[\w.+-]+$/.test(rawType || "") ? rawType.toLowerCase() : "application/octet-stream";
  const id = "a" + crypto.randomBytes(10).toString("hex");
  const meta = { id, name, type, size: buf.length, uploadedAt: new Date().toISOString() };
  writeFileAtomic(attPath(id), buf);
  writeFileAtomic(attMetaPath(id), JSON.stringify(meta));
  return meta;
}

function serveAttachment(res, id){
  if(!SAFE_ID.test(id)) return send(res, 400, { error: "Geçersiz ek kimliği" });
  let meta;
  try{ meta = JSON.parse(fs.readFileSync(attMetaPath(id), "utf8")); }catch(e){ return send(res, 404, { error: "Ek bulunamadı" }); }
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

/* Hiçbir işin (aktif ya da arşiv) kullanmadığı ve 1 günden eski ekleri siler.
   Bir JSON dosyası okunamazsa hiçbir şey silinmez: bozuk veri yüzünden ek kaybetmeyelim. */
function cleanupOrphanAttachments(){
  const used = new Set();
  for(const k of ["tasks", "archive"]){
    const items = readKindFull(k).items; // hata fırlatırsa temizlik tümüyle atlanır
    items.forEach(t => {
      if(!t || typeof t !== "object") return;
      if(Array.isArray(t.attachments)) t.attachments.forEach(a => { if(a && typeof a.id === "string") used.add(a.id); });
      const html = typeof t.descriptionHtml === "string" ? t.descriptionHtml : "";
      html.replace(/\/api\/attachments\/([\w-]+)/g, (_, id) => { used.add(id); return ""; });
    });
  }
  const now = Date.now();
  let removed = 0;
  fs.readdirSync(ATT_DIR).forEach(n => {
    const id = n.replace(/\.json$/, "").replace(/\.tmp-\d+$/, "");
    if(used.has(id)) return;
    const p = path.join(ATT_DIR, n);
    try{
      if(now - fs.statSync(p).mtimeMs < ORPHAN_AGE_MS) return;
      fs.unlinkSync(p);
      if(!n.endsWith(".json")) removed++;
    }catch(e){}
  });
  if(removed) console.log("Kullanılmayan " + removed + " ek silindi.");
}

/* ---------- AI asistan (OpenRouter) ---------- */
const AI_URL = process.env.OPENROUTER_URL || "https://openrouter.ai/api/v1/chat/completions"; // OPENROUTER_URL yalnızca test içindir
const AI_MODEL = "openai/gpt-oss-120b";
const AI_TIMEOUT_MS = 60000;
const AI_MAX_MESSAGES = 60;
const AI_MAX_BOARD = 60000;
const DAYS_TR = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];

function s(v, max){ return v == null ? "" : String(v).slice(0, max || 500); }
function ids(list){ return (Array.isArray(list) ? list : []).map(x => s(x && x.id, 64)).filter(id => SAFE_ID.test(id)); }

/* İstemciden gelen pano özetini güvenli ve sınırlı bir biçime indirger */
function cleanBoard(b){
  b = b && typeof b === "object" ? b : {};
  const pick = (list, f) => (Array.isArray(list) ? list : []).slice(0, 200).map(f).filter(x => SAFE_ID.test(x.id));
  const out = {
    units: pick(b.units, u => ({ id: s(u && u.id, 64), name: s(u && u.name, 80) })),
    projects: pick(b.projects, p => ({ id: s(p && p.id, 64), name: s(p && p.name, 80), status: s(p && p.status, 20) })),
    statuses: pick(b.statuses, x => ({ id: s(x && x.id, 64), name: s(x && x.name, 40) })),
    priorities: pick(b.priorities, x => ({ id: s(x && x.id, 64), name: s(x && x.name, 40) })),
    tasks: (Array.isArray(b.tasks) ? b.tasks : []).slice(0, 500).map(t => ({
      id: s(t && t.id, 64), title: s(t && t.title, 200), status: s(t && t.status, 20), unit: s(t && t.unit, 64),
      priority: s(t && t.priority, 20), projectId: s(t && t.projectId, 64), startDate: s(t && t.startDate, 10), dueDate: s(t && t.dueDate, 10),
      description: s(t && t.description, 300), lastNote: s(t && t.lastNote, 200), due: s(t && t.due, 40)
    })).filter(t => SAFE_ID.test(t.id))
  };
  /* çok büyükse önce açıklamaları, sonra notları kısalt */
  for(const lim of [120, 40, 0]){
    if(JSON.stringify(out.tasks).length <= AI_MAX_BOARD) break;
    out.tasks.forEach(t => { t.description = t.description.slice(0, lim); t.lastNote = t.lastNote.slice(0, lim); });
  }
  return out;
}

function aiTools(board){
  const unitEnum = board.units.map(u => u.id), statusEnum = board.statuses.map(x => x.id), prioEnum = board.priorities.map(x => x.id);
  const en = (list) => list.length ? { enum: list } : {};
  const date = { type: "string", description: "ISO tarih YYYY-AA-GG. Boş bırakmak için \"\"" };
  const fields = {
    title: { type: "string" },
    description: { type: "string", description: "Düz metin açıklama (satır sonları korunur)" },
    unit: Object.assign({ type: "string", description: "Sorumlu id" }, en(unitEnum)),
    priority: Object.assign({ type: "string" }, en(prioEnum)),
    projectId: { type: "string", description: "Proje id; projesiz için \"\"" },
    startDate: date, dueDate: date
  };
  return [
    { type: "function", function: { name: "create_tasks", description: "Bir veya birden fazla yeni iş kartı oluşturur.",
      parameters: { type: "object", required: ["tasks"], properties: { tasks: { type: "array", minItems: 1, items: { type: "object", required: ["title"],
        properties: Object.assign({}, fields, { status: Object.assign({ type: "string" }, en(statusEnum)), note: { type: "string", description: "İlk durum notu (isteğe bağlı)" } }) } } } } } },
    { type: "function", function: { name: "update_tasks", description: "Mevcut işlerin alanlarını günceller. Yalnızca değişecek alanları gönder.",
      parameters: { type: "object", required: ["updates"], properties: { updates: { type: "array", minItems: 1, items: { type: "object", required: ["id"],
        properties: Object.assign({ id: { type: "string" } }, fields, { add_note: { type: "string", description: "İşe yeni bir durum notu ekler" } }) } } } } } },
    { type: "function", function: { name: "move_tasks", description: "İşleri başka bir durum sütununa taşır.",
      parameters: { type: "object", required: ["moves"], properties: { moves: { type: "array", minItems: 1, items: { type: "object", required: ["id", "status"],
        properties: { id: { type: "string" }, status: Object.assign({ type: "string" }, en(statusEnum)) } } } } } } },
    { type: "function", function: { name: "list_tasks",
      description: "Panodaki aktif işleri filtreleyerek listeler (değişiklik yapmaz). 'Gecikmiş işler', 'bu hafta bitecekler', 'X projesindeki işler' gibi sorular için kullan. Filtre vermezsen tüm aktif işleri döner.",
      parameters: { type: "object", properties: {
        urgency: { type: "string", enum: ["overdue", "today", "soon", "attention"], description: "overdue: termini geçmiş; today: bugün bitiyor; soon: 1-3 gün içinde bitiyor; attention: üçü birden" },
        status: Object.assign({ type: "string" }, en(statusEnum)),
        unit: Object.assign({ type: "string", description: "Sorumlu id" }, en(unitEnum)),
        projectId: { type: "string", description: "Proje id; projesiz işler için \"none\"" },
        priority: Object.assign({ type: "string" }, en(prioEnum)),
        due_before: { type: "string", description: "Bu tarihte (YYYY-AA-GG) veya öncesinde bitenler" },
        query: { type: "string", description: "Başlık/açıklamada geçen metin" }
      } } } },
    { type: "function", function: { name: "get_task", description: "Bir işin tam açıklamasını ve tüm notlarını okur (değişiklik yapmaz).",
      parameters: { type: "object", required: ["id"], properties: { id: { type: "string" } } } } }
  ];
}

/* "yarın = Perşembe 2026-11-05, Cuma 2026-11-06, …" — model gün adlarını takvimden okusun */
function upcomingDays(from){
  const pad = n => String(n).padStart(2, "0"), out = [];
  for(let i = 1; i <= 14; i++){
    const x = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i);
    out.push((i === 1 ? "yarın " : i <= 7 ? "" : "gelecek hafta ") + DAYS_TR[x.getDay()] + " " + x.getFullYear() + "-" + pad(x.getMonth() + 1) + "-" + pad(x.getDate()));
  }
  return out.join(", ");
}

function aiSystem(board){
  const d = new Date(), pad = n => String(n).padStart(2, "0");
  const iso = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  const list = (arr, f) => arr.map(f).join("\n") || "(yok)";
  const count = re => board.tasks.filter(t => re.test(t.due)).length;
  return [
    "Sen 'İş Takip' kanban panosunun asistanısın. Kullanıcının işlerini (kartlarını) listeler, oluşturur, düzenler ve taşırsın.",
    "Panodaki TÜM aktif işler bu mesajın sonundaki listede yer alıyor; ayrıca list_tasks aracıyla filtreleyerek sorgulayabilirsin.",
    "Kullanıcı iş listelemek, saymak veya özetlemek isterse list_tasks'ı kullan ya da listeden yanıtla. Asla 'listeleyemiyorum' deme. Eşleşen iş yoksa bunu açıkça söyle.",
    "Her işteki 'due' alanı termin durumunu hazır olarak verir: 'N gün gecikti' (gecikmiş), 'bugün bitiyor', 'yakında (N gün kaldı)', 'N gün kaldı'; boşsa termin yok ya da iş tamamlanmış/iptal. Gecikmeyi kendin hesaplama, bu alanı kullan.",
    "Kurallar:",
    "- Kullanıcının dilinde, kısa ve net yanıt ver. Markdown olarak yalnızca **kalın** ve '- ' ile başlayan listeler kullan.",
    "- Panoda değişiklik yapmak için YALNIZCA araçları kullan; araç çağırmadan bir değişikliği yaptığını söyleme.",
    "- İş id'lerini asla uydurma; aşağıdaki listedeki id'leri kullan. Kullanıcı bir işi adıyla anarsa listeden eşleştir; birden fazla aday varsa sor.",
    "- Beklemede, Devam Ediyor ve Tamamlandı durumları için başlangıç (startDate) ve bitiş (dueDate) tarihi zorunludur; Backlog ve İptal Edildi için gerekmez.",
    "- Kullanıcı vermediği bir tarihi ASLA uydurma (bugünü başlangıç/bitiş yapma dahil). Tarih gerekiyorsa kullanıcıya sor; isterken gg.aa.yyyy biçimini kullan, ISO biçimini ya da araç adlarını kullanıcıya söyleme.",
    "- Araç sonucundaki 'applied' 0 ise hiçbir değişiklik yapılmamıştır: kullanıcıya bunu ve nedenini söyle, 'yaptım' deme.",
    "- Araçlarda tarihleri ISO (YYYY-AA-GG) yaz; kullanıcıya tarihleri gg.aa.yyyy biçiminde söyle. 'Yarın', 'cuma' gibi ifadeleri bugünün tarihine göre hesapla.",
    "- İş silme ve arşivleme yapamazsın; istenirse kullanıcının bunu kartın üzerindeki butonlarla yapması gerektiğini söyle.",
    "- Araç sonucu bazı öğelerin atlandığını söylerse nedenini kullanıcıya açıkla veya düzeltip yeniden dene.",
    "- Değişiklikten sonraki özetinde YALNIZCA araç sonucundaki 'ok' listesinde dönen başlıkları say; listede olmayan işi değiştirdim deme.",
    "- Toplu isteklerde (ör. 'bugün bitecek işler') önce list_tasks ile doğru işleri bul, sonra o id'lerle değişiklik yap.",
    "- Bir istek belirsizse değişiklik yapmadan önce kısa bir soru sor. Ama kullanıcı sorumlu belirtmediyse sorma: ilk sorumluyu (" + (board.units[0] ? board.units[0].name : "varsayılan") + ") kullan; öncelik belirtilmediyse 'orta' kullan.",
    "- Kullanıcıya iş, proje veya sorumlu id'lerini (ör. demo-t12, p1, oz) gösterme; adlarını kullan.",
    "- 'Cuma', 'gelecek pazartesi', 'yarın' gibi ifadeleri aşağıdaki takvimden oku; tarih hesabı yapma.",
    "",
    "Bugün: " + iso + " (" + DAYS_TR[d.getDay()] + ")",
    "Takvim (önümüzdeki 14 gün): " + upcomingDays(d),
    "Özet: " + board.tasks.length + " aktif iş; " + count(/gecikti/) + " gecikmiş, " + count(/^bugün/) + " bugün bitiyor, " + count(/^yakında/) + " yakında bitiyor (1-3 gün).",
    "",
    "Sorumlular (id: ad):", list(board.units, u => "- " + u.id + ": " + u.name),
    "Projeler (id: ad):", list(board.projects, p => "- " + p.id + ": " + p.name + (p.status === "arsivlenmis" ? " (arşivlenmiş)" : "")),
    "Durumlar (id: ad):", list(board.statuses, x => "- " + x.id + ": " + x.name),
    "Öncelikler (id: ad):", list(board.priorities, x => "- " + x.id + ": " + x.name),
    "",
    "Panodaki aktif işler (JSON):",
    JSON.stringify(board.tasks)
  ].join("\n");
}

/* Yalnızca beklenen biçimdeki mesajlar modele gider */
function cleanMessages(list){
  if(!Array.isArray(list) || !list.length) throw Object.assign(new Error("Mesaj yok"), { status: 400 });
  return list.slice(-AI_MAX_MESSAGES).map(m => {
    if(!m || typeof m !== "object") throw Object.assign(new Error("Geçersiz mesaj"), { status: 400 });
    if(m.role === "user") return { role: "user", content: s(m.content, 8000) };
    if(m.role === "tool") return { role: "tool", tool_call_id: s(m.tool_call_id, 200), content: s(m.content, 20000) };
    if(m.role === "assistant"){
      const out = { role: "assistant", content: m.content == null ? "" : s(m.content, 8000) };
      if(Array.isArray(m.tool_calls) && m.tool_calls.length){
        out.tool_calls = m.tool_calls.slice(0, 20).map(c => ({
          id: s(c && c.id, 200), type: "function",
          function: { name: s(c && c.function && c.function.name, 64), arguments: s(c && c.function && c.function.arguments, 20000) }
        }));
      }
      return out;
    }
    throw Object.assign(new Error("Geçersiz mesaj rolü"), { status: 400 });
  });
}

/* ---------- AI model kaydı (data/ai-models.json) ----------
   Yerleşik model: OpenRouter + gpt-oss-120b (anahtar .env'de). Kullanıcı OpenAI uyumlu başka uç noktalar ekleyebilir
   (Ollama, LM Studio, vLLM, llama.cpp…). API anahtarları yalnızca bu dosyada durur; tarayıcıya hiç gönderilmez. */
const MODELS_FILE = path.join(DATA_DIR, "ai-models.json");
const BUILTIN_ID = "openrouter";
const LOCAL_TIMEOUT_MS = 180000;   // yerel modeller (özellikle CPU'da) yavaş olabilir

function readModels(){
  try{
    const j = JSON.parse(fs.readFileSync(MODELS_FILE, "utf8").replace(/^﻿/, ""));
    return (Array.isArray(j.items) ? j.items : []).filter(m => m && SAFE_ID.test(m.id || ""));
  }catch(e){ return []; }
}
function writeModels(items){ writeFileAtomic(MODELS_FILE, JSON.stringify({ schemaVersion: 1, updatedAt: new Date().toISOString(), items }, null, 2)); }
function normBase(u){ return String(u || "").trim().replace(/\/+$/, "").replace(/\/chat\/completions$/, ""); }
function validBase(u){ try{ const x = new URL(u); return x.protocol === "http:" || x.protocol === "https:"; }catch(e){ return false; } }

/* Tarayıcıya giden liste: anahtar yok, yalnızca var/yok bilgisi */
function publicModels(){
  return [{ id: BUILTIN_ID, name: "OpenRouter · gpt-oss-120b", baseUrl: "https://openrouter.ai/api/v1", model: AI_MODEL,
            builtin: true, hasKey: !!process.env.OPENROUTER_API_KEY, available: !!process.env.OPENROUTER_API_KEY }]
    .concat(readModels().map(m => ({ id: m.id, name: m.name, baseUrl: m.baseUrl, model: m.model, builtin: false, hasKey: !!m.apiKey, available: true })));
}

/* PUT gövdesi: { items:[{ id?, name, baseUrl, model, apiKey? }] } — apiKey verilmezse mevcut anahtar korunur, "" ise silinir */
function saveModels(list){
  if(!Array.isArray(list) || list.length > 50) throw Object.assign(new Error("Geçersiz model listesi"), { status: 400 });
  const old = {}; readModels().forEach(m => { old[m.id] = m; });
  const seen = {};
  const items = list.map((m, i) => {
    m = m || {};
    const id = SAFE_ID.test(m.id || "") && m.id !== BUILTIN_ID ? m.id : "m" + crypto.randomBytes(5).toString("hex");
    const name = s(m.name, 80).trim(), baseUrl = normBase(m.baseUrl), model = s(m.model, 200).trim();
    const who = (name || ("#" + (i + 1)));
    if(!name) throw Object.assign(new Error(who + ": ad boş olamaz"), { status: 400 });
    if(!validBase(baseUrl)) throw Object.assign(new Error(who + ": adres http:// veya https:// ile başlamalı"), { status: 400 });
    if(!model) throw Object.assign(new Error(who + ": model adı boş olamaz"), { status: 400 });
    if(seen[name.toLocaleLowerCase("tr")]) throw Object.assign(new Error('"' + name + '" adı birden fazla kez kullanılmış'), { status: 400 });
    seen[name.toLocaleLowerCase("tr")] = 1;
    const apiKey = m.apiKey === undefined ? (old[id] ? old[id].apiKey || "" : "") : s(m.apiKey, 500).trim();
    return { id, name, baseUrl, model, apiKey };
  });
  writeModels(items);
  return publicModels();
}

function resolveModel(id){
  if(!id || id === BUILTIN_ID){
    const key = process.env.OPENROUTER_API_KEY;
    if(!key) throw Object.assign(new Error("OpenRouter anahtarı tanımlı değil. Proje klasöründeki .env dosyasına OPENROUTER_API_KEY=... satırını ekleyip sunucuyu yeniden başlatın ya da Ayarlar'dan yerel bir model seçin."), { status: 503 });
    return { builtin: true, name: "OpenRouter", url: AI_URL, key, model: AI_MODEL, timeout: AI_TIMEOUT_MS };
  }
  const m = readModels().find(x => x.id === id);
  if(!m) throw Object.assign(new Error("Seçilen model artık kayıtlı değil. AI panelinden başka bir model seçin."), { status: 400 });
  return { builtin: false, name: m.name, url: m.baseUrl + "/chat/completions", key: m.apiKey, model: m.model, timeout: LOCAL_TIMEOUT_MS, baseUrl: m.baseUrl };
}
function aiHeaders(cfg){
  const h = { "Content-Type": "application/json" };
  if(cfg.key) h.Authorization = "Bearer " + cfg.key;
  if(cfg.builtin){ h["HTTP-Referer"] = "http://localhost"; h["X-Title"] = "Is Takip"; }
  return h;
}
function netError(e, cfg){
  if(e.name === "AbortError") return "AI yanıtı zaman aşımına uğradı (" + Math.round(cfg.timeout / 1000) + " sn). Tekrar deneyin.";
  if(cfg.builtin) return "OpenRouter'a ulaşılamadı (internet bağlantısı veya kurum proxy'si?)";
  return '"' + cfg.name + '" sunucusuna ulaşılamadı (' + cfg.baseUrl + "). Model sunucusu (Ollama, LM Studio vb.) çalışıyor mu, adres doğru mu?";
}

/* Bağlantı testi: OpenAI uyumlu /models listesi. { id } verilirse kayıtlı anahtar kullanılır. */
async function testModel(body){
  body = body || {};
  let baseUrl = normBase(body.baseUrl), key = body.apiKey === undefined ? "" : s(body.apiKey, 500).trim();
  if(body.id === BUILTIN_ID){ baseUrl = "https://openrouter.ai/api/v1"; key = process.env.OPENROUTER_API_KEY || ""; }
  else if(body.id && body.apiKey === undefined){ const m = readModels().find(x => x.id === body.id); if(m) key = m.apiKey || ""; }
  if(!validBase(baseUrl)) throw Object.assign(new Error("Adres http:// veya https:// ile başlamalı"), { status: 400 });
  const cfg = { name: baseUrl, baseUrl, key, timeout: 10000 };
  const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), cfg.timeout);
  let r, j;
  try{ r = await fetch(baseUrl + "/models", { headers: aiHeaders(cfg), signal: ctrl.signal }); j = await r.json().catch(() => ({})); }
  catch(e){ throw Object.assign(new Error(netError(e, cfg)), { status: 502 }); }
  finally{ clearTimeout(timer); }
  if(r.status === 401 || r.status === 403) throw Object.assign(new Error("Sunucu anahtarı reddetti (HTTP " + r.status + ")"), { status: 502 });
  if(!r.ok) throw Object.assign(new Error("Sunucu /models isteğine HTTP " + r.status + " döndü"), { status: 502 });
  const list = Array.isArray(j.data) ? j.data : Array.isArray(j.models) ? j.models : [];
  return { ok: true, models: list.map(x => s(x && (x.id || x.name || x.model), 200)).filter(Boolean).slice(0, 500) };
}

/* Yerel modeller düşünce metnini <think>…</think> içinde döndürebilir; kullanıcıya gösterilmez */
function stripThink(t){ return String(t || "").replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/^[\s\S]*?<\/think>/i, "").trim(); }

async function aiChat(body){
  const cfg = resolveModel(body && s(body.modelId, 64));
  const board = cleanBoard(body && body.board);
  const messages = [{ role: "system", content: aiSystem(board) }].concat(cleanMessages(body && body.messages));
  const req = { model: cfg.model, messages, tools: aiTools(board), tool_choice: "auto", temperature: 0.2, max_tokens: 2000 };
  if(cfg.builtin) req.provider = { require_parameters: true };   // yalnızca araç çağırmayı destekleyen sağlayıcılar
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), cfg.timeout);
  let r, j;
  try{
    r = await fetch(cfg.url, { method: "POST", signal: ctrl.signal, headers: aiHeaders(cfg), body: JSON.stringify(req) });
    j = await r.json().catch(() => ({}));
  }catch(e){
    throw Object.assign(new Error(netError(e, cfg)), { status: 502 });
  }finally{ clearTimeout(timer); }
  const detail = j && j.error ? ": " + s(typeof j.error === "string" ? j.error : j.error.message, 300) : "";
  if(!r.ok){
    const map = cfg.builtin
      ? { 400: "İstek reddedildi", 401: "OpenRouter anahtarı geçersiz (.env)", 402: "OpenRouter bakiyesi yetersiz", 403: "OpenRouter isteği engelledi",
          404: "Model ya da araç desteği olan sağlayıcı bulunamadı", 408: "OpenRouter zaman aşımı", 429: "Çok fazla istek; biraz bekleyip tekrar deneyin" }
      : { 400: '"' + cfg.name + '" isteği reddetti (model araç çağırmayı — tools — desteklemiyor olabilir)', 401: '"' + cfg.name + '" anahtarı reddetti',
          403: '"' + cfg.name + '" anahtarı reddetti', 404: '"' + cfg.model + '" modeli bu sunucuda bulunamadı (model adını kontrol edin)', 429: "Çok fazla istek; biraz bekleyip tekrar deneyin" };
    throw Object.assign(new Error((map[r.status] || ('"' + cfg.name + '" hatası (HTTP ' + r.status + ")")) + detail), { status: 502 });
  }
  const msg = j && j.choices && j.choices[0] && j.choices[0].message;
  if(!msg) throw Object.assign(new Error('"' + cfg.name + '" boş yanıt döndü' + detail), { status: 502 });
  const out = { role: "assistant", content: stripThink(typeof msg.content === "string" ? msg.content : "") };
  if(Array.isArray(msg.tool_calls) && msg.tool_calls.length){
    out.tool_calls = msg.tool_calls.map(c => {
      const a = c.function && c.function.arguments;   // bazı yerel sunucular argümanı nesne olarak döndürür
      return { id: s(c.id, 200) || "call_" + crypto.randomBytes(6).toString("hex"), type: "function",
        function: { name: s(c.function && c.function.name, 64), arguments: (typeof a === "string" ? s(a, 20000) : a ? JSON.stringify(a).slice(0, 20000) : "") || "{}" } };
    });
  }
  return { message: out, modelName: cfg.builtin ? "OpenRouter · gpt-oss-120b" : cfg.name };
}

/* ---------- Yardımcılar ---------- */
function send(res, status, body, headers){
  const isObj = typeof body === "object" && !Buffer.isBuffer(body);
  const data = isObj ? JSON.stringify(body) : body;
  res.writeHead(status, Object.assign({
    "Content-Type": isObj ? "application/json; charset=utf-8" : "text/plain; charset=utf-8",
    "Cache-Control": "no-store"
  }, headers || {}));
  res.end(data);
}

function readBody(req, limit, asBuffer){
  limit = limit || MAX_BODY;
  return new Promise((resolve, reject) => {
    let size = 0, failed = false; const chunks = [];
    req.on("data", c => {
      if(failed) return;
      size += c.length;
      if(size > limit){
        failed = true; chunks.length = 0;
        reject(Object.assign(new Error("Dosya çok büyük (en fazla " + Math.round(limit / 1048576) + " MB)"), { status: 413 }));
        return; // gövdenin geri kalanı okunup atılır; böylece 413 yanıtı istemciye ulaşabilir
      }
      chunks.push(c);
    });
    req.on("end", () => { if(!failed){ const b = Buffer.concat(chunks); resolve(asBuffer ? b : b.toString("utf8")); } });
    req.on("error", reject);
  });
}

/* Başka bir web sitesinin tarayıcıdan bu yerel sunucuya yazmasını engeller.
   Host kontrolü DNS rebinding'e karşıdır (evil.com → 127.0.0.1 çözümlendiğinde Host "evil.com" olur). */
const ALLOWED_HOSTS = new Set(["localhost:" + PORT, "127.0.0.1:" + PORT, "[::1]:" + PORT, HOST + ":" + PORT]);
function sameOriginOk(req){
  if(!ALLOWED_HOSTS.has(String(req.headers.host || "").toLowerCase())) return false;
  const origin = req.headers.origin;
  if(!origin) return true; // aynı-kaynak GET'lerde Origin gelmeyebilir
  try{ return new URL(origin).host === req.headers.host; }catch(e){ return false; }
}

function serveStatic(req, res, pathname){
  let rel;
  try{ rel = decodeURIComponent(pathname); }catch(e){ return send(res, 400, "Geçersiz adres"); }
  if(rel === "/" ) rel = "/index.html";
  const full = path.normalize(path.join(PUBLIC_DIR, rel));
  if(!full.startsWith(PUBLIC_DIR + path.sep) && full !== PUBLIC_DIR) return send(res, 403, "Yasak");
  fs.readFile(full, (err, buf) => {
    if(err) return send(res, 404, "Bulunamadı");
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(full).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-cache"
    });
    res.end(buf);
  });
}

/* ---------- Sunucu ---------- */
const server = http.createServer(async (req, res) => {
  try{
    const url = new URL(req.url, "http://" + (req.headers.host || "localhost"));
    const pathname = url.pathname;

    if(pathname === "/api/state" && req.method === "GET"){
      if(!sameOriginOk(req)) return send(res, 403, { error: "Yasak" });
      const out = { meta: {} };
      for(const k of KINDS){
        try{ const r = readKindFull(k); out[k] = r.items; out.meta[k] = r.updatedAt; }
        catch(e){ return send(res, 500, { error: k + ".json okunamadı: " + e.message }); }
      }
      return send(res, 200, out);
    }

    if(pathname === "/api/ai/models"){
      if(!sameOriginOk(req)) return send(res, 403, { error: "Yasak" });
      if(req.method === "GET") return send(res, 200, { items: publicModels() });
      if(req.method === "PUT"){
        if(!/^application\/json/i.test(req.headers["content-type"] || "")) return send(res, 415, { error: "Content-Type application/json olmalı" });
        let parsed;
        try{ parsed = JSON.parse(await readBody(req, 256 * 1024)); }catch(e){ if(e.status) throw e; return send(res, 400, { error: "Geçersiz JSON" }); }
        return send(res, 200, { items: saveModels(parsed && parsed.items) });
      }
    }
    if(pathname === "/api/ai/models/test" && req.method === "POST"){
      if(!sameOriginOk(req)) return send(res, 403, { error: "Yasak" });
      if(!/^application\/json/i.test(req.headers["content-type"] || "")) return send(res, 415, { error: "Content-Type application/json olmalı" });
      let parsed;
      try{ parsed = JSON.parse(await readBody(req, 16 * 1024)); }catch(e){ if(e.status) throw e; return send(res, 400, { error: "Geçersiz JSON" }); }
      return send(res, 200, await testModel(parsed));
    }

    if(pathname === "/api/ai/chat" && req.method === "POST"){
      if(!sameOriginOk(req)) return send(res, 403, { error: "Yasak" });
      if(!/^application\/json/i.test(req.headers["content-type"] || "")) return send(res, 415, { error: "Content-Type application/json olmalı" });
      let parsed;
      try{ parsed = JSON.parse(await readBody(req, 1024 * 1024)); }catch(e){ if(e.status) throw e; return send(res, 400, { error: "Geçersiz JSON" }); }
      return send(res, 200, await aiChat(parsed));
    }

    if(pathname === "/api/attachments" && req.method === "POST"){
      if(!sameOriginOk(req)) return send(res, 403, { error: "Yasak" });
      const buf = await readBody(req, MAX_UPLOAD, true);
      if(!buf.length) return send(res, 400, { error: "Boş dosya" });
      return send(res, 200, saveAttachment(buf, req.headers["x-file-name"], String(req.headers["content-type"] || "").split(";")[0].trim()));
    }
    const am = pathname.match(/^\/api\/attachments\/([^/]+)$/);
    if(am && (req.method === "GET" || req.method === "HEAD")){
      if(!sameOriginOk(req)) return send(res, 403, { error: "Yasak" });
      return serveAttachment(res, am[1]);
    }

    const m = pathname.match(/^\/api\/(tasks|projects|archive|units)$/);
    if(m && req.method === "PUT"){
      if(!sameOriginOk(req)) return send(res, 403, { error: "Yasak" });
      if(!/^application\/json/i.test(req.headers["content-type"] || "")) return send(res, 415, { error: "Content-Type application/json olmalı" });
      const raw = await readBody(req);
      let parsed;
      try{ parsed = JSON.parse(raw); }catch(e){ return send(res, 400, { error: "Geçersiz JSON" }); }
      const items = parsed && parsed.items;
      if(!Array.isArray(items) || !items.every(x => x && typeof x === "object" && !Array.isArray(x))){
        return send(res, 400, { error: "items nesnelerden oluşan bir dizi olmalı" });
      }
      const updatedAt = await writeKind(m[1], items, parsed.baseUpdatedAt);
      return send(res, 200, { ok: true, count: items.length, updatedAt });
    }

    if(pathname.startsWith("/api/")) return send(res, 404, { error: "Bulunamadı" });
    if(req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "İzin verilmeyen yöntem");
    return serveStatic(req, res, pathname);
  }catch(e){
    const status = e.status || 500;
    send(res, status, { error: e.message || "Sunucu hatası" });
  }
});

server.on("error", e => {
  if(e.code === "EADDRINUSE"){
    console.error("Port " + PORT + " zaten kullanımda. Uygulama başka bir pencerede çalışıyor olabilir ya da PORT ortam değişkeniyle farklı bir port seçin.");
  } else {
    console.error("Sunucu hatası:", e.message);
  }
  process.exit(1);
});

/* Yedek, port başarıyla açıldıktan sonra alınır; böylece "port dolu" ile biten açılışlar eski yedekleri döndürmez. */
server.listen(PORT, HOST, () => {
  try{ backupOnStartup(); }catch(e){ console.error("Yedek alınamadı:", e.message); }
  try{ cleanupOrphanAttachments(); }catch(e){ console.error("Ek temizliği atlandı:", e.message); }
  console.log("İş Takip çalışıyor:  http://" + (HOST === "127.0.0.1" ? "localhost" : HOST) + ":" + PORT);
  console.log("Veri klasörü:        " + DATA_DIR);
  const extra = readModels().length;
  console.log("AI asistan:          OpenRouter " + (process.env.OPENROUTER_API_KEY ? "hazır (" + AI_MODEL + ")" : "kapalı — .env dosyasında OPENROUTER_API_KEY yok") +
    (extra ? " · " + extra + " ek model kayıtlı" : ""));
  console.log("Kapatmak için bu pencerede Ctrl+C.");
});
