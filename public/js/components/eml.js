/* İş Takip — .eml (MIME) taslak oluşturucu.
   Outlook, "X-Unsent: 1" başlıklı .eml dosyasını gönderilmemiş, düzenlenebilir bir taslak olarak açar.
   Eml.build({ subject, html, text, to:[{ name, email }], cc:[{ name, email }], inline:[{ cid, name, type, bytes }], attachments:[{ name, type, bytes }] }) → string
   Yapı: multipart/mixed → [ multipart/alternative → [ text/plain, multipart/related → [ text/html, resimler ] ], ekler ] */
export const Eml = (function(){
var CRLF = "\r\n";

function utf8(s){ return new TextEncoder().encode(String(s)); }

function b64(bytes){
  var out = "", CH = 0x8000;
  for(var i = 0; i < bytes.length; i += CH){
    out += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  }
  return btoa(out);
}
function wrap76(s){ return s.replace(/.{1,76}/g, "$&" + CRLF); }

/* RFC 2047 kodlanmış sözcük; uzun metinler 75 karakteri aşmasın diye parçalanır */
function encWord(s){
  s = String(s);
  if(/^[\x20-\x7e]*$/.test(s)) return s;
  var parts = [], chars = Array.from(s);
  for(var i = 0; i < chars.length; i += 12) parts.push("=?UTF-8?B?" + b64(utf8(chars.slice(i, i + 12).join(""))) + "?=");
  return parts.join(CRLF + " ");
}
/* Dosya adları tırnak içinde olduğundan katlanmaz; tek kodlanmış sözcük olarak yazılır (Outlook bunu doğru çözer). */
function quotedName(s){
  s = String(s).replace(/["\\\r\n]/g, "_");
  return '"' + (/^[\x20-\x7e]*$/.test(s) ? s : "=?UTF-8?B?" + b64(utf8(s)) + "?=") + '"';
}

function boundary(tag){ return "----=_IsTakip_" + tag + "_" + Math.random().toString(36).slice(2) + Date.now().toString(36); }

function textPart(type, str){
  return "Content-Type: " + type + "; charset=UTF-8" + CRLF +
    "Content-Transfer-Encoding: base64" + CRLF + CRLF + wrap76(b64(utf8(str)));
}
function binaryPart(f, disposition){
  var type = /^[\w.+-]+\/[\w.+-]+$/.test(f.type || "") ? f.type : "application/octet-stream";
  var h = "Content-Type: " + type + "; name=" + quotedName(f.name) + CRLF +
    "Content-Transfer-Encoding: base64" + CRLF +
    "Content-Disposition: " + disposition + "; filename=" + quotedName(f.name) + CRLF;
  if(f.cid) h += "Content-ID: <" + f.cid + ">" + CRLF;
  return h + CRLF + wrap76(b64(f.bytes));
}
function multipart(type, parts){
  var b = boundary(type.split("/")[1]);
  return { header: "Content-Type: " + type + '; boundary="' + b + '"',
    body: parts.map(function(p){ return "--" + b + CRLF + p + CRLF; }).join("") + "--" + b + "--" + CRLF };
}
function asPart(mp){ return mp.header + CRLF + CRLF + mp.body; }

function rfcDate(d){
  var days = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"], mons = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  var off = -d.getTimezoneOffset(), sign = off >= 0 ? "+" : "-"; off = Math.abs(off);
  var p = function(n){ return (n < 10 ? "0" : "") + n; };
  return days[d.getDay()] + ", " + p(d.getDate()) + " " + mons[d.getMonth()] + " " + d.getFullYear() + " " +
    p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds()) + " " + sign + p(Math.floor(off / 60)) + p(off % 60);
}

/* Alıcı listesi: "Ad" <adres> öğeleri, her biri ayrı satıra katlanır (satır uzunluğu sınırı).
   Adres burada son kez denetlenir: boşluk/CR/LF, <>",; içeren adres başlığa yazılmaz (başlık enjeksiyonu). */
var ADDR_RE = /^[^\s<>",;:@()\[\]\\]+@[^\s<>",;:@()\[\]\\]+$/;
function addrList(list){
  return (list || []).filter(function(r){ return r && ADDR_RE.test(r.email || ""); }).map(function(r){
    var name = String(r.name || "").replace(/[\r\n]+/g, " ").trim();
    if(!name) return r.email;
    var disp = /^[\x20-\x7e]*$/.test(name) ? '"' + name.replace(/["\\]/g, "\\$&") + '"' : encWord(name);
    return disp + " <" + r.email + ">";
  }).join("," + CRLF + " ");
}
function build(o){
  var inline = o.inline || [], atts = o.attachments || [];
  var htmlPart = textPart("text/html", o.html || "");
  var related = inline.length
    ? asPart(multipart("multipart/related", [htmlPart].concat(inline.map(function(f){ return binaryPart(f, "inline"); }))))
    : htmlPart;
  var alt = multipart("multipart/alternative", [textPart("text/plain", o.text || ""), related]);
  var root = atts.length
    ? multipart("multipart/mixed", [asPart(alt)].concat(atts.map(function(f){ return binaryPart(f, "attachment"); })))
    : alt;
  var cc = addrList(o.cc);
  return [
    "X-Unsent: 1",
    "To: " + addrList(o.to)
  ].concat(cc ? ["Cc: " + cc] : []).concat([
    "Subject: " + encWord(o.subject || ""),
    "Date: " + rfcDate(new Date()),
    "MIME-Version: 1.0",
    root.header,
    "",
    root.body
  ]).join(CRLF);
}

return { build: build };
})();
