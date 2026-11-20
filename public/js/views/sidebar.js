/* Kenar çubuğu: kayıt durumu, sorumlu / öncelik / proje filtreleri */
import { ICON, PREF_SIDE_COLLAPSED, PRIORITIES } from "../core/config.js";
import { searchKey } from "../core/domain.js";
import { renderAll } from "../core/render.js";
import { getMember, getProject, getUnit, state } from "../core/state.js";
import { Storage } from "../core/storage.js";
import { showConfirm, toast } from "../core/ui.js";
import { $, esc, pref } from "../core/utils.js";
import { reloadPage } from "../main.js";

export function renderSaveStatus(){
  var el = $("saveStatus"); if(!el) return;
  var s = Storage.getStatus(), cls = "", text = "Hazır", extra = "";
  if(s === "saving"){ cls = "st-saving"; text = "Kaydediliyor…"; }
  else if(s === "saved"){ cls = "st-saved"; text = "Kaydedildi · " + Storage.getSavedAt(); }
  else if(s === "error"){
    cls = "st-error"; text = "Kaydedilemedi: " + Storage.getError();
    extra = Storage.hasConflict()
      ? '<button type="button" class="status-retry" data-reload="1">Sayfayı yenile</button>'
      : '<button type="button" class="status-retry" data-retry="1">Tekrar dene</button>';
  }
  else { cls = "st-saved"; text = "Sunucudan yüklendi"; }   // veri sunucudaki veritabanından (GET /api/state) okunur
  el.className = "save-status " + cls;
  el.innerHTML = '<span class="status-dot"></span><span>' + esc(text) + '</span>' + extra;
}

/* ---------- Sorumlu ve Proje filtreleri: katlanır, aranabilir, "N tane daha" ----------
   Arama kutuları statik HTML'dedir (yeniden çizimde odak/değer kaybolmasın); yalnızca listeler çizilir.
   Bölüm katlı mı: localStorage (PREF_SIDE_COLLAPSED); "daha fazla" ve açık ekipler: bellek. */
var SIDE_VISIBLE = 6;          // arama yokken gösterilen öğe sayısı (seçili öğe her zaman görünür)
var SEARCH_FROM = 7;           // bu kadar ve daha fazla öğe varsa arama kutusu görünür
var side = { units: { q: "", more: false }, projects: { q: "", more: false }, openUnits: {} };
var collapsed = (function(){ try{ return JSON.parse(pref(PREF_SIDE_COLLAPSED) || "{}") || {}; }catch(e){ return {}; } })();

function row(attrs, color, name, count, active, extra, sub){
  return '<div class="side-row' + (sub ? " sub" : "") + '">' + (extra || "") +
    '<button type="button" class="unit-item' + (active ? " active" : "") + '" ' + attrs + '>' +
    '<span class="unit-dot" style="background:' + color + ';"></span><span class="unit-name">' + name + '</span>' +
    '<span class="unit-count">' + count + '</span></button></div>';
}
function moreLink(sec, hidden){
  if(side[sec].more) return '<button type="button" class="side-more" data-more="' + sec + '">Daha az göster</button>';
  return hidden > 0 ? '<button type="button" class="side-more" data-more="' + sec + '">' + hidden + ' tane daha</button>' : "";
}
/* Bölüm başlığında, katlıyken etkin filtrenin çipi */
function activeChip(sec, color, label){
  return '<span class="side-chip" title="' + label + '"><span class="unit-dot" style="background:' + color + ';"></span><span class="side-chip-name">' + label + '</span>' +
    '<button type="button" class="side-chip-x" data-clear="' + sec + '" title="Filtreyi kaldır" aria-label="Filtreyi kaldır">×</button></span>';
}
function sectionState(sec, total){
  var wrap = $(sec === "units" ? "unitFilter" : "projectFilter");
  wrap.classList.toggle("collapsed", !!collapsed[sec]);
  wrap.querySelector(".side-toggle").setAttribute("aria-expanded", collapsed[sec] ? "false" : "true");
  wrap.querySelector(".side-search").style.display = total >= SEARCH_FROM ? "" : "none";
  if(total < SEARCH_FROM && side[sec].q){ side[sec].q = ""; wrap.querySelector(".side-search input").value = ""; }
}

function renderUnitFilter(){
  var q = searchKey(side.units.q.trim()), tasks = state.tasks;
  var cnt = function(f){ return tasks.filter(f).length; };
  var memberCount = 0; state.units.forEach(function(u){ memberCount += u.members.length; });
  sectionState("units", state.units.length + memberCount);
  var h = row('data-unit="all"', "#fff", "Tümü", tasks.length, state.filterUnit === "all" && state.filterMember === "all", '<span class="side-caret-space"></span>');
  var shown = 0, hidden = 0;
  state.units.forEach(function(u){
    var members = u.members.filter(function(m){ return m.active || state.filterMember === m.id; });
    var unitHit = !q || searchKey(u.name).indexOf(q) !== -1;
    var memberHits = q ? members.filter(function(m){ return searchKey(m.name).indexOf(q) !== -1; }) : [];
    if(q && !unitHit && !memberHits.length) return;
    var selHere = state.filterUnit === u.id || members.some(function(m){ return m.id === state.filterMember; });
    if(!q && !side.units.more && shown >= SIDE_VISIBLE && !selHere){ hidden++; return; }
    shown++;
    var open = !!side.openUnits[u.id] || (q && memberHits.length > 0) || members.some(function(m){ return m.id === state.filterMember; });
    var caret = members.length
      ? '<button type="button" class="side-caret' + (open ? " open" : "") + '" data-open-unit="' + u.id + '" title="' + (open ? "Çalışanları gizle" : "Çalışanları göster") + '" aria-expanded="' + open + '">' + ICON.chevron + '</button>'
      : '<span class="side-caret-space"></span>';
    h += row('data-unit="' + u.id + '"', u.color, esc(u.name), cnt(function(t){ return t.units.indexOf(u.id) !== -1; }), state.filterUnit === u.id, caret);
    if(open) (q && !unitHit ? memberHits : members).forEach(function(m){
      h += row('data-member="' + m.id + '"', u.color, esc(m.name) + (m.active ? "" : ' <span class="side-muted">(pasif)</span>'),
        cnt(function(t){ return t.members.indexOf(m.id) !== -1; }), state.filterMember === m.id, "", true);
    });
  });
  if(q && !shown) h += '<div class="side-empty">Eşleşme yok</div>';
  if(!q) h += moreLink("units", hidden);
  $("unitList").innerHTML = h;
  /* katlıyken etkin filtre başlıkta görünür */
  var chip = "";
  if(state.filterMember !== "all"){ var m = getMember(state.filterMember); chip = activeChip("units", getUnit(m.unitId).color, esc(m.name)); }
  else if(state.filterUnit !== "all"){ var un = getUnit(state.filterUnit); chip = activeChip("units", un.color, esc(un.name)); }
  $("unitActive").innerHTML = collapsed.units ? chip : "";
}

function renderProjectFilter(){
  var q = searchKey(side.projects.q.trim()), tasks = state.tasks, list = sortedProjects();
  sectionState("projects", list.length);
  var h = row('data-project="all"', "#fff", "Tümü", tasks.length, state.filterProject === "all");
  if(!q || searchKey("Projesiz").indexOf(q) !== -1)
    h += row('data-project="none"', "var(--text-invert-soft)", "Projesiz", tasks.filter(function(t){ return !t.projectId; }).length, state.filterProject === "none");
  var shown = 0, hidden = 0;
  list.forEach(function(p){
    if(q && searchKey(p.name).indexOf(q) === -1) return;
    if(!q && !side.projects.more && shown >= SIDE_VISIBLE && state.filterProject !== p.id){ hidden++; return; }
    shown++;
    h += row('data-project="' + p.id + '"', p.color, esc(p.name) + (p.status === "arsivlenmis" ? ' <span class="side-muted">(arşiv)</span>' : ""),
      tasks.filter(function(t){ return t.projectId === p.id; }).length, state.filterProject === p.id);
  });
  if(q && !shown) h += '<div class="side-empty">Eşleşme yok</div>';
  if(!q) h += moreLink("projects", hidden);
  $("projectList").innerHTML = h;
  var chip = "";
  if(state.filterProject === "none") chip = activeChip("projects", "var(--text-invert-soft)", "Projesiz");
  else if(state.filterProject !== "all"){ var p = getProject(state.filterProject); if(p) chip = activeChip("projects", p.color, esc(p.name)); }
  $("projectActive").innerHTML = collapsed.projects ? chip : "";
}

export function renderSidebar(){
  renderUnitFilter();
  /* Öncelik */
  var h = '<button class="prio-chip ' + (state.filterPrio === "all" ? "active" : "") + '" data-prio="all">Tümü</button>';
  PRIORITIES.forEach(function(p){
    h += '<button class="prio-chip ' + (state.filterPrio === p.id ? "active" : "") + '" data-prio="' + p.id + '">' + p.name + '</button>';
  });
  $("prioFilterRow").innerHTML = h;
  renderProjectFilter();
}
export function sortedProjects(){
  return state.projects.slice().sort(function(a, b){
    if(a.status !== b.status) return a.status === "aktif" ? -1 : 1;
    return a.name.localeCompare(b.name, "tr");
  });
}

/* Olay bağlama (main.js → bind) */
export function bindSidebar(){
  /* Kenar çubuğu filtreleri (delegasyon) */
  $("unitList").onclick = function(e){
    var c = e.target.closest("[data-open-unit]");
    if(c){ var id = c.getAttribute("data-open-unit"); side.openUnits[id] = !side.openUnits[id]; renderUnitFilter(); return; }
    var mo = e.target.closest("[data-more]");
    if(mo){ side.units.more = !side.units.more; renderUnitFilter(); return; }
    var b = e.target.closest("[data-unit],[data-member]"); if(!b) return;
    if(b.hasAttribute("data-member")){ state.filterMember = b.getAttribute("data-member"); state.filterUnit = "all"; }
    else { state.filterUnit = b.getAttribute("data-unit"); state.filterMember = "all"; }
    renderAll();
  };
  $("prioFilterRow").onclick = function(e){ var b = e.target.closest("[data-prio]"); if(b){ state.filterPrio = b.getAttribute("data-prio"); renderAll(); } };
  $("projectList").onclick = function(e){
    if(e.target.closest("[data-more]")){ side.projects.more = !side.projects.more; renderProjectFilter(); return; }
    var b = e.target.closest("[data-project]"); if(b){ state.filterProject = b.getAttribute("data-project"); renderAll(); }
  };
  $("unitSearch").oninput = function(e){ side.units.q = e.target.value; renderUnitFilter(); };
  $("projectSearch").oninput = function(e){ side.projects.q = e.target.value; renderProjectFilter(); };
  [$("unitSearch"), $("projectSearch")].forEach(function(inp){
    inp.onkeydown = function(e){ if(e.key === "Escape" && inp.value){ e.stopPropagation(); inp.value = ""; inp.oninput({ target: inp }); } };
  });
  /* Başlık: tıklayınca bölüm katlanır/açılır; çipteki × filtreyi kaldırır */
  [["unitFilter", "units"], ["projectFilter", "projects"]].forEach(function(x){
    $(x[0]).querySelector(".side-head").onclick = function(e){
      var clr = e.target.closest("[data-clear]");
      if(clr){
        if(x[1] === "units"){ state.filterUnit = "all"; state.filterMember = "all"; } else state.filterProject = "all";
        renderAll(); return;
      }
      if(!e.target.closest(".side-toggle")) return;
      collapsed[x[1]] = !collapsed[x[1]];
      try{ pref(PREF_SIDE_COLLAPSED, JSON.stringify(collapsed)); }catch(err){}
      renderSidebar();
    };
  });

  $("saveStatus").onclick = function(e){
    if(e.target.closest("[data-reload]")) showConfirm({
      title: "Sayfayı yenile",
      message: "Dosya başka bir pencerede/sekmede değiştirildi. Yenilerseniz dosyadaki güncel veri yüklenir; bu penceredeki kaydedilmemiş son değişiklik kaybolur.",
      confirmLabel: "Yenile", danger: true,
      onConfirm: reloadPage
    });
    else if(e.target.closest("[data-retry]")) Storage.flush().then(function(ok){ toast(ok ? "Kaydedildi" : "Hâlâ kaydedilemiyor: " + Storage.getError(), !ok); });
  };
}
