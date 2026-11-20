/* İş Takip — bağımlılıksız zengin metin editörü ve HTML temizleyici.
   RichEditor.sanitize(html)  → beyaz listeden geçmiş güvenli HTML
   RichEditor.toPlain(html)   → düz metin (arama ve kart önizlemesi için)
   RichEditor.fromPlain(text) → eski düz metin açıklamaları HTML'e çevirir
   RichEditor.create(host, { onImage(file) → Promise<src>, onAttach() }) → { getHtml, setHtml, focus } */
export const RichEditor = (function(){

/* İzinli etiketler; burada olmayanların kendisi atılır, içeriği korunur. */
var ALLOWED = { P:1, DIV:1, BR:1, B:1, STRONG:1, I:1, EM:1, U:1, S:1, STRIKE:1, H3:1, H4:1, UL:1, OL:1, LI:1, BLOCKQUOTE:1, A:1, IMG:1,
  TABLE:1, THEAD:1, TBODY:1, TR:1, TD:1, TH:1 };   // tablolar (Excel'den yapıştırma) özniteliksiz korunur
/* İçeriğiyle birlikte tamamen atılanlar */
var DROP = { SCRIPT:1, STYLE:1, IFRAME:1, OBJECT:1, EMBED:1, NOSCRIPT:1, TEMPLATE:1, HEAD:1, TITLE:1, META:1, LINK:1, SVG:1, MATH:1, FORM:1, INPUT:1, BUTTON:1, SELECT:1, TEXTAREA:1 };
var RENAME = { STRONG:"B", EM:"I", STRIKE:"S", H1:"H3", H2:"H3", H5:"H4", H6:"H4" };
var ATT_SRC = /^\/api\/attachments\/[\w-]{1,64}$/;
var SAFE_HREF = /^(https?:|mailto:)/i;

function escText(s){
  return String(s).replace(/[&<>"]/g, function(c){ return { "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" }[c]; });
}

function cleanNode(src, doc){
  if(src.nodeType === 3) return doc.createTextNode(src.nodeValue);
  if(src.nodeType !== 1) return null;
  var tag = src.tagName.toUpperCase();
  if(DROP[tag]) return null;
  tag = RENAME[tag] || tag;
  var out;
  if(!ALLOWED[tag]){
    out = doc.createDocumentFragment();
    appendChildren(src, out, doc);
    /* blok etiketler (section, pre vb.) metni bir sonrakine yapıştırmasın */
    if(/^(SECTION|ARTICLE|HEADER|FOOTER|PRE|DL|DT|DD|FIGURE)$/.test(src.tagName.toUpperCase())) out.appendChild(doc.createElement("br"));
    return out;
  }
  out = doc.createElement(tag.toLowerCase());
  if(tag === "A"){
    var href = (src.getAttribute("href") || "").trim();
    if(SAFE_HREF.test(href)){ out.setAttribute("href", href); out.setAttribute("target", "_blank"); out.setAttribute("rel", "noopener noreferrer"); }
  } else if(tag === "IMG"){
    var s = (src.getAttribute("src") || "").trim();
    if(!ATT_SRC.test(s)) return null;      // yalnızca bu uygulamaya yüklenmiş resimler
    out.setAttribute("src", s);
    var alt = src.getAttribute("alt"); if(alt) out.setAttribute("alt", alt.slice(0, 200));
    return out;
  }
  appendChildren(src, out, doc);
  return out;
}
function appendChildren(src, out, doc){
  for(var c = src.firstChild; c; c = c.nextSibling){
    var n = cleanNode(c, doc);
    if(n) out.appendChild(n);
  }
}

function sanitize(html){
  html = String(html == null ? "" : html);
  if(!html) return "";
  if(typeof DOMParser === "undefined") return escText(html); // tarayıcı dışı ortam: güvenli tarafta kal
  var parsed = new DOMParser().parseFromString("<body>" + html + "</body>", "text/html");
  var holder = parsed.createElement("div");
  appendChildren(parsed.body, holder, parsed);
  var out = holder.innerHTML;
  /* yalnızca boşluk/boş satırdan oluşan içerik → boş */
  return /^(\s|<br>|<p>(\s|<br>)*<\/p>|<div>(\s|<br>)*<\/div>)*$/.test(out) ? "" : out;
}

function toPlain(html){
  html = String(html || "");
  if(!html) return "";
  if(typeof DOMParser === "undefined") return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  var doc = new DOMParser().parseFromString("<body>" + html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|h3|h4|blockquote|tr)>/gi, "\n$&").replace(/<\/(td|th)>/gi, " $&") + "</body>", "text/html");
  return (doc.body.textContent || "").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
}

function fromPlain(text){
  text = String(text || "");
  return text ? escText(text).replace(/\r?\n/g, "<br>") : "";
}

/* ---------- Editör ---------- */
var SV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">';
var TOOLS = [
  { cmd:"bold",          title:"Kalın (Ctrl+B)",        html:"<b>K</b>" },
  { cmd:"italic",        title:"İtalik (Ctrl+I)",       html:"<i>İ</i>" },
  { cmd:"underline",     title:"Altı çizili (Ctrl+U)",  html:"<u>A</u>" },
  { cmd:"strikeThrough", title:"Üstü çizili",           html:"<s>Ü</s>" },
  { sep:true },
  { cmd:"formatBlock", arg:"h3", title:"Başlık",        html:"<b>B</b>" },
  { cmd:"insertUnorderedList", title:"Madde listesi",   html:SV + '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/></svg>' },
  { cmd:"insertOrderedList",   title:"Numaralı liste",  html:SV + '<path d="M10 6h10M10 12h10M10 18h10"/><path d="M4 4v4M3 18h3l-3 2.5h3"/><path d="M3 12h2.5L3 14.5"/></svg>' },
  { cmd:"formatBlock", arg:"blockquote", title:"Alıntı", html:SV + '<path d="M7 7H4v6h3l-1 4M17 7h-3v6h3l-1 4"/></svg>' },
  { sep:true },
  { cmd:"link",          title:"Bağlantı ekle",         html:SV + '<path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg>' },
  { cmd:"removeFormat",  title:"Biçimi temizle",        html:SV + '<path d="M4 7V5h12v2M10 5l-3 14M14 19H6"/><path d="m16 14 5 5M21 14l-5 5"/></svg>' },
  { sep:true },
  { cmd:"attach",        title:"Dosya ekle",            html:SV + '<path d="m21 11-8.5 8.5a5 5 0 0 1-7-7L14 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 7"/></svg>', label:"Ek" }
];

function create(host, opts){
  opts = opts || {};
  host.classList.add("rte");
  host.innerHTML =
    '<div class="rte-toolbar">' + TOOLS.map(function(t, i){
      if(t.sep) return '<span class="rte-sep"></span>';
      return '<button type="button" class="rte-btn" data-tool="' + i + '" title="' + t.title + '" aria-label="' + t.title + '">' + t.html + (t.label ? '<span>' + t.label + '</span>' : "") + '</button>';
    }).join("") + '</div>' +
    '<div class="rte-area" contenteditable="true" role="textbox" aria-multiline="true" data-placeholder="' +
      escText(opts.placeholder || "İşin kapsamı, beklenen çıktı… (resim yapıştırabilirsiniz)") + '"></div>';
  var area = host.querySelector(".rte-area");
  try{ document.execCommand("defaultParagraphSeparator", false, "p"); }catch(e){}

  function exec(cmd, arg){ area.focus(); document.execCommand(cmd, false, arg); }

  host.querySelector(".rte-toolbar").addEventListener("mousedown", function(e){
    if(e.target.closest(".rte-btn")) e.preventDefault();   // seçim kaybolmasın
  });
  host.querySelector(".rte-toolbar").addEventListener("click", function(e){
    var b = e.target.closest(".rte-btn"); if(!b) return;
    var t = TOOLS[+b.getAttribute("data-tool")];
    if(t.cmd === "attach"){ if(opts.onAttach) opts.onAttach(); return; }
    if(t.cmd === "link"){
      var url = window.prompt ? window.prompt("Bağlantı adresi (https://…)", "https://") : "";
      if(url && SAFE_HREF.test(url.trim())) exec("createLink", url.trim());
      return;
    }
    if(t.cmd === "formatBlock"){
      var cur = (document.queryCommandValue("formatBlock") || "").toLowerCase();
      exec("formatBlock", cur === t.arg ? "p" : t.arg);
      return;
    }
    exec(t.cmd, t.arg);
  });

  function insertImages(files){
    files.forEach(function(f){
      if(!opts.onImage) return;
      opts.onImage(f).then(function(src){
        if(src) exec("insertHTML", '<img src="' + src + '" alt="">');
      });
    });
  }
  function imageFiles(list){
    return Array.prototype.filter.call(list || [], function(f){ return f && /^image\//.test(f.type); });
  }

  area.addEventListener("paste", function(e){
    var cd = e.clipboardData; if(!cd) return;
    var imgs = imageFiles(cd.files);
    var html = cd.getData("text/html");
    if(imgs.length && !html){ e.preventDefault(); insertImages(imgs); return; }
    e.preventDefault();
    if(html) exec("insertHTML", sanitize(html));
    else exec("insertHTML", fromPlain(cd.getData("text/plain")));
  });
  area.addEventListener("drop", function(e){
    var files = e.dataTransfer && e.dataTransfer.files;
    if(!files || !files.length) return;
    e.preventDefault();
    var imgs = imageFiles(files);
    if(imgs.length) insertImages(imgs);
    var others = Array.prototype.filter.call(files, function(f){ return imgs.indexOf(f) === -1; });
    if(others.length && opts.onFiles) opts.onFiles(others);
  });
  area.addEventListener("click", function(e){
    var a = e.target.closest("a[href]");
    if(a && (e.ctrlKey || e.metaKey)){ e.preventDefault(); window.open(a.href, "_blank", "noopener"); }
  });

  return {
    getHtml: function(){ return sanitize(area.innerHTML); },
    setHtml: function(html){ area.innerHTML = sanitize(html); },
    focus: function(){ area.focus(); },
    element: area
  };
}

return { sanitize: sanitize, toPlain: toPlain, fromPlain: fromPlain, create: create };
})();
