/* Kenar çubuğu: kayıt durumu, sorumlu / öncelik / proje filtreleri */
import { PRIORITIES } from "../core/config.js";
import { renderAll } from "../core/render.js";
import { state } from "../core/state.js";
import { Storage } from "../core/storage.js";
import { showConfirm, toast } from "../core/ui.js";
import { $, esc } from "../core/utils.js";
import { reloadPage } from "../main.js";

export function renderSaveStatus(){
  var el = $("saveStatus"); if(!el) return;
  var s = Storage.getStatus(), cls = "", text = "Hazır", extra = "";
  if(s === "saving"){ cls = "st-saving"; text = "Kaydediliyor…"; }
  else if(s === "saved"){ cls = "st-saved"; text = "Dosyaya kaydedildi · " + Storage.getSavedAt(); }
  else if(s === "error"){
    cls = "st-error"; text = "Kaydedilemedi: " + Storage.getError();
    extra = Storage.hasConflict()
      ? '<button type="button" class="status-retry" data-reload="1">Sayfayı yenile</button>'
      : '<button type="button" class="status-retry" data-retry="1">Tekrar dene</button>';
  }
  else { cls = "st-saved"; text = "Dosyadan yüklendi"; }
  el.className = "save-status " + cls;
  el.innerHTML = '<span class="status-dot"></span><span>' + esc(text) + '</span>' + extra;
}

export function renderSidebar(){
  /* Sorumlu */
  var h = '<button class="unit-item ' + (state.filterUnit === "all" ? "active" : "") + '" data-unit="all">' +
    '<span class="unit-dot" style="background:#fff;"></span><span class="unit-name">Tümü</span>' +
    '<span class="unit-count">' + state.tasks.length + '</span></button>';
  state.units.forEach(function(u){
    var c = state.tasks.filter(function(t){ return t.unit === u.id; }).length;
    h += '<button class="unit-item ' + (state.filterUnit === u.id ? "active" : "") + '" data-unit="' + u.id + '">' +
      '<span class="unit-dot" style="background:' + u.color + ';"></span><span class="unit-name">' + esc(u.name) + '</span>' +
      '<span class="unit-count">' + c + '</span></button>';
  });
  $("unitList").innerHTML = h;

  /* Öncelik */
  h = '<button class="prio-chip ' + (state.filterPrio === "all" ? "active" : "") + '" data-prio="all">Tümü</button>';
  PRIORITIES.forEach(function(p){
    h += '<button class="prio-chip ' + (state.filterPrio === p.id ? "active" : "") + '" data-prio="' + p.id + '">' + p.name + '</button>';
  });
  $("prioFilterRow").innerHTML = h;

  /* Proje */
  var none = state.tasks.filter(function(t){ return !t.projectId; }).length;
  h = '<button class="unit-item ' + (state.filterProject === "all" ? "active" : "") + '" data-project="all">' +
    '<span class="unit-dot" style="background:#fff;"></span><span class="unit-name">Tümü</span><span class="unit-count">' + state.tasks.length + '</span></button>';
  h += '<button class="unit-item ' + (state.filterProject === "none" ? "active" : "") + '" data-project="none">' +
    '<span class="unit-dot" style="background:var(--text-invert-soft);"></span><span class="unit-name">Projesiz</span><span class="unit-count">' + none + '</span></button>';
  sortedProjects().forEach(function(p){
    var c = state.tasks.filter(function(t){ return t.projectId === p.id; }).length;
    h += '<button class="unit-item ' + (state.filterProject === p.id ? "active" : "") + '" data-project="' + p.id + '">' +
      '<span class="unit-dot" style="background:' + p.color + ';"></span>' +
      '<span class="unit-name">' + esc(p.name) + (p.status === "arsivlenmis" ? ' <span style="opacity:.6;">(arşiv)</span>' : "") + '</span>' +
      '<span class="unit-count">' + c + '</span></button>';
  });
  $("projectList").innerHTML = h;
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
  $("unitList").onclick = function(e){ var b = e.target.closest("[data-unit]"); if(b){ state.filterUnit = b.getAttribute("data-unit"); renderAll(); } };
  $("prioFilterRow").onclick = function(e){ var b = e.target.closest("[data-prio]"); if(b){ state.filterPrio = b.getAttribute("data-prio"); renderAll(); } };
  $("projectList").onclick = function(e){ var b = e.target.closest("[data-project]"); if(b){ state.filterProject = b.getAttribute("data-project"); renderAll(); } };

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
