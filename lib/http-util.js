/* HTTP yardımcıları: yanıt, gövde okuma, aynı kaynak (Host + Origin) denetimi */
"use strict";
const { HOST, MAX_BODY, PORT } = require("./config");

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

/* HTML sayfalarında "<!-- @include partials/ad.html -->" satırları o parçanın içeriğiyle değiştirilir.
   Yalnızca public/partials/ altındaki düz adlı .html dosyaları kabul edilir (yol kaçışı yok); parçalar iç içe değildir. */

module.exports = { send, readBody, sameOriginOk };
