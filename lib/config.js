/* Ayarlar: .env okuma, port/klasör sabitleri, türler, MIME tablosu */
"use strict";
const fs = require("fs");
const path = require("path");

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
loadEnv(path.join(__dirname, "..", ".env"));

const PORT = parseInt(process.env.PORT, 10) || 3000;
const HOST = process.env.HOST || "127.0.0.1";
const ROOT = path.join(__dirname, "..");   // proje kökü (lib/ bir alt klasör)
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, "data");
const BACKUP_DIR = path.join(DATA_DIR, "backup");
const ATT_DIR = path.join(DATA_DIR, "attachments");
const KINDS = ["tasks", "projects", "archive", "units", "reminders", "memos", "projectNotes"];
const MAX_BODY = 10 * 1024 * 1024;
const MAX_UPLOAD = 25 * 1024 * 1024;
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

module.exports = { PORT, HOST, PUBLIC_DIR, DATA_DIR, BACKUP_DIR, ATT_DIR, KINDS, MAX_BODY, MAX_UPLOAD, ORPHAN_AGE_MS, SAFE_ID, INLINE_TYPES, MIME };
