/* Aranabilir seçici (çoklu ya da tekli). Bağımlılıksız; açılır liste <body>'ye eklenir (modal içinde kırpılmasın diye).
   MultiSelect.create(host, {
     multiple: true,                       // false: tekli seçim (seçince kapanır)
     placeholder, searchPlaceholder, emptyText,
     options: () => [{ value, label, color?, parent?, hint?, avatar?, hidden? }],
        // parent: üst seçeneğin value'su (girintili gösterilir); hidden: listede görünmez ama seçiliyse çip olur (ör. silinmiş kayıt)
     linkParents: true,                    // alt seçenek seçilince üstü de seçilir; üst kaldırılınca altları da kalkar
     onChange(values)
   }) → { get(), set(values), refresh(), close(), isOpen() }
   Değerler, etiketler ve renkler HTML'e esc() ile / doğrulanmış renk olarak yazılır. */
import { esc } from "../core/utils.js";

var CARET = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';
var CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7"/></svg>';
var HEX = /^#[0-9a-f]{6}$/i;
function color(c){ return HEX.test(c) ? c : "#9AA1AD"; }
/* Türkçe küçük harf + "ı" = "i" (core/domain.js'teki searchKey ile aynı) */
function searchKey(s){ return String(s || "").toLocaleLowerCase("tr").replace(/ı/g, "i"); }

export var MultiSelect = { create: create };

function create(host, o){
  o = Object.assign({ multiple: true, placeholder: "Seçin…", searchPlaceholder: "Ara…", emptyText: "Eşleşme yok", linkParents: false }, o);
  var values = [], open = false, active = -1, visible = [];
  host.classList.add("ms");
  host.innerHTML = '<div class="ms-control" tabindex="0" role="combobox" aria-haspopup="listbox" aria-expanded="false"><div class="ms-chips"></div><span class="ms-caret">' + CARET + '</span></div>';
  var control = host.querySelector(".ms-control"), chips = host.querySelector(".ms-chips");
  var pop = document.createElement("div");
  pop.className = "ms-pop";
  pop.innerHTML = '<input type="text" class="ms-search" autocomplete="off" spellcheck="false" placeholder="' + esc(o.searchPlaceholder) + '" /><div class="ms-list" role="listbox"' + (o.multiple ? ' aria-multiselectable="true"' : "") + '></div>';
  var search = pop.querySelector(".ms-search"), list = pop.querySelector(".ms-list");

  function opts(){ return o.options() || []; }
  function byValue(v){ return opts().filter(function(x){ return x.value === v; })[0]; }
  function emit(){ renderChips(); if(open) renderList(); if(o.onChange) o.onChange(values.slice()); }

  function renderChips(){
    var all = opts(), order = {};
    all.forEach(function(x, i){ order[x.value] = i; });
    var sorted = values.slice().sort(function(a, b){ return (order[a] == null ? 1e9 : order[a]) - (order[b] == null ? 1e9 : order[b]); });
    if(!sorted.length){ chips.innerHTML = '<span class="ms-placeholder">' + esc(o.placeholder) + '</span>'; return; }
    chips.innerHTML = sorted.map(function(v){
      var x = byValue(v) || { value: v, label: v };
      var mark = x.avatar ? '<span class="ms-avatar" style="background:' + color(x.color) + ';">' + esc(x.avatar) + '</span>' : '<span class="ms-dot" style="background:' + color(x.color) + ';"></span>';
      return '<span class="ms-chip' + (x.parent ? " sub" : "") + '">' + mark + '<span class="ms-chip-label">' + esc(x.label) + '</span>' +
        (o.multiple ? '<button type="button" class="ms-x" data-ms-remove="' + esc(v) + '" title="Kaldır" aria-label="' + esc(x.label) + ' kaldır">×</button>' : "") + '</span>';
    }).join("");
  }

  function renderList(){
    var q = searchKey(search.value.trim()), all = opts().filter(function(x){ return !x.hidden; });
    var match = function(x){ return !q || searchKey(x.label).indexOf(q) !== -1; };
    visible = all.filter(function(x){
      if(match(x)) return true;
      if(x.parent){ var p = all.filter(function(y){ return y.value === x.parent; })[0]; return p && match(p); }   // üst eşleştiyse altları da göster
      return all.some(function(y){ return y.parent === x.value && match(y); });                                   // altı eşleşen üst gösterilir
    });
    if(active >= visible.length) active = visible.length - 1;
    if(active < 0 && visible.length) active = 0;
    list.innerHTML = visible.length ? visible.map(function(x, i){
      var on = values.indexOf(x.value) !== -1;
      var mark = x.avatar ? '<span class="ms-avatar" style="background:' + color(x.color) + ';">' + esc(x.avatar) + '</span>' : '<span class="ms-dot" style="background:' + color(x.color) + ';"></span>';
      return '<div class="ms-opt' + (x.parent ? " sub" : "") + (on ? " on" : "") + (i === active ? " active" : "") + '" role="option" aria-selected="' + on + '" data-i="' + i + '">' +
        (o.multiple ? '<span class="ms-box">' + CHECK + '</span>' : "") + mark + '<span class="ms-label">' + esc(x.label) + '</span>' +
        (x.hint ? '<span class="ms-hint">' + esc(x.hint) + '</span>' : "") + '</div>';
    }).join("") : '<div class="ms-empty">' + esc(o.emptyText) + '</div>';
    var a = list.querySelector(".ms-opt.active");
    if(a) a.scrollIntoView({ block: "nearest" });
  }

  function toggle(x){
    if(!x) return;
    if(!o.multiple){ values = [x.value]; emit(); close(true); return; }
    var i = values.indexOf(x.value);
    if(i === -1){
      values.push(x.value);
      if(o.linkParents && x.parent && values.indexOf(x.parent) === -1) values.push(x.parent);
    } else {
      values.splice(i, 1);
      if(o.linkParents){
        var kids = opts().filter(function(y){ return y.parent === x.value; }).map(function(y){ return y.value; });
        values = values.filter(function(v){ return kids.indexOf(v) === -1; });
      }
    }
    emit();
  }
  function remove(v){ var x = byValue(v) || { value: v }; if(values.indexOf(v) !== -1) toggle(x); }

  function place(){
    var r = control.getBoundingClientRect();
    if(r.bottom < 0 || r.top > window.innerHeight){ close(); return; }   // kaydırılıp görünmez olduysa kapat
    var w = Math.max(r.width, 260), left = Math.min(r.left, window.innerWidth - w - 8);
    var below = window.innerHeight - r.bottom - 12, above = r.top - 12;
    var up = below < 240 && above > below;
    var maxH = Math.max(160, Math.min(340, up ? above : below));
    pop.style.left = Math.max(8, left) + "px"; pop.style.width = w + "px";
    pop.style.top = up ? "" : (r.bottom + 4) + "px";
    pop.style.bottom = up ? (window.innerHeight - r.top + 4) + "px" : "";
    list.style.maxHeight = (maxH - 46) + "px";
  }
  function onScroll(e){ if(open && !pop.contains(e.target)) place(); }
  function onDown(e){ if(open && !host.contains(e.target) && !pop.contains(e.target)) close(); }
  function openPop(){
    if(open) return;
    open = true; active = -1; search.value = "";
    document.body.appendChild(pop);
    control.setAttribute("aria-expanded", "true"); host.classList.add("open");
    renderList(); place();
    window.addEventListener("resize", place); window.addEventListener("scroll", onScroll, true);
    document.addEventListener("mousedown", onDown, true);
    search.focus();
  }
  function close(refocus){
    if(!open) return;
    open = false;
    pop.remove();
    control.setAttribute("aria-expanded", "false"); host.classList.remove("open");
    window.removeEventListener("resize", place); window.removeEventListener("scroll", onScroll, true);
    document.removeEventListener("mousedown", onDown, true);
    if(refocus) control.focus();
  }

  control.addEventListener("click", function(e){
    var x = e.target.closest("[data-ms-remove]");
    if(x){ e.stopPropagation(); remove(x.getAttribute("data-ms-remove")); return; }
    open ? close() : openPop();
  });
  control.addEventListener("keydown", function(e){
    if(e.key === "Enter" || e.key === " " || e.key === "ArrowDown"){ e.preventDefault(); openPop(); }
    else if((e.key === "Backspace" || e.key === "Delete") && o.multiple && values.length){ e.preventDefault(); remove(values[values.length - 1]); }
  });
  search.addEventListener("input", function(){ active = 0; renderList(); });
  search.addEventListener("keydown", function(e){
    if(e.key === "ArrowDown" || e.key === "ArrowUp"){
      e.preventDefault();
      if(visible.length) active = (active + (e.key === "ArrowDown" ? 1 : -1) + visible.length) % visible.length;
      renderList();
    } else if(e.key === "Enter"){ e.preventDefault(); toggle(visible[active]); }
    else if(e.key === "Escape"){ e.preventDefault(); e.stopPropagation(); close(true); }   // pencerenin kendisi kapanmasın
    else if(e.key === "Tab"){ close(); }
    else if(e.key === "Backspace" && !search.value && o.multiple && values.length){ remove(values[values.length - 1]); }
  });
  list.addEventListener("mousedown", function(e){ e.preventDefault(); });   // arama kutusu odağı kaybetmesin
  list.addEventListener("click", function(e){
    var row = e.target.closest(".ms-opt"); if(!row) return;
    active = +row.getAttribute("data-i"); toggle(visible[active]);
  });
  list.addEventListener("mousemove", function(e){
    var row = e.target.closest(".ms-opt"); if(!row) return;
    var i = +row.getAttribute("data-i"); if(i !== active){ active = i; Array.prototype.forEach.call(list.children, function(c, k){ c.classList.toggle("active", k === i); }); }
  });

  renderChips();
  return {
    get: function(){ return values.slice(); },
    set: function(v){ values = (Array.isArray(v) ? v : [v]).filter(function(x){ return typeof x === "string"; }); renderChips(); if(open) renderList(); },
    refresh: function(){ renderChips(); if(open){ renderList(); place(); } },
    close: close,
    isOpen: function(){ return open; }
  };
}
