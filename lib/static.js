/* Statik dosyalar ve HTML parçalarının (partials) birleştirilmesi */
"use strict";
const fs = require("fs");
const path = require("path");
const { MIME, PUBLIC_DIR } = require("./config");
const { send } = require("./http-util");

const INCLUDE_RE = /^([ \t]*)<!-- @include partials\/([\w-]+)\.html -->[ \t]*$/gm;
function buildPage(html){
  return html.replace(INCLUDE_RE, (_, indent, name) => {
    const text = fs.readFileSync(path.join(PUBLIC_DIR, "partials", name + ".html"), "utf8").replace(/\s+$/, "");
    return text.split("\n").map(s => s ? indent + s : s).join("\n");
  });
}

function serveStatic(req, res, pathname){
  let rel;
  try{ rel = decodeURIComponent(pathname); }catch(e){ return send(res, 400, "Geçersiz adres"); }
  if(rel === "/" ) rel = "/index.html";
  const full = path.normalize(path.join(PUBLIC_DIR, rel));
  if(!full.startsWith(PUBLIC_DIR + path.sep) && full !== PUBLIC_DIR) return send(res, 403, "Yasak");
  fs.readFile(full, (err, buf) => {
    if(!err && path.extname(full).toLowerCase() === ".html"){
      try{ buf = Buffer.from(buildPage(buf.toString("utf8")), "utf8"); }
      catch(e){ console.error("Sayfa birleştirilemedi:", e.message); return send(res, 500, "Sayfa parçası eksik: " + e.message); }
    }
    if(err) return send(res, 404, "Bulunamadı");
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(full).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-cache"
    });
    res.end(buf);
  });
}

module.exports = { serveStatic };
