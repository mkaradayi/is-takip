/* API rotaları (tek giriş: handle) */
"use strict";
const path = require("path");
const { aiChat } = require("./ai-board");
const { publicModels, saveModels, testModel } = require("./ai-common");
const { aiProject } = require("./ai-project");
const { attText, saveAttachment, serveAttachment } = require("./attachments");
const { DATA_DIR, KINDS, MAX_UPLOAD, SAFE_ID } = require("./config");
const { backupDb, getDb, readKindFull, writeKind } = require("./db");
const { readBody, sameOriginOk, send } = require("./http-util");
const { serveStatic } = require("./static");

async function handle(req, res){
  try{
    const url = new URL(req.url, "http://" + (req.headers.host || "localhost"));
    if(!getDb() && url.pathname.startsWith("/api/")) return send(res, 503, { error: "Sunucu hazırlanıyor, birazdan tekrar deneyin" });
    const pathname = url.pathname;

    if(pathname === "/api/state" && req.method === "GET"){
      if(!sameOriginOk(req)) return send(res, 403, { error: "Yasak" });
      const out = { meta: {} };
      for(const k of KINDS){
        try{ const r = readKindFull(k); out[k] = r.items; out.meta[k] = r.updatedAt; }
        catch(e){ return send(res, 500, { error: "Veritabanındaki " + k + " kayıtları okunamadı: " + e.message }); }
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

    if(pathname === "/api/ai/project" && req.method === "POST"){
      if(!sameOriginOk(req)) return send(res, 403, { error: "Yasak" });
      if(!/^application\/json/i.test(req.headers["content-type"] || "")) return send(res, 415, { error: "Content-Type application/json olmalı" });
      let parsed;
      try{ parsed = JSON.parse(await readBody(req, 1024 * 1024)); }catch(e){ if(e.status) throw e; return send(res, 400, { error: "Geçersiz JSON" }); }
      return send(res, 200, await aiProject(parsed));
    }

    if(pathname === "/api/ai/chat" && req.method === "POST"){
      if(!sameOriginOk(req)) return send(res, 403, { error: "Yasak" });
      if(!/^application\/json/i.test(req.headers["content-type"] || "")) return send(res, 415, { error: "Content-Type application/json olmalı" });
      let parsed;
      try{ parsed = JSON.parse(await readBody(req, 1024 * 1024)); }catch(e){ if(e.status) throw e; return send(res, 400, { error: "Geçersiz JSON" }); }
      return send(res, 200, await aiChat(parsed));
    }

    if(pathname === "/api/backup" && req.method === "POST"){
      if(!sameOriginOk(req)) return send(res, 403, { error: "Yasak" });
      let label = "";
      try{ const b = JSON.parse((await readBody(req, 4096)) || "{}"); label = typeof b.label === "string" ? b.label : ""; }catch(e){ if(e.status) throw e; }
      if(label && !/^[\w-]{1,40}$/.test(label)) return send(res, 400, { error: "Geçersiz yedek etiketi" });
      const f = backupDb(label);
      return send(res, 200, { ok: true, file: path.relative(DATA_DIR, f) });
    }

    /* Eklerden metin çıkarma durumu: { ids: [...] } → { items: { id: { status, chars, reason } } } (metnin kendisi dönmez) */
    if(pathname === "/api/attachments/text-status" && req.method === "POST"){
      if(!sameOriginOk(req)) return send(res, 403, { error: "Yasak" });
      if(!/^application\/json/i.test(req.headers["content-type"] || "")) return send(res, 415, { error: "Content-Type application/json olmalı" });
      let parsed;
      try{ parsed = JSON.parse(await readBody(req, 64 * 1024)); }catch(e){ if(e.status) throw e; return send(res, 400, { error: "Geçersiz JSON" }); }
      const list = (Array.isArray(parsed && parsed.ids) ? parsed.ids : []).filter(x => typeof x === "string" && SAFE_ID.test(x)).slice(0, 300);
      const items = {};
      list.forEach(id => { const r = attText(id); items[id] = { status: r.status, chars: r.text.length, reason: r.reason || "" }; });
      return send(res, 200, { items });
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

    const m = pathname.match(/^\/api\/(tasks|projects|archive|units|reminders|memos|projectNotes)$/);
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
}

module.exports = { handle };
