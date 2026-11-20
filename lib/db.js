/* SQLite veri katmanı: açma, okuma, tek işlemde yazma + 409, JSON göçü, yedek */
"use strict";
const fs = require("fs");
const path = require("path");
const { ATT_DIR, BACKUP_DIR, DATA_DIR, KINDS, TMP_DIR } = require("./config");
const { renameWithRetry } = require("./fs-util");

/* ---------- SQLite (Node'un yerleşik node:sqlite modülü; bağımlılık yok) ---------- */
let DatabaseSync;
try{ ({ DatabaseSync } = require("node:sqlite")); }
catch(e){
  console.error("Bu Node.js sürümü (" + process.version + ") yerleşik SQLite içermiyor. En az Node.js 22.13 gerekli: https://nodejs.org");
  process.exit(1);
}
const DB_FILE = path.join(DATA_DIR, "is-takip.db");
const DB_VERSION = 1;
/* Veritabanı, port başarıyla açıldıktan SONRA açılır (bkz. startStorage). Böylece aynı portta eski bir sunucu
   çalışırken JSON'dan göç yapılmaz; o sunucu JSON'a yazmaya devam edip verinin ikiye bölünmesine yol açamaz. */
let db = null;

function openDb(){
  const d = new DatabaseSync(DB_FILE);
  /* WAL yerine klasik günlük (DELETE): her kayıttan sonra .db dosyasının kendisi tam ve tutarlıdır.
     (WAL'da süreç zorla kapatılınca veri -wal dosyasında kalır; .db tek başına kopyalanırsa/git'e girerse eksik olur.
     Tek kullanıcılı bu uygulamada WAL'ın eşzamanlılık avantajına ihtiyaç yok.) */
  d.exec("PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
  const chk = d.prepare("PRAGMA quick_check").get();
  if(!chk || Object.values(chk)[0] !== "ok"){
    d.close();
    throw new Error("Veritabanı bozuk görünüyor (" + JSON.stringify(chk) + "). data/backup içindeki en son .db yedeğini data/is-takip.db adıyla geri koyun.");
  }
  d.exec(`
    CREATE TABLE IF NOT EXISTS meta(kind TEXT PRIMARY KEY, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS items(kind TEXT NOT NULL, pos INTEGER NOT NULL, id TEXT, data TEXT NOT NULL, PRIMARY KEY(kind, pos));
    CREATE INDEX IF NOT EXISTS items_kind_id ON items(kind, id);
    CREATE TABLE IF NOT EXISTS attachments(id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, size INTEGER NOT NULL, uploaded_at TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS att_text(id TEXT PRIMARY KEY, text TEXT NOT NULL DEFAULT '', status TEXT NOT NULL, extracted_at TEXT NOT NULL);
  `);
  const v = d.prepare("PRAGMA user_version").get().user_version;
  if(v > DB_VERSION){ d.close(); throw new Error("Veritabanı bu uygulamadan daha yeni bir sürümle oluşturulmuş (şema " + v + ")."); }
  if(v < DB_VERSION) d.exec("PRAGMA user_version = " + DB_VERSION);
  return d;
}
/* Tek işlem: hepsi ya yazılır ya hiçbiri */
function tx(fn){
  db.exec("BEGIN IMMEDIATE");
  try{ const r = fn(); db.exec("COMMIT"); return r; }
  catch(e){ try{ db.exec("ROLLBACK"); }catch(_){} throw e; }
}
function stamp(){
  const d = new Date(), pad = n => String(n).padStart(2, "0");
  return d.getFullYear() + pad(d.getMonth()+1) + pad(d.getDate()) + "-" + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
}

/* ---------- Okuma ---------- */
/* { items, updatedAt } döner. updatedAt, istemcinin çakışma kontrolü için kullandığı sürüm damgasıdır. */
function readKindFull(kind){
  const m = db.prepare("SELECT updated_at FROM meta WHERE kind = ?").get(kind);
  const rows = db.prepare("SELECT data FROM items WHERE kind = ? ORDER BY pos").all(kind);
  return { items: rows.map(r => JSON.parse(r.data)), updatedAt: m ? m.updated_at : "" };
}

/* ---------- Yazma ---------- */
/* Bir türün tüm kayıtlarını değiştirir (işlem içinde çağrılmalı) */
function putItems(kind, items, updatedAt){
  db.prepare("DELETE FROM items WHERE kind = ?").run(kind);
  const ins = db.prepare("INSERT INTO items(kind, pos, id, data) VALUES (?, ?, ?, ?)");
  items.forEach((it, i) => ins.run(kind, i, typeof it.id === "string" ? it.id : null, JSON.stringify(it)));
  db.prepare("INSERT INTO meta(kind, updated_at) VALUES (?, ?) ON CONFLICT(kind) DO UPDATE SET updated_at = excluded.updated_at").run(kind, updatedAt);
}
/* baseUpdatedAt verilmişse ve kayıtlı sürümle uyuşmuyorsa (başka sekme/pencere yazmış) 409 ile reddeder.
   Eski arayüzle uyum için Promise döner; işin kendisi senkron ve tek işlemdir. */
function writeKind(kind, items, baseUpdatedAt){
  try{
    return Promise.resolve(tx(() => {
      const m = db.prepare("SELECT updated_at FROM meta WHERE kind = ?").get(kind);
      const cur = m ? m.updated_at : "";
      if(typeof baseUpdatedAt === "string" && cur !== baseUpdatedAt){
        throw Object.assign(new Error("Veri başka bir pencerede değişti"), { status: 409 });
      }
      let updatedAt = new Date().toISOString();
      /* Aynı milisaniyede iki yazım aynı damgayı almasın (çakışma kontrolü kör kalırdı) */
      const t = Date.parse(cur);
      if(updatedAt <= cur && !isNaN(t)) updatedAt = new Date(t + 1).toISOString();
      putItems(kind, items, updatedAt);
      return updatedAt;
    }));
  }catch(e){ return Promise.reject(e); }
}

/* ---------- JSON dosyalarından bir kerelik göç ---------- */
function legacyFile(kind){ return path.join(DATA_DIR, kind + ".json"); }
function readLegacyKind(kind){
  const text = fs.readFileSync(legacyFile(kind), "utf8").replace(/^﻿/, "").trim();
  if(!text) return { items: [], updatedAt: "" };
  const data = JSON.parse(text);   // bozuksa hata fırlatır → göç yapılmaz, sunucu durur
  const out = Array.isArray(data) ? { items: data, updatedAt: "" }
    : data && Array.isArray(data.items) ? { items: data.items, updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : "" }
    : null;
  if(!out) throw new Error(kind + ".json beklenen biçimde değil");
  if(!out.items.every(x => x && typeof x === "object" && !Array.isArray(x))) throw new Error(kind + ".json içinde nesne olmayan kayıt var");
  return out;
}
/* Veritabanı boşsa data/*.json ve attachments/*.json dosyalarını tek işlemde içe aktarır.
   Özgün dosyalar silinmez; data/json-yedek-<zaman>/ klasörüne taşınır. */
function migrateFromJson(){
  const files = KINDS.filter(k => fs.existsSync(legacyFile(k)));
  const attMetas = fs.readdirSync(ATT_DIR).filter(n => /^[\w-]{1,64}\.json$/.test(n));
  const filled = db.prepare("SELECT (SELECT COUNT(*) FROM meta) + (SELECT COUNT(*) FROM items) AS n").get().n > 0;
  if(filled){
    if(files.length) console.warn("Uyarı: veritabanı dolu olduğu için şu eski JSON dosyaları yok sayıldı: " + files.map(k => k + ".json").join(", "));
    return;
  }
  if(!files.length && !attMetas.length) return;

  const data = {};
  for(const k of files) data[k] = readLegacyKind(k);
  const atts = [];
  for(const n of attMetas){
    const id = n.slice(0, -5);
    try{
      const m = JSON.parse(fs.readFileSync(path.join(ATT_DIR, n), "utf8"));
      atts.push({ id, name: String(m.name || "dosya").slice(0, 200), type: String(m.type || "application/octet-stream"), size: +m.size || 0, uploadedAt: String(m.uploadedAt || "") });
    }catch(e){ console.warn("Uyarı: ek bilgisi okunamadı, atlandı: attachments/" + n); }
  }
  const now = new Date().toISOString();
  tx(() => {
    for(const k of files) putItems(k, data[k].items, data[k].updatedAt || now);
    const ins = db.prepare("INSERT OR REPLACE INTO attachments(id, name, type, size, uploaded_at) VALUES (?, ?, ?, ?, ?)");
    atts.forEach(a => ins.run(a.id, a.name, a.type, a.size, a.uploadedAt));
  });

  const dest = path.join(DATA_DIR, "json-yedek-" + stamp());
  fs.mkdirSync(path.join(dest, "attachments-meta"), { recursive: true });
  const move = (from, to) => { try{ renameWithRetry(from, to); }catch(e){ console.warn("Uyarı: taşınamadı (" + e.code + "): " + from); } };
  files.forEach(k => move(legacyFile(k), path.join(dest, k + ".json")));
  attMetas.forEach(n => move(path.join(ATT_DIR, n), path.join(dest, "attachments-meta", n)));
  console.log("JSON'dan SQLite'a göç edildi: " + files.map(k => data[k].items.length + " " + k).join(", ") +
    ", " + atts.length + " ek bilgisi. Özgün dosyalar: " + dest);
}

function startStorage(){
  db = openDb();
  migrateFromJson();
}
function closeStorage(){ if(db){ try{ db.close(); }catch(e){} db = null; } }


/* ---------- Yedek ---------- */
/* Yalnızca TEK yedek tutulur (kullanıcı tercihi): yeni yedek başarıyla alındıktan sonra diğer tüm yedekler
   (eski .db dosyaları ve JSON dönemi klasörleri, demo-oncesi-* dahil) silinir. Yedek alınamazsa eskiler korunur. */
/* VACUUM INTO: o anki veritabanının tutarlı, tek dosyalık kopyası */
function backupDb(label){
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const base = (label ? label + "-" : "") + stamp();
  let f = path.join(BACKUP_DIR, base + ".db");
  for(let i = 2; fs.existsSync(f); i++) f = path.join(BACKUP_DIR, base + "-" + i + ".db");
  db.prepare("VACUUM INTO ?").run(f);
  pruneBackups(f);
  return f;
}
/* .zip de yedek sayılır (geri yükleme öncesi tam yedek: backup/geri-yukleme-oncesi-<zaman>.zip) */
function pruneBackups(keep){
  fs.readdirSync(BACKUP_DIR).forEach(n => {
    const p = path.join(BACKUP_DIR, n);
    if(p === keep) return;
    try{
      const st = fs.statSync(p);
      if(st.isDirectory() || n.endsWith(".db") || n.endsWith(".zip")) fs.rmSync(p, { recursive: true, force: true });
    }catch(e){ console.warn("Uyarı: eski yedek silinemedi: " + n + " (" + e.code + ")"); }
  });
}
/* Tam yedek (.zip) için geçici, tutarlı kopya: data/tmp/ altına (tek yedek kuralı ve pruneBackups buraya dokunmaz). Çağıran siler. */
function snapshotDb(){
  fs.mkdirSync(TMP_DIR, { recursive: true });
  const f = path.join(TMP_DIR, "snapshot-" + stamp() + "-" + process.hrtime.bigint() + ".db");
  db.prepare("VACUUM INTO ?").run(f);
  return f;
}
/* Yedek manifesti için özet: tür başına kayıt sayısı, ek sayısı, şema sürümü */
function dbInfo(){
  const counts = {};
  KINDS.forEach(k => { counts[k] = 0; });
  db.prepare("SELECT kind, COUNT(*) AS n FROM items GROUP BY kind").all().forEach(r => { if(r.kind in counts) counts[r.kind] = r.n; });
  return { counts, dbVersion: db.prepare("PRAGMA user_version").get().user_version };
}
function backupOnStartup(){
  if(!db.prepare("SELECT COUNT(*) AS n FROM items").get().n) return;   // boş veritabanının yedeği alınmaz (eskiler korunur)
  backupDb("");
}


/* Diğer modüller veritabanına bu fonksiyonla erişir (db yeniden açılabildiği için değer değil, erişimci) */
function getDb(){ return db; }

module.exports = { getDb, startStorage, closeStorage, backupOnStartup, readKindFull, writeKind, backupDb, pruneBackups, snapshotDb, dbInfo, stamp, DB_FILE, DB_VERSION };
