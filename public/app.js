/* İş Takip — arayüz mantığı.
   Katmanlar: Config → Utils → State → Storage (sunucu API'si) → Views → Actions → Init.
   Her veri değişikliği şu tek akıştan geçer:  state'i değiştir → ekranı yenile → Storage.save(...)
   Bağımlı dosyalar: editor.js (window.RichEditor), eml.js (window.Eml) */
(function(){
"use strict";

/* =====================================================================
   CONFIG
   ===================================================================== */
/* units.json yoksa ya da boşsa kullanılan başlangıç sorumluları */
var DEFAULT_UNITS = [
  { id:"oz",        name:"Kendi İşlerim",               color:"#7C4DFF", order:0 },
  { id:"mimari",    name:"Veri Mimarisi",               color:"#0E7C86", order:1 },
  { id:"yonetim",   name:"Veri Yönetimi",               color:"#3E5C76", order:2 },
  { id:"hazirlama", name:"Veri Hazırlama ve İş Zekası", color:"#B0812F", order:3 },
  { id:"diger",     name:"Diğer",                       color:"#6B7280", order:4 }
];
var UNIT_MAP = {};

var PRIORITIES = [
  { id:"kritik", name:"Kritik", color:"var(--danger)",     soft:"var(--danger-soft)",  hex:"#E4572E", order:0 },
  { id:"yuksek", name:"Yüksek", color:"var(--warn)",       soft:"var(--warn-soft)",    hex:"#C9860B", order:1 },
  { id:"orta",   name:"Orta",   color:"var(--accent)",     soft:"var(--accent-soft)",  hex:"#0E7C86", order:2 },
  { id:"dusuk",  name:"Düşük",  color:"var(--text-faint)", soft:"var(--neutral-soft)", hex:"#8A93A3", order:3 }
];
var PRIO_MAP = {}; PRIORITIES.forEach(function(p){ PRIO_MAP[p.id] = p; });

var STATUSES = [
  { id:"backlog",    name:"Backlog",      color:"#A0A7B4" },
  { id:"beklemede",  name:"Beklemede",    color:"#8B93A7" },
  { id:"devam",      name:"Devam Ediyor", color:"#3E92CC" },
  { id:"tamamlandi", name:"Tamamlandı",   color:"#2E9E6D" },
  { id:"iptal",      name:"İptal Edildi", color:"#A6ADB9" }
];
var STATUS_MAP = {}; STATUSES.forEach(function(s){ STATUS_MAP[s.id] = s; });

var PROJECT_COLORS = ["#0E7C86","#7C4DFF","#3E5C76","#B0812F","#2E9E6D","#E4572E","#3E92CC","#C9860B","#A64AC9","#1F7A52","#6B7280"];
var DUE_SOON_DAYS = 3;
var ALERT_GROUPS = [
  { id:"over",  name:"Gecikmiş" },
  { id:"today", name:"Bugün" },
  { id:"soon",  name:"Yaklaşan" }
];
var ALERT_ROWS = 6;                       // her grupta "+N daha" öncesi gösterilen satır
var MAX_UPLOAD = 25 * 1024 * 1024;        // sunucudaki sınırla aynı
var MAIL_ATT_WARN = 20 * 1024 * 1024;     // bunun üstündeki ekler için uyarı
var PREF_ALERTS_OPEN = "isTakip.alertsOpen";

/* =====================================================================
   UTILS
   ===================================================================== */
function $(id){ return document.getElementById(id); }
function pad(n){ return n < 10 ? "0" + n : "" + n; }
function isoOf(d){ return d.getFullYear() + "-" + pad(d.getMonth()+1) + "-" + pad(d.getDate()); }
function todayISO(){ return isoOf(new Date()); }
function parseISO(s){ var p = String(s || "").slice(0, 10).split("-"); return new Date(+p[0], +p[1]-1, +p[2]); }
function daysBetween(a, b){ return Math.round((parseISO(b) - parseISO(a)) / 86400000); }
/* Ekranda her tarih gg.aa.yyyy; dosyada ISO (yyyy-aa-gg) */
function fmtDate(iso){
  if(!iso) return "—";
  var d = parseISO(iso);
  if(isNaN(d)) return "—";
  return pad(d.getDate()) + "." + pad(d.getMonth()+1) + "." + d.getFullYear();
}
function isoToTR(iso){ return iso ? fmtDate(iso) : ""; }
function trToISO(s){
  var m = /^\s*(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})\s*$/.exec(s || "");
  if(!m) return "";
  var d = new Date(+m[3], +m[2]-1, +m[1]);
  if(d.getFullYear() !== +m[3] || d.getMonth() !== +m[2]-1 || d.getDate() !== +m[1]) return "";  // 31.02 gibi
  return isoOf(d);
}
function maskDate(v){
  var d = String(v).replace(/\D/g, "").slice(0, 8);
  return d.length > 4 ? d.slice(0,2) + "." + d.slice(2,4) + "." + d.slice(4) : d.length > 2 ? d.slice(0,2) + "." + d.slice(2) : d;
}
function relLabel(iso){
  if(!iso) return "—";
  var d = daysBetween(iso, todayISO());
  return d === 0 ? "Bugün" : d === 1 ? "Dün" : fmtDate(iso);
}
function uid(){ return "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function esc(s){
  return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){
    return { "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c];
  });
}
function timeLabel(){ var d = new Date(); return pad(d.getHours()) + ":" + pad(d.getMinutes()); }
function fmtSize(n){
  n = +n || 0;
  return n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(0) + " KB" : (n / 1048576).toFixed(1).replace(".", ",") + " MB";
}
function pref(key, val){
  try{
    if(val === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, val);
  }catch(e){ return null; }
}
function download(name, blob){
  var a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(function(){ URL.revokeObjectURL(a.href); }, 1500);
}

var toastTimer = null;
function toast(msg, isError){
  var t = $("toast");
  $("toastMsg").textContent = msg;
  t.style.background = isError ? "#7A2E17" : "";
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function(){ t.classList.remove("show"); }, isError ? 5000 : 2400);
}

/* Tarayıcının yerleşik confirm()/alert() penceresi yerine kendi modal'ımız.
   o.select = { label, options:[{id,name}], value } verilirse seçilen değer onConfirm(value)'ya geçer. */
var confirmCb = null, cancelCb = null;
function showConfirm(o){
  $("confirmTitle").textContent = o.title || "Emin misiniz?";
  $("confirmMessage").textContent = o.message || "";
  var ok = $("confirmOkBtn"), cancel = $("confirmCancelBtn");
  ok.textContent = o.confirmLabel || "Onayla";
  cancel.textContent = o.cancelLabel || "Vazgeç";
  var col = o.danger === false ? "var(--accent)" : "var(--danger)";
  ok.style.background = col; ok.style.borderColor = col;
  cancel.style.display = o.hideCancel ? "none" : "inline-flex";
  var sw = $("confirmSelectWrap");
  if(o.select){
    $("confirmSelectLabel").textContent = o.select.label || "Seçin";
    $("confirmSelect").innerHTML = o.select.options.map(function(x){ return '<option value="' + esc(x.id) + '">' + esc(x.name) + '</option>'; }).join("");
    if(o.select.value != null) $("confirmSelect").value = o.select.value;
    sw.style.display = "flex";
  } else sw.style.display = "none";
  confirmCb = o.onConfirm || null; cancelCb = o.onCancel || null;
  $("confirmOverlay").classList.add("show");
}
function closeConfirm(){ $("confirmOverlay").classList.remove("show"); confirmCb = null; cancelCb = null; }
function showInfo(title, message){
  showConfirm({ title:title, message:message, confirmLabel:"Tamam", danger:false, hideCancel:true });
}

/* =====================================================================
   STATE
   ===================================================================== */
var state = {
  tasks: [], projects: [], archive: [], units: [],
  view: "board",
  filterUnit: "all", filterPrio: "all", filterProject: "all", urgencyFilter: null,
  pipelineFilter: null, search: "", archiveSearch: "",
  editingId: null, modalNotes: [], modalAttachments: [], uploading: 0, pendingStatus: null,
  selected: {},
  alertsOpen: pref(PREF_ALERTS_OPEN) === "1", alertExpanded: {}
};

/* Dosyadan/yedekten gelen değerler HTML attribute'larına gömüldüğü için kimlik ve renkler burada doğrulanır. */
var SAFE_ID = /^[\w-]{1,64}$/, HEX_COLOR = /^#[0-9a-f]{6}$/i, ISO_DAY = /^\d{4}-\d{2}-\d{2}/;
function safeId(v){ return typeof v === "string" && SAFE_ID.test(v) ? v : ""; }
function str(v){ return v == null ? "" : String(v); }
function isoDay(v){ return typeof v === "string" && ISO_DAY.test(v) ? v.slice(0, 10) : ""; }

function setUnits(list){
  state.units = list.slice().sort(function(a, b){ return a.order - b.order; });
  state.units.forEach(function(u, i){ u.order = i; });
  UNIT_MAP = {}; state.units.forEach(function(u){ UNIT_MAP[u.id] = u; });
}
function getUnit(id){ return UNIT_MAP[id] || { id: id, name: "(silinmiş sorumlu)", color: "#9AA1AD", missing: true }; }
function defaultUnitId(){ return state.units.length ? state.units[0].id : "diger"; }
function normalizeUnit(u, i){
  u = u || {};
  return { id: safeId(u.id) || uid(), name: str(u.name).trim() || "Adsız sorumlu",
    color: HEX_COLOR.test(u.color) ? u.color : "#6B7280", order: typeof u.order === "number" ? u.order : i };
}

function normalizeNote(n){
  n = n && typeof n === "object" ? n : { text: n };
  var created = typeof n.createdAt === "string" ? n.createdAt : "";
  return Object.assign({}, n, { id: safeId(n.id) || uid(), text: str(n.text), date: isoDay(n.date) || isoDay(created), createdAt: created });
}
function normalizeAttachment(a){
  if(!a || typeof a !== "object" || !safeId(a.id)) return null;
  return { id: a.id, name: str(a.name).slice(0, 200) || "dosya", size: +a.size || 0, type: str(a.type).slice(0, 100), uploadedAt: str(a.uploadedAt) };
}
function normalizeTask(t){
  t = t || {};
  var html = typeof t.descriptionHtml === "string" ? RichEditor.sanitize(t.descriptionHtml) : RichEditor.fromPlain(str(t.description));
  return Object.assign({
    id: uid(), title: "", description: "", priority: "orta", status: "backlog",
    projectId: "", startDate: "", dueDate: "", createdAt: todayISO(), updatedAt: todayISO(), notes: []
  }, t, {
    id: safeId(t.id) || uid(),
    title: str(t.title),
    descriptionHtml: html,
    description: typeof t.descriptionHtml === "string" ? RichEditor.toPlain(html) : str(t.description),
    unit: safeId(t.unit) || defaultUnitId(),      // bilinmeyen sorumlu olduğu gibi kalır; "(silinmiş sorumlu)" olarak görünür
    priority: PRIO_MAP[t.priority] ? t.priority : "orta",
    status: STATUS_MAP[t.status] ? t.status : "backlog",
    projectId: safeId(t.projectId),
    startDate: isoDay(t.startDate), dueDate: isoDay(t.dueDate),
    createdAt: isoDay(t.createdAt) || todayISO(),
    notes: Array.isArray(t.notes) ? t.notes.map(normalizeNote) : [],
    attachments: Array.isArray(t.attachments) ? t.attachments.map(normalizeAttachment).filter(Boolean) : []
  });
}
function normalizeProject(p){
  p = p || {};
  return Object.assign({ id: uid(), name: "Adsız proje", color: PROJECT_COLORS[0], status: "aktif" }, p, {
    id: safeId(p.id) || uid(),
    name: str(p.name) || "Adsız proje",
    color: HEX_COLOR.test(p.color) ? p.color : PROJECT_COLORS[0],
    status: p.status === "arsivlenmis" ? "arsivlenmis" : "aktif"
  });
}
function unitsFrom(list){
  var seen = {}, out = (Array.isArray(list) ? list : []).map(normalizeUnit).filter(function(u){
    if(seen[u.id]) return false; seen[u.id] = true; return true;
  });
  return out.length ? out : DEFAULT_UNITS.map(function(u){ return Object.assign({}, u); });
}
function applyServerState(data){
  Storage.adopt(data.meta);
  setUnits(unitsFrom(data.units));                  // işlerden önce: normalizeTask varsayılan sorumluyu buradan alır
  state.tasks    = (data.tasks    || []).map(normalizeTask);
  state.projects = (data.projects || []).map(normalizeProject);
  state.archive  = (data.archive  || []).map(normalizeTask);
  if(state.filterProject !== "all" && state.filterProject !== "none" && !getProject(state.filterProject)) state.filterProject = "all";
  if(state.filterUnit !== "all" && !UNIT_MAP[state.filterUnit]) state.filterUnit = "all";
}
function getProject(id){
  if(!id) return null;
  for(var i = 0; i < state.projects.length; i++) if(state.projects[i].id === id) return state.projects[i];
  return null;
}
function findTask(id){ return state.tasks.filter(function(t){ return t.id === id; })[0] || null; }
function findArchived(id){ return state.archive.filter(function(t){ return t.id === id; })[0] || null; }

/* =====================================================================
   STORAGE — sunucudaki data/*.json dosyalarına tek geçit
   ===================================================================== */
var Storage = (function(){
  var KINDS = ["tasks", "projects", "archive", "units"];
  var dirty = { tasks:false, projects:false, archive:false, units:false };
  var version = { tasks:0, projects:0, archive:0, units:0 };
  var chain = Promise.resolve();
  var pending = 0;
  var status = "idle";          // idle | saving | saved | error
  var lastError = "";
  var lastSavedAt = "";
  var loaded = false;           // sunucudan başarıyla okunmadan hiçbir şey yazılmaz (boş state dosyayı ezmesin)
  var conflict = false;         // dosya başka pencerede değişti; yenilemeden yazılmaz
  var base = { tasks:"", projects:"", archive:"", units:"" };  // dosyanın en son bilinen updatedAt değeri

  function api(url, opts){
    return fetch(url, opts).then(function(r){
      return r.json().catch(function(){ return {}; }).then(function(j){
        if(!r.ok) throw Object.assign(new Error(j.error || ("HTTP " + r.status)), { status: r.status });
        return j;
      });
    });
  }
  function load(){ return api("/api/state", { cache: "no-store" }); }
  /* Yüklenen veri ekrana uygulandığında çağrılır */
  function adopt(meta){
    meta = meta || {};
    KINDS.forEach(function(k){ base[k] = typeof meta[k] === "string" ? meta[k] : ""; });
    loaded = true; conflict = false;
  }

  function putKind(kind){
    var v = version[kind];
    return api("/api/" + kind, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: state[kind], baseUpdatedAt: base[kind] })
    }).then(function(j){
      if(typeof j.updatedAt === "string") base[kind] = j.updatedAt;
      if(version[kind] === v) dirty[kind] = false;
    }, function(e){
      if(e.status === 409){ conflict = true; e.message = "Veri başka bir pencerede/sekmede değişti. Sayfayı yenileyin"; }
      throw e;
    });
  }

  /* kinds sırayla yazılır (örn. arşivle: önce arşiv, sonra aktif işler — yarıda kesilirse iş kaybolmaz, en kötü iki yerde görünür) */
  function save(kinds){
    if(!loaded){
      lastError = "Veriler sunucudan yüklenmeden kayıt yapılamaz"; status = "error"; renderSaveStatus();
      return Promise.resolve(false);
    }
    kinds.forEach(function(k){ dirty[k] = true; version[k]++; });
    pending++; status = "saving"; renderSaveStatus();
    var job = chain.then(function(){
      return kinds.reduce(function(acc, k){ return acc.then(function(){ return putKind(k); }); }, Promise.resolve());
    });
    chain = job.catch(function(){});
    return job.then(function(){
      pending--; settle(); return true;
    }, function(e){
      pending--; lastError = (e && e.message) || "bilinmeyen hata"; settle(); return false;
    });
  }
  function settle(){
    if(pending > 0) return;
    if(hasUnsaved()){ status = "error"; }
    else { status = "saved"; lastSavedAt = timeLabel(); lastError = ""; }
    renderSaveStatus();
  }
  function flush(){
    var k = KINDS.filter(function(x){ return dirty[x]; });
    return k.length ? save(k) : Promise.resolve(true);
  }
  function hasUnsaved(){ return pending > 0 || KINDS.some(function(k){ return dirty[k]; }); }

  /* Ek yükleme: { id, name, size, type, uploadedAt } döner */
  function upload(file){
    return api("/api/attachments", {
      method: "POST",
      headers: { "Content-Type": file.type || "application/octet-stream", "X-File-Name": encodeURIComponent(file.name || "dosya") },
      body: file
    });
  }

  return {
    load: load, adopt: adopt, save: save, flush: flush, hasUnsaved: hasUnsaved, upload: upload,
    hasConflict: function(){ return conflict; },
    getStatus: function(){ return status; },
    getError: function(){ return lastError; },
    getSavedAt: function(){ return lastSavedAt; }
  };
})();

/* Her değişikliğin ortak çıkışı */
function commit(kinds, doneText){
  renderAll();
  Storage.save(kinds).then(function(ok){
    if(ok) toast(doneText + " ve dosyaya kaydedildi");
    else toast(doneText + " ama DOSYAYA YAZILAMADI: " + Storage.getError() + " — sunucunun çalıştığını kontrol edin", true);
  });
}

/* =====================================================================
   DOMAIN
   ===================================================================== */
function urgency(t){
  if(t.status === "tamamlandi") return "done";
  if(t.status === "iptal") return "cancelled";
  if(!t.dueDate) return "normal";
  var d = daysBetween(todayISO(), t.dueDate);
  if(d < 0) return "over";
  if(d <= DUE_SOON_DAYS) return "soon";
  return "normal";
}
/* Uyarı paneli grupları: over | today | soon | null */
function urgencyGroup(t){
  var u = urgency(t);
  if(u === "over") return "over";
  if(u === "soon") return daysBetween(todayISO(), t.dueDate) === 0 ? "today" : "soon";
  return null;
}
function dueText(t){
  var d = daysBetween(todayISO(), t.dueDate);
  return d < 0 ? Math.abs(d) + " gün gecikti" : d === 0 ? "bugün son gün" : d + " gün kaldı";
}
function hasDates(t){ return !!(t.startDate && t.dueDate); }
/* Başlangıç + bitiş tarihi zorunlu olan durumlar: Backlog'da henüz plan yok, İptal'de ise artık gerekmiyor */
function needsDates(status){ return status !== "backlog" && status !== "iptal"; }
function allTasks(){ return state.tasks.concat(state.archive); }
function projectTaskCount(id){ return allTasks().filter(function(t){ return t.projectId === id; }).length; }
function unitTaskCount(id){ return allTasks().filter(function(t){ return t.unit === id; }).length; }
function filteredTasks(){
  var q = state.search.toLowerCase();
  return state.tasks.filter(function(t){
    if(state.filterUnit !== "all" && t.unit !== state.filterUnit) return false;
    if(state.filterPrio !== "all" && t.priority !== state.filterPrio) return false;
    if(state.filterProject === "none" && t.projectId) return false;
    if(state.filterProject !== "all" && state.filterProject !== "none" && t.projectId !== state.filterProject) return false;
    if(state.pipelineFilter && t.status !== state.pipelineFilter) return false;
    if(state.urgencyFilter && urgencyGroup(t) !== state.urgencyFilter) return false;
    if(q && t.title.toLowerCase().indexOf(q) === -1) return false;
    return true;
  });
}
function latestNotes(t, n){
  return t.notes.slice().sort(function(a, b){ return (b.createdAt || b.date || "").localeCompare(a.createdAt || a.date || ""); }).slice(0, n);
}
function selectedTasks(){ return state.tasks.filter(function(t){ return state.selected[t.id]; }); }
function selectionCount(){ return selectedTasks().length; }

/* =====================================================================
   ICONS
   ===================================================================== */
var SV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">';
var ICON = {
  clock:   SV + '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>',
  check:   SV + '<path d="M20 6 9 17l-5-5"/></svg>',
  note:    SV + '<path d="M4 4h13l3 3v13H4z"/><path d="M8 9h9M8 13h9M8 17h5"/></svg>',
  trash:   SV + '<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>',
  archive: SV + '<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8"/><path d="M10 13h4"/></svg>',
  restore: SV + '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
  folder:  SV + '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/></svg>',
  x:       SV + '<path d="M18 6 6 18M6 6l12 12"/></svg>',
  clip:    SV + '<path d="m21 11-8.5 8.5a5 5 0 0 1-7-7L14 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 7"/></svg>',
  up:      SV + '<path d="m18 15-6-6-6 6"/></svg>',
  down:    SV + '<path d="m6 9 6 6 6-6"/></svg>',
  file:    SV + '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/></svg>'
};

/* =====================================================================
   VIEWS
   ===================================================================== */
function renderSaveStatus(){
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

function renderSidebar(){
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
function sortedProjects(){
  return state.projects.slice().sort(function(a, b){
    if(a.status !== b.status) return a.status === "aktif" ? -1 : 1;
    return a.name.localeCompare(b.name, "tr");
  });
}

function renderPipeline(){
  $("pipeline").innerHTML = STATUSES.map(function(s){
    var c = state.tasks.filter(function(t){ return t.status === s.id; }).length;
    return '<button class="pipe-node ' + (state.pipelineFilter === s.id ? "selected" : "") + '" data-status="' + s.id + '">' +
      '<span class="pipe-dot" style="background:' + s.color + '; --dotshadow:' + s.color + '22;"></span>' +
      '<span><span class="pipe-num">' + c + '</span><div class="pipe-label">' + s.name + '</div></span></button>';
  }).join("");
}

/* Uyarılar: kapalıyken tek satırlık özet şeridi, açıkken grup sütunlu ve yüksekliği sınırlı panel */
function renderAlerts(){
  var groups = {}; ALERT_GROUPS.forEach(function(g){ groups[g.id] = []; });
  state.tasks.forEach(function(t){ var g = urgencyGroup(t); if(g) groups[g].push(t); });
  ALERT_GROUPS.forEach(function(g){
    groups[g.id].sort(function(a, b){
      return (a.dueDate).localeCompare(b.dueDate) || PRIO_MAP[a.priority].order - PRIO_MAP[b.priority].order;
    });
  });
  var total = groups.over.length + groups.today.length + groups.soon.length;
  var banner = $("alertBanner");
  if(state.urgencyFilter && !groups[state.urgencyFilter].length) state.urgencyFilter = null;
  if(!total){ banner.classList.remove("show"); return; }
  banner.classList.add("show");
  banner.classList.toggle("open", state.alertsOpen);
  $("alertsToggle").setAttribute("aria-expanded", state.alertsOpen ? "true" : "false");
  $("alertsToggleText").textContent = state.alertsOpen ? "Gizle" : "Ayrıntılar";

  var live = ALERT_GROUPS.filter(function(g){ return groups[g.id].length; });
  $("alertChips").innerHTML = live.map(function(g){
    return '<button type="button" class="a-chip a-' + g.id + (state.urgencyFilter === g.id ? " active" : "") + '" data-urg="' + g.id + '" ' +
      'title="' + (state.urgencyFilter === g.id ? "Filtreyi kaldır" : "Panoda yalnızca bunları göster") + '">' +
      '<b>' + groups[g.id].length + '</b> ' + g.name + '</button>';
  }).join("");

  if(!state.alertsOpen){ $("alertPanel").innerHTML = ""; return; }
  $("alertPanel").innerHTML = live.map(function(g){
    var list = groups[g.id], expanded = state.alertExpanded[g.id];
    var shown = expanded ? list : list.slice(0, ALERT_ROWS);
    var rows = shown.map(function(t){
      var p = getProject(t.projectId), d = daysBetween(todayISO(), t.dueDate);
      var txt = g.id === "over" ? Math.abs(d) + " gün" : g.id === "today" ? "son gün" : d + " gün kaldı";
      return '<button type="button" class="a-row" data-open="' + t.id + '">' +
        '<span class="dot" style="background:' + getUnit(t.unit).color + ';"></span>' +
        '<span class="a-row-main"><span class="a-row-title">' + esc(t.title) + '</span>' +
        (p ? '<span class="a-row-proj">' + esc(p.name) + '</span>' : "") + '</span>' +
        '<span class="a-row-days">' + txt + '</span></button>';
    }).join("");
    var more = list.length > ALERT_ROWS
      ? '<button type="button" class="a-more" data-expand="' + g.id + '">' + (expanded ? "Daha az göster" : "+" + (list.length - ALERT_ROWS) + " daha") + '</button>' : "";
    return '<div class="a-col a-' + g.id + '"><div class="a-col-head"><span class="a-col-dot"></span>' + g.name +
      '<span class="a-col-count">' + list.length + '</span></div><div class="a-rows">' + rows + more + '</div></div>';
  }).join("");
}

function dueBadge(t){
  var u = urgency(t);
  if(u === "done") return '<span class="due-badge due-done">' + ICON.check + fmtDate(t.dueDate) + '</span>';
  if(u === "cancelled") return '<span class="due-badge due-normal">' + fmtDate(t.dueDate) + '</span>';
  if(u === "over" || u === "soon"){
    var txt = dueText(t);
    return '<span class="due-badge due-' + u + '">' + ICON.clock + txt.charAt(0).toUpperCase() + txt.slice(1) + '</span>';
  }
  return '<span class="due-badge due-normal">' + ICON.clock + fmtDate(t.dueDate) + '</span>';
}
function projectTag(t){
  var p = getProject(t.projectId);
  return p ? '<span class="project-tag" style="background:' + p.color + '22; color:' + p.color + ';">' + ICON.folder + esc(p.name) + '</span>' : "";
}
function unitTag(t){
  var u = getUnit(t.unit);
  return '<span class="unit-tag" style="background:' + u.color + '22; color:' + u.color + ';"><span class="dot" style="background:' + u.color + ';"></span>' + esc(u.name) + '</span>';
}
function prioFlag(t){
  var p = PRIO_MAP[t.priority];
  return '<span class="prio-flag" style="background:' + p.soft + '; color:' + p.color + ';">' + p.name + '</span>';
}

function cardHtml(t){
  var n = latestNotes(t, 1)[0];
  var sel = !!state.selected[t.id];
  var note = n ? '<div class="note-preview">' + ICON.note + '<span class="note-text">' + esc(n.text) + '</span>' +
    (t.notes.length > 1 ? '<span class="note-count">+' + (t.notes.length - 1) + '</span>' : "") + '</div>' : "";
  return '<div class="card' + (sel ? " selected" : "") + '" draggable="true" data-id="' + t.id + '">' +
    '<div class="card-top">' +
      '<button type="button" class="card-check' + (sel ? " on" : "") + '" data-check="' + t.id + '" title="Mail için seç" aria-label="Mail için seç" aria-pressed="' + sel + '">' + ICON.check + '</button>' +
      '<div class="card-title">' + esc(t.title) + '</div>' + prioFlag(t) +
      '<button type="button" class="card-archive" data-archive="' + t.id + '" title="Arşivle" aria-label="Arşivle">' + ICON.archive + '</button>' +
      '<button type="button" class="card-del" data-del="' + t.id + '" title="İşi sil" aria-label="İşi sil">' + ICON.trash + '</button></div>' +
    (t.description ? '<div class="card-desc">' + esc(t.description) + '</div>' : "") + note +
    '<div class="card-tags">' + unitTag(t) + projectTag(t) + dueBadge(t) + '</div>' +
    '<div class="card-meta"><span>Giriş: ' + fmtDate(t.createdAt) + '</span>' +
      (t.attachments.length ? '<span class="card-att" title="' + t.attachments.length + ' ek">' + ICON.clip + t.attachments.length + '</span>' : "") +
    '</div></div>';
}

function renderBoard(){
  var tasks = filteredTasks();
  var board = $("board"), empty = $("emptyState");
  if(state.tasks.length > 0 && tasks.length === 0){ board.style.display = "none"; empty.classList.add("show"); }
  else { board.style.display = "flex"; empty.classList.remove("show"); }
  board.classList.toggle("selecting", selectionCount() > 0);
  var cols = state.pipelineFilter ? STATUSES.filter(function(s){ return s.id === state.pipelineFilter; }) : STATUSES;
  board.innerHTML = cols.map(function(s){
    var items = tasks.filter(function(t){ return t.status === s.id; }).sort(function(a, b){
      var d = PRIO_MAP[a.priority].order - PRIO_MAP[b.priority].order;
      if(d) return d;
      return (a.dueDate || "9999").localeCompare(b.dueDate || "9999");
    });
    var nSel = items.filter(function(t){ return state.selected[t.id]; }).length;
    var all = items.length > 0 && nSel === items.length;
    var check = items.length
      ? '<button type="button" class="col-check' + (all ? " on" : nSel ? " partial" : "") + '" data-colcheck="' + s.id + '" aria-pressed="' + all + '" ' +
        'title="' + (all ? "Bu sütundaki seçimi kaldır" : "Bu sütundaki tüm işleri seç") + '" aria-label="' + (all ? "Bu sütundaki seçimi kaldır" : "Bu sütundaki tüm işleri seç") + '">' +
        (nSel && !all ? '<span class="dash"></span>' : ICON.check) + '</button>' : "";
    return '<div class="column" data-status="' + s.id + '"><div class="col-head">' + check +
      '<span class="col-dot" style="background:' + s.color + ';"></span><span class="col-title">' + s.name + '</span>' +
      '<span class="col-count">' + items.length + '</span></div>' +
      '<div class="col-body" data-dropzone="' + s.id + '">' +
      (items.length ? items.map(cardHtml).join("") : '<div class="col-empty">Bu sütunda iş yok</div>') + '</div></div>';
  }).join("");
}

function renderSelectBar(){
  /* Panoda olmayan (silinmiş/arşivlenmiş) işleri seçimden düşür */
  Object.keys(state.selected).forEach(function(id){ if(!findTask(id)) delete state.selected[id]; });
  var n = selectionCount();
  $("selectCount").textContent = n;
  $("selectBar").classList.toggle("show", n > 0 && state.view === "board");
  document.body.classList.toggle("has-selection", n > 0 && state.view === "board");
}

function archiveCardHtml(t){
  var st = STATUS_MAP[t.status];
  return '<div class="archive-card" data-id="' + t.id + '">' +
    '<div class="archive-card-top"><div class="archive-card-title">' + esc(t.title) + '</div>' + prioFlag(t) + '</div>' +
    (t.description ? '<div class="archive-card-desc">' + esc(t.description) + '</div>' : "") +
    '<div class="archive-tags">' + unitTag(t) + projectTag(t) + '<span class="archive-status-tag">Arşivlendiğinde: ' + st.name + '</span>' +
      (t.attachments.length ? '<span class="archive-status-tag">' + t.attachments.length + ' ek</span>' : "") + '</div>' +
    '<div class="archive-meta-row"><span>Giriş: ' + fmtDate(t.createdAt) + '</span><span>Arşivlenme: ' + fmtDate(t.archivedAt) + '</span>' +
      (t.dueDate ? '<span>Termin: ' + fmtDate(t.dueDate) + '</span>' : "") + '</div>' +
    '<div class="archive-actions">' +
      '<button type="button" class="btn btn-sm" data-restore="' + t.id + '">' + ICON.restore + ' Geri Al</button>' +
      '<button type="button" class="btn btn-sm" style="color:#9A3B1F; border-color:#F0B79E;" data-perm-del="' + t.id + '">' + ICON.trash + ' Kalıcı Sil</button>' +
    '</div></div>';
}
function renderArchive(){
  $("archiveCountBadge").textContent = state.archive.length;
  var q = state.archiveSearch.toLowerCase();
  var items = state.archive.slice().sort(function(a, b){ return (b.archivedAt || "").localeCompare(a.archivedAt || ""); })
    .filter(function(t){ return !q || t.title.toLowerCase().indexOf(q) !== -1; });
  $("archiveList").innerHTML = items.map(archiveCardHtml).join("");
  $("archiveEmptyState").classList.toggle("show", items.length === 0);
}

/* ---------- Ayarlar ---------- */
/* Tek renk noktası; tıklayınca palet açılır (satırda ad alanına yer kalsın) */
function swatches(attr, id, current){
  return '<div class="color-pop"><button type="button" class="color-dot" data-colorpop="1" style="background:' + current + ';" title="Rengi değiştir" aria-label="Rengi değiştir"></button>' +
    '<div class="color-menu">' + PROJECT_COLORS.map(function(c){
      return '<button type="button" class="project-swatch ' + (c.toLowerCase() === String(current).toLowerCase() ? "active-swatch" : "") + '" style="background:' + c + ';" ' +
        attr + '="' + id + '" data-color="' + c + '" title="Renk seç" aria-label="Renk seç"></button>';
    }).join("") + '</div></div>';
}
function closeColorPops(except){
  Array.prototype.forEach.call(document.querySelectorAll(".color-pop.open"), function(p){ if(p !== except) p.classList.remove("open"); });
}
function renderUnitManage(){
  var last = state.units.length - 1;
  $("unitManageList").innerHTML = state.units.map(function(u, i){
    return '<div class="project-manage-item">' + swatches("data-uswatch", u.id, u.color) +
      '<input type="text" value="' + esc(u.name) + '" data-urename="' + u.id + '" maxlength="80" />' +
      '<span class="project-status-pill">' + unitTaskCount(u.id) + ' iş</span>' +
      '<div class="project-manage-actions">' +
        '<button type="button" data-umove="' + u.id + '" data-dir="-1" title="Yukarı taşı"' + (i === 0 ? " disabled" : "") + '>' + ICON.up + '</button>' +
        '<button type="button" data-umove="' + u.id + '" data-dir="1" title="Aşağı taşı"' + (i === last ? " disabled" : "") + '>' + ICON.down + '</button>' +
        '<button type="button" data-udel="' + u.id + '" title="Sil">' + ICON.trash + '</button></div></div>';
  }).join("");
}
function renderProjectManage(){
  var list = $("projectManageList"), empty = $("projectManageEmpty");
  if(!state.projects.length){ list.innerHTML = ""; empty.style.display = "block"; return; }
  empty.style.display = "none";
  list.innerHTML = sortedProjects().map(function(p){
    return '<div class="project-manage-item">' + swatches("data-swatch", p.id, p.color) +
      '<input type="text" value="' + esc(p.name) + '" data-rename="' + p.id + '" maxlength="80" />' +
      '<span class="project-status-pill ' + (p.status === "arsivlenmis" ? "archived" : "") + '">' + (p.status === "arsivlenmis" ? "Arşivde" : projectTaskCount(p.id) + " iş") + '</span>' +
      '<div class="project-manage-actions">' +
        '<button type="button" data-toggle="' + p.id + '" title="' + (p.status === "aktif" ? "Arşivle" : "Aktif Et") + '">' + ICON.archive + '</button>' +
        '<button type="button" data-pdel="' + p.id + '" title="Kalıcı Sil">' + ICON.trash + '</button></div></div>';
  }).join("");
}
function renderSettings(){ renderUnitManage(); renderProjectManage(); }

function renderAll(){
  renderSidebar(); renderPipeline(); renderAlerts(); renderBoard(); renderArchive(); renderSaveStatus(); renderSelectBar();
  if(state.view === "settings") renderSettings();
}

function switchView(v){
  state.view = v;
  $("tabBoard").classList.toggle("active", v === "board");
  $("tabArchive").classList.toggle("active", v === "archive");
  $("tabSettings").classList.toggle("active", v === "settings");
  $("boardPage").style.display = v === "board" ? "" : "none";
  $("archivePage").style.display = v === "archive" ? "flex" : "none";
  $("settingsPage").style.display = v === "settings" ? "flex" : "none";
  if(v === "settings") renderSettings();
  renderSelectBar();
}

/* =====================================================================
   İŞ MODALI
   ===================================================================== */
var editor = null;

function buildSeg(id, options, current){
  var el = $(id);
  el.dataset.value = current;
  el.innerHTML = options.map(function(o){
    var on = o.id === current;
    return '<button type="button" class="seg-opt ' + (on ? "active" : "") + '" data-val="' + o.id + '" style="' + (on ? "background:" + o.color + ";" : "") + '">' + esc(o.name) + '</button>';
  }).join("");
  el.onclick = function(e){
    var b = e.target.closest(".seg-opt"); if(!b) return;
    var val = b.getAttribute("data-val");
    el.dataset.value = val;
    Array.prototype.forEach.call(el.querySelectorAll(".seg-opt"), function(x){ x.classList.remove("active"); x.style.background = ""; });
    b.classList.add("active");
    b.style.background = options.filter(function(o){ return o.id === val; })[0].color;
  };
}
function updateDateMode(status){
  var req = needsDates(status);
  $("lblStart").innerHTML = "Başlangıç Tarihi" + (req ? ' <span class="req-mark">*</span>' : ' <span class="opt-mark">(opsiyonel)</span>');
  $("lblDue").innerHTML = "Bitiş / Termin Tarihi" + (req ? ' <span class="req-mark">*</span>' : ' <span class="opt-mark">(opsiyonel)</span>');
  $("backlogHint").style.display = req ? "none" : "flex";
}
function renderNotes(){
  var el = $("notesList");
  var notes = state.modalNotes.slice().sort(function(a, b){ return (b.createdAt || "").localeCompare(a.createdAt || ""); });
  if(!notes.length){ el.innerHTML = '<div class="note-empty">Henüz not eklenmedi.</div>'; return; }
  el.innerHTML = notes.map(function(n){
    return '<div class="note-item"><button type="button" class="note-del" data-note-del="' + n.id + '">' + ICON.x + '</button>' +
      '<span class="note-date">' + relLabel(n.date) + '</span>' + esc(n.text) + '</div>';
  }).join("");
}
function renderAttachments(){
  var el = $("attList");
  el.innerHTML = state.modalAttachments.map(function(a, i){
    var name = esc(a.name);
    return '<div class="att-item' + (a.uploading ? " uploading" : "") + '">' + ICON.file +
      (a.uploading ? '<span class="att-name">' + name + '</span><span class="att-size">yükleniyor…</span>'
        : '<a class="att-name" href="/api/attachments/' + a.id + '" target="_blank" rel="noopener" title="Aç / indir">' + name + '</a><span class="att-size">' + fmtSize(a.size) + '</span>' +
          '<button type="button" class="att-del" data-att-del="' + i + '" title="Eki kaldır" aria-label="Eki kaldır">' + ICON.x + '</button>') +
      '</div>';
  }).join("");
}
function addFiles(files){
  Array.prototype.forEach.call(files, function(f){
    if(f.size > MAX_UPLOAD){ toast('"' + f.name + '" çok büyük (en fazla 25 MB)', true); return; }
    var ph = { uploading: true, name: f.name, size: f.size };
    state.modalAttachments.push(ph); state.uploading++; renderAttachments();
    Storage.upload(f).then(function(meta){
      var i = state.modalAttachments.indexOf(ph);
      if(i !== -1) state.modalAttachments[i] = normalizeAttachment(meta);
    }, function(e){
      state.modalAttachments = state.modalAttachments.filter(function(x){ return x !== ph; });
      toast('"' + f.name + '" yüklenemedi: ' + e.message, true);
    }).then(function(){ state.uploading--; renderAttachments(); });
  });
}
/* Editöre yapıştırılan/sürüklenen resim: ek olarak yüklenir, satır içi <img> için adres döner */
function uploadImage(file){
  if(file.size > MAX_UPLOAD){ toast("Resim çok büyük (en fazla 25 MB)", true); return Promise.resolve(null); }
  state.uploading++;
  return Storage.upload(file).then(function(meta){ return "/api/attachments/" + meta.id; }, function(e){
    toast("Resim yüklenemedi: " + e.message, true); return null;
  }).then(function(src){ state.uploading--; return src; });
}

function unitOptionsFor(t){
  var opts = state.units.slice();
  if(t && !UNIT_MAP[t.unit]) opts.push(getUnit(t.unit));   // silinmiş sorumlu, seçim kaybolmasın
  return opts;
}
function openModal(id){
  var t = id ? findTask(id) : null;
  state.editingId = t ? t.id : null;
  var status = t ? (state.pendingStatus || t.status) : "backlog";
  state.pendingStatus = null;
  $("modalTitle").textContent = t ? "İşi Düzenle" : "Yeni İş";
  $("modalEntryDate").textContent = t ? "Sisteme giriş: " + fmtDate(t.createdAt) : "Kaydedilince sisteme giriş tarihi otomatik atanacak";
  $("fTitle").value = t ? t.title : "";
  editor.setHtml(t ? t.descriptionHtml : "");
  $("fStart").value = t ? isoToTR(t.startDate) : "";
  $("fDue").value = t ? isoToTR(t.dueDate) : "";
  buildSeg("fUnitSeg", unitOptionsFor(t), t ? t.unit : defaultUnitId());
  buildSeg("fPrioSeg", PRIORITIES, t ? t.priority : "orta");

  var cur = t ? t.projectId : "";
  var opts = state.projects.filter(function(p){ return p.status === "aktif" || p.id === cur; })
    .sort(function(a, b){ return a.name.localeCompare(b.name, "tr"); });
  $("fProject").innerHTML = '<option value="">Projesiz</option>' + opts.map(function(p){
    return '<option value="' + p.id + '">' + esc(p.name) + (p.status === "arsivlenmis" ? " (arşiv)" : "") + '</option>';
  }).join("");
  $("fProject").value = cur;

  $("fStatus").innerHTML = STATUSES.map(function(s){ return '<option value="' + s.id + '">' + s.name + '</option>'; }).join("");
  $("fStatus").value = status;
  updateDateMode(status);

  state.modalNotes = t ? t.notes.slice() : [];
  state.modalAttachments = t ? t.attachments.slice() : [];
  $("fNoteInput").value = "";
  renderNotes(); renderAttachments();
  $("btnDeleteTask").style.display = t ? "inline-flex" : "none";
  $("btnMailTask").style.display = t ? "inline-flex" : "none";
  $("overlay").classList.add("show");
  $("fTitle").focus();
}
function closeModal(){ $("overlay").classList.remove("show"); state.editingId = null; state.pendingStatus = null; }

function addNote(){
  var inp = $("fNoteInput"), text = inp.value.trim();
  if(!text) return;
  state.modalNotes.push({ id: uid(), text: text, date: todayISO(), createdAt: new Date().toISOString() });
  inp.value = ""; renderNotes();
}

/* Kaydedilen işi döndürür; doğrulama başarısızsa null */
function saveTask(){
  var title = $("fTitle").value.trim();
  if(!title){ toast("Lütfen bir başlık girin", true); $("fTitle").focus(); return null; }
  if(state.uploading > 0){ toast("Ekler yükleniyor, lütfen bitmesini bekleyin", true); return null; }
  var startTxt = $("fStart").value.trim(), dueTxt = $("fDue").value.trim();
  var start = trToISO(startTxt), due = trToISO(dueTxt);
  if(startTxt && !start){ toast("Başlangıç tarihi geçersiz — gg.aa.yyyy biçiminde girin", true); $("fStart").focus(); return null; }
  if(dueTxt && !due){ toast("Bitiş tarihi geçersiz — gg.aa.yyyy biçiminde girin", true); $("fDue").focus(); return null; }
  var status = $("fStatus").value;
  if(needsDates(status) && (!start || !due)){
    toast("Beklemede, Devam Ediyor ve Tamamlandı durumları için başlangıç ve bitiş tarihi zorunludur", true);
    (!start ? $("fStart") : $("fDue")).focus(); return null;
  }
  if(start && due && due < start){ toast("Bitiş tarihi başlangıç tarihinden önce olamaz", true); $("fDue").focus(); return null; }

  var html = editor.getHtml();
  var fields = {
    title: title, descriptionHtml: html, description: RichEditor.toPlain(html),
    unit: $("fUnitSeg").dataset.value, priority: $("fPrioSeg").dataset.value,
    projectId: $("fProject").value, status: status, startDate: start, dueDate: due,
    notes: state.modalNotes.slice(),
    attachments: state.modalAttachments.filter(function(a){ return a && !a.uploading; }),
    updatedAt: todayISO()
  };
  var isNew = !state.editingId, t;
  if(isNew){ t = normalizeTask(Object.assign({ id: uid(), createdAt: todayISO() }, fields)); state.tasks.push(t); }
  else { t = findTask(state.editingId); Object.assign(t, fields); }
  closeModal();
  commit(["tasks"], isNew ? "İş oluşturuldu" : "İş güncellendi");
  return t;
}

/* =====================================================================
   İŞ / ARŞİV EYLEMLERİ
   ===================================================================== */
function deleteTask(id){
  var t = findTask(id); if(!t) return;
  showConfirm({
    title: "İşi sil", message: '"' + t.title + '" işini silmek istediğinize emin misiniz? Bu işlem geri alınamaz.',
    confirmLabel: "Sil", danger: true,
    onConfirm: function(){
      state.tasks = state.tasks.filter(function(x){ return x.id !== id; });
      if(state.editingId === id) closeModal();
      commit(["tasks"], "İş silindi");
    }
  });
}
function archiveTask(id){
  var t = findTask(id); if(!t) return;
  showConfirm({
    title: "İşi arşivle", message: '"' + t.title + '" panodan kaldırılıp arşive taşınacak. İstediğiniz zaman geri alabilirsiniz.',
    confirmLabel: "Arşivle", danger: false,
    onConfirm: function(){
      state.tasks = state.tasks.filter(function(x){ return x.id !== id; });
      t.archivedAt = todayISO();
      state.archive.push(t);
      if(state.editingId === id) closeModal();
      commit(["archive", "tasks"], "İş arşivlendi");
    }
  });
}
function restoreTask(id){
  var t = findArchived(id); if(!t) return;
  state.archive = state.archive.filter(function(x){ return x.id !== id; });
  delete t.archivedAt;
  state.tasks.push(t);
  commit(["tasks", "archive"], '"' + t.title + '" panoya geri alındı');
}
function deleteArchived(id){
  var t = findArchived(id); if(!t) return;
  showConfirm({
    title: "Kalıcı olarak sil", message: '"' + t.title + '" arşivden kalıcı olarak silinecek. Bu işlem geri alınamaz.',
    confirmLabel: "Kalıcı Sil", danger: true,
    onConfirm: function(){
      state.archive = state.archive.filter(function(x){ return x.id !== id; });
      commit(["archive"], "İş arşivden silindi");
    }
  });
}
function moveTask(id, status){
  var t = findTask(id); if(!t || t.status === status) return;
  if(needsDates(status) && !hasDates(t)){
    toast("Bu işi " + STATUS_MAP[status].name + " durumuna taşımak için önce başlangıç ve bitiş tarihi girin", true);
    state.pendingStatus = status; openModal(id); return;
  }
  t.status = status; t.updatedAt = todayISO();
  commit(["tasks"], '"' + t.title + '" → ' + STATUS_MAP[status].name);
}
function toggleSelect(id){
  if(state.selected[id]) delete state.selected[id]; else state.selected[id] = true;
  renderBoard(); renderSelectBar();
}
function clearSelection(){ state.selected = {}; renderBoard(); renderSelectBar(); }
/* Sütundaki (filtreyle görünen) işlerin hepsi seçiliyse seçimi kaldırır, değilse hepsini seçer */
function toggleColumn(status){
  var items = filteredTasks().filter(function(t){ return t.status === status; });
  var all = items.length && items.every(function(t){ return state.selected[t.id]; });
  items.forEach(function(t){ if(all) delete state.selected[t.id]; else state.selected[t.id] = true; });
  renderBoard(); renderSelectBar();
}

/* =====================================================================
   SORUMLU EYLEMLERİ
   ===================================================================== */
function nextColor(used){
  return PROJECT_COLORS.filter(function(c){ return used.indexOf(c) === -1; })[0] || PROJECT_COLORS[used.length % PROJECT_COLORS.length];
}
function addUnit(){
  var inp = $("newUnitName"), name = inp.value.trim();
  if(!name){ inp.focus(); return; }
  if(state.units.some(function(u){ return u.name.toLocaleLowerCase("tr") === name.toLocaleLowerCase("tr"); })){
    toast('"' + name + '" adlı bir sorumlu zaten var', true); inp.focus(); return;
  }
  var u = normalizeUnit({ id: uid(), name: name, color: nextColor(state.units.map(function(x){ return x.color; })), order: state.units.length });
  setUnits(state.units.concat(u));
  inp.value = ""; commit(["units"], '"' + name + '" sorumlusu eklendi'); inp.focus();
}
function renameUnit(id, name){
  var u = UNIT_MAP[id]; name = name.trim();
  if(!u || !name || name === u.name){ renderUnitManage(); return; }
  u.name = name; commit(["units"], "Sorumlu adı güncellendi");
}
function recolorUnit(id, color){
  var u = UNIT_MAP[id]; if(!u) return;
  u.color = color; commit(["units"], "Sorumlu rengi güncellendi");
}
function moveUnit(id, dir){
  var i = state.units.indexOf(UNIT_MAP[id]), j = i + dir;
  if(i < 0 || j < 0 || j >= state.units.length) return;
  var a = state.units[i]; state.units[i] = state.units[j]; state.units[j] = a;
  setUnits(state.units.map(function(u, k){ u.order = k; return u; }));
  commit(["units"], "Sıralama güncellendi");
}
function deleteUnit(id){
  var u = UNIT_MAP[id]; if(!u) return;
  if(state.units.length <= 1){ showInfo("Silinemedi", "En az bir sorumlu kalmalı."); return; }
  var n = unitTaskCount(id);
  var remove = function(target){
    if(n) allTasks().forEach(function(t){ if(t.unit === id) t.unit = target; });
    setUnits(state.units.filter(function(x){ return x.id !== id; }));
    if(state.filterUnit === id) state.filterUnit = "all";
    commit(n ? ["tasks", "archive", "units"] : ["units"], '"' + u.name + '" silindi' + (n ? ", " + n + " iş aktarıldı" : ""));
  };
  if(!n) return showConfirm({ title: "Sorumluyu sil", message: '"' + u.name + '" silinecek.', confirmLabel: "Sil", danger: true, onConfirm: remove });
  var others = state.units.filter(function(x){ return x.id !== id; });
  showConfirm({
    title: "Sorumluyu sil",
    message: '"' + u.name + '" sorumlusuna bağlı ' + n + ' iş var (aktif + arşiv). Silmeden önce bu işler seçtiğiniz sorumluya aktarılacak.',
    confirmLabel: "Aktar ve sil", danger: true,
    select: { label: "İşlerin aktarılacağı sorumlu", options: others, value: others[0].id },
    onConfirm: remove
  });
}

/* =====================================================================
   PROJE EYLEMLERİ
   ===================================================================== */
function addProject(){
  var inp = $("newProjectName"), name = inp.value.trim();
  if(!name){ inp.focus(); return; }
  var color = nextColor(state.projects.map(function(p){ return p.color; }));
  state.projects.push(normalizeProject({ id: uid(), name: name, color: color, status: "aktif" }));
  inp.value = ""; commit(["projects"], '"' + name + '" projesi eklendi'); inp.focus();
}
function renameProject(id, name){
  var p = getProject(id); name = name.trim();
  if(!p || !name || name === p.name){ renderProjectManage(); return; }
  p.name = name; commit(["projects"], "Proje adı güncellendi");
}
function recolorProject(id, color){
  var p = getProject(id); if(!p) return;
  p.color = color; commit(["projects"], "Proje rengi güncellendi");
}
function toggleProject(id){
  var p = getProject(id); if(!p) return;
  p.status = p.status === "aktif" ? "arsivlenmis" : "aktif";
  commit(["projects"], '"' + p.name + '" ' + (p.status === "aktif" ? "tekrar aktifleştirildi" : "arşivlendi"));
}
function deleteProject(id){
  var p = getProject(id); if(!p) return;
  var n = projectTaskCount(id);
  var remove = function(target){
    if(n) allTasks().forEach(function(t){ if(t.projectId === id) t.projectId = target || ""; });
    state.projects = state.projects.filter(function(x){ return x.id !== id; });
    if(state.filterProject === id) state.filterProject = "all";
    commit(n ? ["tasks", "archive", "projects"] : ["projects"], "Proje silindi" + (n ? ", " + n + " iş aktarıldı" : ""));
  };
  if(!n) return showConfirm({ title: "Projeyi sil", message: '"' + p.name + '" kalıcı olarak silinecek.', confirmLabel: "Sil", danger: true, onConfirm: remove });
  showConfirm({
    title: "Projeyi sil",
    message: '"' + p.name + '" projesine bağlı ' + n + ' iş var (aktif + arşiv). Silmeden önce bu işler seçtiğiniz yere aktarılacak.',
    confirmLabel: "Aktar ve sil", danger: true,
    select: { label: "İşlerin aktarılacağı proje", value: "",
      options: [{ id: "", name: "Projesiz" }].concat(sortedProjects().filter(function(x){ return x.id !== id; })) },
    onConfirm: remove
  });
}

/* =====================================================================
   MAIL TASLAĞI (.eml)
   ===================================================================== */
var CID_DOMAIN = "@istakip";

function fetchBytes(url){
  return fetch(url, { cache: "no-store" }).then(function(r){
    if(!r.ok) throw new Error("HTTP " + r.status);
    return r.arrayBuffer().then(function(b){ return { bytes: new Uint8Array(b), type: (r.headers.get("content-type") || "").split(";")[0] }; });
  });
}
function inlineIds(html){
  var ids = [];
  String(html || "").replace(/\/api\/attachments\/([\w-]+)/g, function(_, id){ if(ids.indexOf(id) === -1) ids.push(id); return ""; });
  return ids;
}

function mailRow(label, value){
  return '<tr><td style="padding:3px 12px 3px 0;color:#5B6472;font-size:12.5px;white-space:nowrap;vertical-align:top;width:110px">' + label + '</td>' +
    '<td style="padding:3px 0;font-size:13.5px;vertical-align:top">' + value + '</td></tr>';
}
function mailTaskHtml(t, withAtt){
  var u = getUnit(t.unit), p = getProject(t.projectId), pr = PRIO_MAP[t.priority], st = STATUS_MAP[t.status];
  var g = urgencyGroup(t);
  var due = t.dueDate ? fmtDate(t.dueDate) + (g ? ' <span style="color:' + (g === "over" ? "#C2410C" : "#B45309") + ';font-weight:600">(' + dueText(t) + ')</span>' : "") : "";
  var rows = mailRow("Durum", esc(st.name)) +
    mailRow("Öncelik", '<span style="color:' + pr.hex + ';font-weight:600">' + esc(pr.name) + '</span>') +
    mailRow("Sorumlu", esc(u.name)) +
    (p ? mailRow("Proje", esc(p.name)) : "") +
    (t.startDate ? mailRow("Başlangıç", fmtDate(t.startDate)) : "") +
    (due ? mailRow("Termin", due) : "");
  var desc = t.descriptionHtml
    ? '<div style="margin-top:12px;padding-top:10px;border-top:1px solid #EAEDF2;font-size:13.5px">' +
        t.descriptionHtml   /* temizlenmiş HTML'de öznitelik yok; Outlook için satır içi stil eklenir */
          .replace(/<img src="\/api\/attachments\/([\w-]+)"/g, '<img style="max-width:100%;height:auto" src="cid:$1' + CID_DOMAIN + '"')
          .replace(/<table>/g, '<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:6px 0">')
          .replace(/<(td|th)>/g, '<$1 style="border:1px solid #D5DAE1;padding:4px 8px;font-size:13px;vertical-align:top">') + '</div>' : "";
  var notes = latestNotes(t, 3);
  var notesHtml = notes.length
    ? '<div style="margin-top:12px;font-size:12.5px;color:#5B6472;font-weight:600">Son durum notları</div><ul style="margin:4px 0 0;padding-left:18px;font-size:13px">' +
      notes.map(function(n){ return '<li style="margin:2px 0"><span style="color:#8A93A3">' + fmtDate(n.date) + '</span> — ' + esc(n.text) + '</li>'; }).join("") + '</ul>' : "";
  var atts = t.attachments.length
    ? '<div style="margin-top:12px;font-size:12.5px;color:#5B6472">Ekler' + (withAtt ? "" : " (bu maile eklenmedi)") + ': ' +
      t.attachments.map(function(a){ return esc(a.name); }).join(", ") + '</div>' : "";
  return '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;max-width:680px;border:1px solid #E1E6ED;border-left:4px solid ' + u.color + ';margin:0 0 16px;border-collapse:separate">' +
    '<tr><td style="padding:14px 16px">' +
    '<div style="font-size:16px;font-weight:700;margin:0 0 8px;color:#1A2233">' + esc(t.title) + '</div>' +
    '<table role="presentation" cellpadding="0" cellspacing="0">' + rows + '</table>' + desc + notesHtml + atts +
    '</td></tr></table>';
}
function mailTaskText(t, withAtt){
  var u = getUnit(t.unit), p = getProject(t.projectId);
  var lines = [t.title, "Durum: " + STATUS_MAP[t.status].name, "Öncelik: " + PRIO_MAP[t.priority].name, "Sorumlu: " + u.name];
  if(p) lines.push("Proje: " + p.name);
  if(t.startDate) lines.push("Başlangıç: " + fmtDate(t.startDate));
  if(t.dueDate) lines.push("Termin: " + fmtDate(t.dueDate) + (urgencyGroup(t) ? " (" + dueText(t) + ")" : ""));
  if(t.description) lines.push("", t.description);
  var notes = latestNotes(t, 3);
  if(notes.length){ lines.push("", "Son durum notları:"); notes.forEach(function(n){ lines.push("- " + fmtDate(n.date) + " — " + n.text); }); }
  if(t.attachments.length) lines.push("", "Ekler" + (withAtt ? "" : " (eklenmedi)") + ": " + t.attachments.map(function(a){ return a.name; }).join(", "));
  return lines.join("\n");
}

function mailTasks(tasks){
  if(!tasks.length) return;
  var total = 0;
  tasks.forEach(function(t){ t.attachments.forEach(function(a){ total += a.size; }); });
  if(total > MAIL_ATT_WARN){
    return showConfirm({
      title: "Ekler çok büyük",
      message: "Seçilen işlerin ekleri toplam " + fmtSize(total) + ". Outlook ve mail sunucuları genellikle 20–25 MB üstünü kabul etmez. Ekler olmadan da oluşturabilirsiniz (ek adları mailde listelenir).",
      confirmLabel: "Eklerle oluştur", cancelLabel: "Eksiz oluştur", danger: false,
      onConfirm: function(){ buildMail(tasks, true); },
      onCancel: function(){ buildMail(tasks, false); }
    });
  }
  buildMail(tasks, true);
}
function buildMail(tasks, withAtt){
  toast("Mail taslağı hazırlanıyor…");
  var failed = [];
  var inlineJobs = [], attJobs = [];
  tasks.forEach(function(t){
    inlineIds(t.descriptionHtml).forEach(function(id){
      inlineJobs.push(fetchBytes("/api/attachments/" + id).then(function(r){
        return { cid: id + CID_DOMAIN, name: id + "." + ((r.type.split("/")[1] || "bin").replace(/\W/g, "")), type: r.type, bytes: r.bytes };
      }, function(){ failed.push("satır içi resim"); return null; }));
    });
    if(withAtt) t.attachments.forEach(function(a){
      attJobs.push(fetchBytes("/api/attachments/" + a.id).then(function(r){
        return { name: a.name, type: a.type || r.type, bytes: r.bytes };
      }, function(){ failed.push(a.name); return null; }));
    });
  });
  Promise.all([Promise.all(inlineJobs), Promise.all(attJobs)]).then(function(res){
    var single = tasks.length === 1;
    var subject = single ? "İş: " + tasks[0].title : "İş durumu – " + tasks.length + " iş (" + fmtDate(todayISO()) + ")";
    var intro = single ? "Aşağıdaki işin güncel durumu bilginize sunulur." : "Aşağıda " + tasks.length + " işin güncel durumu yer almaktadır.";
    var html = '<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#1A2233;line-height:1.5">' +
      '<p style="margin:0 0 6px">Merhaba,</p><p style="margin:0 0 16px">' + intro + '</p>' +
      tasks.map(function(t){ return mailTaskHtml(t, withAtt); }).join("") + '</div>';
    var text = "Merhaba,\n\n" + intro + "\n\n" + tasks.map(function(t){ return mailTaskText(t, withAtt); }).join("\n\n----------------------------------------\n\n");
    var eml = Eml.build({ subject: subject, html: html, text: text,
      inline: res[0].filter(Boolean), attachments: res[1].filter(Boolean) });
    var d = new Date();
    download("is-takip-mail-" + todayISO().replace(/-/g, "") + "-" + pad(d.getHours()) + pad(d.getMinutes()) + ".eml",
      new Blob([eml], { type: "message/rfc822" }));
    showInfo("Mail taslağı indirildi",
      "İndirilen .eml dosyasını açın; Outlook taslak olarak açacak. Alıcıları ekleyip gönderebilirsiniz." +
      (failed.length ? " Uyarı: şu dosyalar okunamadığı için eklenmedi: " + failed.join(", ") + "." : ""));
  }).catch(function(e){ toast("Mail taslağı oluşturulamadı: " + e.message, true); });
}

/* =====================================================================
   AI ASİSTAN KÖPRÜSÜ — ai.js araç çağrılarını buradan uygular.
   Her değişiklik elle yapılanla aynı yoldan geçer: doğrula → state → commit (çakışma kontrolü dahil).
   ===================================================================== */
var aiUndoLog = {};

function aiBoardSnapshot(){
  return {
    units: state.units.map(function(u){ return { id: u.id, name: u.name }; }),
    projects: state.projects.map(function(p){ return { id: p.id, name: p.name, status: p.status }; }),
    statuses: STATUSES.map(function(x){ return { id: x.id, name: x.name }; }),
    priorities: PRIORITIES.map(function(x){ return { id: x.id, name: x.name }; }),
    tasks: state.tasks.map(function(t){
      var n = latestNotes(t, 1)[0];
      return { id: t.id, title: t.title, status: t.status, unit: t.unit, priority: t.priority, projectId: t.projectId,
        startDate: t.startDate, dueDate: t.dueDate, due: aiDueText(t), description: t.description.slice(0, 300), lastNote: n ? n.text.slice(0, 200) : "" };
    })
  };
}
/* Modelin tarih hesabı yapmasına gerek kalmasın diye termin durumu hazır metin olarak verilir */
function aiDueText(t){
  var u = urgency(t);
  if(u === "done" || u === "cancelled" || !t.dueDate) return "";
  var d = daysBetween(todayISO(), t.dueDate);
  if(u === "over") return Math.abs(d) + " gün gecikti";
  if(d === 0) return "bugün bitiyor";
  if(u === "soon") return "yakında (" + d + " gün kaldı)";
  return d + " gün kaldı";
}
var AI_URGENCY = { overdue: ["over"], today: ["today"], soon: ["soon"], attention: ["over", "today", "soon"] };
function aiListTasks(a){
  var q = str(a.query).toLocaleLowerCase("tr"), groups = AI_URGENCY[a.urgency];
  var due = aiDate(a.due_before);
  var list = state.tasks.filter(function(t){
    if(groups && groups.indexOf(urgencyGroup(t)) === -1) return false;
    if(a.status && t.status !== a.status) return false;
    if(a.unit && t.unit !== a.unit) return false;
    if(a.priority && t.priority !== a.priority) return false;
    if(a.projectId === "none" && t.projectId) return false;
    if(a.projectId && a.projectId !== "none" && t.projectId !== a.projectId) return false;
    if(due && (!t.dueDate || t.dueDate > due)) return false;
    if(q && (t.title + " " + t.description).toLocaleLowerCase("tr").indexOf(q) === -1) return false;
    return true;
  }).sort(function(x, y){ return (x.dueDate || "9999").localeCompare(y.dueDate || "9999"); });
  return { count: list.length, tasks: list.slice(0, 100).map(function(t){
    var p = getProject(t.projectId);
    return { id: t.id, title: t.title, status: STATUS_MAP[t.status].name, unit: getUnit(t.unit).name, priority: PRIO_MAP[t.priority].name,
      project: p ? p.name : "", dueDate: t.dueDate, due: aiDueText(t) };
  }) };
}
function clone(o){ return JSON.parse(JSON.stringify(o)); }
/* undefined: alan gönderilmedi · "": temizle · ISO: geçerli · null: geçersiz */
function aiDate(v){
  if(v === undefined || v === null) return undefined;
  v = String(v).trim();
  if(!v) return "";
  if(/^\d{4}-\d{2}-\d{2}$/.test(v)) return trToISO(fmtDate(v)) === v ? v : null;
  return trToISO(v) || null;
}
function aiNote(text){ return normalizeNote({ id: uid(), text: str(text).trim(), date: todayISO(), createdAt: new Date().toISOString() }); }
function aiSetDesc(t, text){ t.descriptionHtml = RichEditor.fromPlain(str(text)); t.description = RichEditor.toPlain(t.descriptionHtml); }
/* Tarih kuralı: Backlog dışında başlangıç + bitiş zorunlu, bitiş başlangıçtan önce olamaz. Hata metni ya da "" döner. */
function aiDateRule(status, start, due){
  if(needsDates(status) && (!start || !due)) return STATUS_MAP[status].name + " durumu için başlangıç ve bitiş tarihi gerekli";
  if(start && due && due < start) return "bitiş tarihi başlangıçtan önce olamaz";
  return "";
}

function aiApply(calls){
  var res = { results: [], summary: { created: [], updated: [], moved: [], skipped: [] }, token: null };
  var before = {}, created = [];
  var locked = anyOverlayOpen();
  var remember = function(t){ if(!(t.id in before) && created.indexOf(t.id) === -1) before[t.id] = clone(t); };
  var label = function(t){ return '"' + t.title + '"'; };

  (calls || []).forEach(function(call){
    var name = call && call.function && call.function.name, args, ok = [], skipped = [];
    var skip = function(who, why){ skipped.push(who + ": " + why); res.summary.skipped.push(who + ": " + why); };
    try{ args = JSON.parse((call.function && call.function.arguments) || "{}") || {}; }
    catch(e){ res.results.push({ tool_call_id: call.id, content: JSON.stringify({ error: "Argümanlar geçerli JSON değil" }) }); return; }

    if(name === "list_tasks"){
      res.results.push({ tool_call_id: call.id, content: JSON.stringify(aiListTasks(args)) });
      return;
    }
    if(name === "get_task"){
      var g = findTask(str(args.id));
      res.results.push({ tool_call_id: call.id, content: JSON.stringify(g ? {
        id: g.id, title: g.title, status: g.status, unit: g.unit, priority: g.priority, projectId: g.projectId,
        startDate: g.startDate, dueDate: g.dueDate, createdAt: g.createdAt, description: g.description,
        notes: g.notes.map(function(n){ return { date: n.date, text: n.text }; }), attachments: g.attachments.map(function(a){ return a.name; })
      } : { error: "Bu id ile aktif iş yok" }) });
      return;
    }
    if(locked){
      res.results.push({ tool_call_id: call.id, content: JSON.stringify({ error: "Kullanıcının ekranında açık bir pencere var (iş düzenleme veya onay). Değişiklik yapılmadı; kullanıcıdan pencereyi kapatıp isteği tekrarlamasını iste." }) });
      return;
    }

    if(name === "create_tasks"){
      (Array.isArray(args.tasks) ? args.tasks : []).forEach(function(it, i){
        it = it || {};
        var who = "yeni iş #" + (i + 1), title = str(it.title).trim().slice(0, 300);
        if(!title) return skip(who, "başlık boş");
        who = '"' + title + '"';
        var unit = it.unit ? str(it.unit) : defaultUnitId();
        if(!UNIT_MAP[unit]) return skip(who, "sorumlu bulunamadı (" + unit + ")");
        var prio = it.priority ? str(it.priority) : "orta";
        if(!PRIO_MAP[prio]) return skip(who, "geçersiz öncelik (" + prio + ")");
        var status = it.status ? str(it.status) : "backlog";
        if(!STATUS_MAP[status]) return skip(who, "geçersiz durum (" + status + ")");
        var pid = it.projectId ? str(it.projectId) : "";
        if(pid && !getProject(pid)) return skip(who, "proje bulunamadı (" + pid + ")");
        var start = aiDate(it.startDate), due = aiDate(it.dueDate);
        if(start === null || due === null) return skip(who, "tarih geçersiz (YYYY-AA-GG olmalı)");
        var rule = aiDateRule(status, start || "", due || "");
        if(rule) return skip(who, rule);
        var t = normalizeTask({ id: uid(), title: title, unit: unit, priority: prio, status: status, projectId: pid,
          startDate: start || "", dueDate: due || "", createdAt: todayISO(), updatedAt: todayISO(),
          descriptionHtml: RichEditor.fromPlain(str(it.description)), notes: it.note && str(it.note).trim() ? [aiNote(it.note)] : [] });
        state.tasks.push(t); created.push(t.id);
        ok.push({ id: t.id, title: t.title }); res.summary.created.push({ id: t.id, title: t.title });
      });
    }
    else if(name === "update_tasks"){
      (Array.isArray(args.updates) ? args.updates : []).forEach(function(u){
        u = u || {};
        var t = findTask(str(u.id));
        if(!t) return skip(str(u.id) || "(id yok)", "aktif iş bulunamadı (arşivde ya da silinmiş olabilir)");
        var who = label(t);
        if(u.title !== undefined && !str(u.title).trim()) return skip(who, "başlık boş olamaz");
        if(u.unit !== undefined && !UNIT_MAP[str(u.unit)]) return skip(who, "sorumlu bulunamadı (" + u.unit + ")");
        if(u.priority !== undefined && !PRIO_MAP[str(u.priority)]) return skip(who, "geçersiz öncelik (" + u.priority + ")");
        if(u.projectId !== undefined && str(u.projectId) && !getProject(str(u.projectId))) return skip(who, "proje bulunamadı (" + u.projectId + ")");
        var start = aiDate(u.startDate), due = aiDate(u.dueDate);
        if(start === null || due === null) return skip(who, "tarih geçersiz (YYYY-AA-GG olmalı)");
        var rule = aiDateRule(t.status, start === undefined ? t.startDate : start, due === undefined ? t.dueDate : due);
        if(rule) return skip(who, rule);
        remember(t);
        if(u.title !== undefined) t.title = str(u.title).trim().slice(0, 300);
        if(u.description !== undefined) aiSetDesc(t, u.description);
        if(u.unit !== undefined) t.unit = str(u.unit);
        if(u.priority !== undefined) t.priority = str(u.priority);
        if(u.projectId !== undefined) t.projectId = str(u.projectId);
        if(start !== undefined) t.startDate = start;
        if(due !== undefined) t.dueDate = due;
        if(u.add_note && str(u.add_note).trim()) t.notes.push(aiNote(u.add_note));
        t.updatedAt = todayISO();
        ok.push({ id: t.id, title: t.title }); res.summary.updated.push({ id: t.id, title: t.title });
      });
    }
    else if(name === "move_tasks"){
      (Array.isArray(args.moves) ? args.moves : []).forEach(function(m){
        m = m || {};
        var t = findTask(str(m.id)), st = str(m.status);
        if(!t) return skip(str(m.id) || "(id yok)", "aktif iş bulunamadı");
        var who = label(t);
        if(!STATUS_MAP[st]) return skip(who, "geçersiz durum (" + st + ")");
        if(t.status === st) return skip(who, "zaten " + STATUS_MAP[st].name + " durumunda");
        var rule = aiDateRule(st, t.startDate, t.dueDate);
        if(rule) return skip(who, rule + " (önce işe tarih eklenmeli)");
        remember(t);
        t.status = st; t.updatedAt = todayISO();
        ok.push({ id: t.id, title: t.title, status: STATUS_MAP[st].name }); res.summary.moved.push({ id: t.id, title: t.title, status: STATUS_MAP[st].name });
      });
    }
    else {
      res.results.push({ tool_call_id: call.id, content: JSON.stringify({ error: "Bilinmeyen araç: " + name }) });
      return;
    }
    var out = { applied: ok.length, ok: ok, skipped: skipped };
    if(!ok.length) out.warning = "HİÇBİR DEĞİŞİKLİK YAPILMADI. Kullanıcıya yapılamadığını ve nedenini açıkça söyle; 'yaptım' deme. Eksik bilgi (ör. tarih) uydurma, kullanıcıya sor.";
    else if(skipped.length) out.warning = "Yalnızca 'ok' listesindekiler uygulandı; 'skipped' listesindekiler UYGULANMADI, kullanıcıya söyle.";
    res.results.push({ tool_call_id: call.id, content: JSON.stringify(out) });
  });

  var s = res.summary, parts = [];
  if(s.created.length) parts.push(s.created.length + " iş oluşturuldu");
  if(s.updated.length) parts.push(s.updated.length + " iş güncellendi");
  if(s.moved.length) parts.push(s.moved.length + " iş taşındı");
  if(parts.length){
    res.token = "u" + uid();
    aiUndoLog[res.token] = { before: before, created: created };
    commit(["tasks"], "AI: " + parts.join(", "));
  }
  s.text = parts.join(" · ");
  return res;
}

/* Bir AI adımını geri alır: oluşturulanları kaldırır, değişenleri önceki haline döndürür. Diğer işlere dokunmaz. */
function aiUndo(token){
  var u = aiUndoLog[token];
  if(!u) return { ok: false, error: "Bu adım zaten geri alınmış" };
  if(anyOverlayOpen()) return { ok: false, error: "Önce açık pencereyi kapatın" };
  var missing = 0;
  u.created.forEach(function(id){ if(!findTask(id)) missing++; });
  state.tasks = state.tasks.filter(function(t){ return u.created.indexOf(t.id) === -1; });
  Object.keys(u.before).forEach(function(id){
    var t = findTask(id);
    if(!t){ missing++; return; }
    Object.keys(t).forEach(function(k){ delete t[k]; });
    Object.assign(t, clone(u.before[id]));
  });
  delete aiUndoLog[token];
  commit(["tasks"], "AI değişikliği geri alındı");
  return { ok: true, missing: missing };
}

/* =====================================================================
   YEDEK: DIŞA / İÇE AKTAR
   ===================================================================== */
function exportBackup(){
  var data = JSON.stringify({ schemaVersion: 2, exportedAt: new Date().toISOString(),
    tasks: state.tasks, projects: state.projects, archive: state.archive, units: state.units }, null, 2);
  download("is-takip-yedek-" + todayISO().replace(/-/g, "") + ".json", new Blob([data], { type: "application/json" }));
  toast("Yedek dosyası indirildi (ek dosyaları dahil değildir)");
}
function importBackup(file){
  var r = new FileReader();
  r.onload = function(){
    var parsed;
    try{ parsed = JSON.parse(r.result); }catch(e){ return showInfo("Dosya okunamadı", "Geçerli bir JSON dosyası seçin."); }
    var tasks, projects = null, archive = null, units = null;
    if(Array.isArray(parsed)) tasks = parsed;                       // en eski biçim: düz iş dizisi
    else if(parsed && Array.isArray(parsed.tasks)){ tasks = parsed.tasks; projects = parsed.projects; archive = parsed.archive; units = parsed.units; }
    else if(parsed && Array.isArray(parsed.items)) tasks = parsed.items; // data/tasks.json biçimi
    else return showInfo("Dosya okunamadı", "Bu uygulamadan alınmış bir yedek dosyası olmalı.");
    if(!tasks.every(function(t){ return t && typeof t.title === "string"; })) return showInfo("Dosya okunamadı", "İş kayıtlarında başlık bulunamadı.");
    var hasUnits = Array.isArray(units) && units.length > 0;
    var go = function(){
      var kinds = ["tasks"];
      if(hasUnits){ setUnits(unitsFrom(units)); kinds.push("units"); }
      state.tasks = tasks.map(normalizeTask);
      if(Array.isArray(projects)){ state.projects = projects.map(normalizeProject); kinds.push("projects"); }
      if(Array.isArray(archive)){ state.archive = archive.map(normalizeTask); kinds.push("archive"); }
      state.selected = {};
      commit(kinds, tasks.length + " iş içe aktarıldı");
    };
    var willReplace = ["Mevcut " + state.tasks.length + " aktif iş → yedekteki " + tasks.length + " iş"];
    if(Array.isArray(projects)) willReplace.push(state.projects.length + " proje → " + projects.length + " proje");
    if(Array.isArray(archive)) willReplace.push(state.archive.length + " arşiv kaydı → " + archive.length + " arşiv kaydı");
    if(hasUnits) willReplace.push(state.units.length + " sorumlu → " + units.length + " sorumlu");
    var hasData = state.tasks.length || (Array.isArray(projects) && state.projects.length) || (Array.isArray(archive) && state.archive.length) || hasUnits;
    if(hasData) showConfirm({
      title: "Yedekten geri yükle",
      message: "Şunlar değiştirilecek: " + willReplace.join("; ") + ". Devam edilsin mi?",
      confirmLabel: "İçe Aktar", danger: true, onConfirm: go
    });
    else go();
  };
  r.readAsText(file);
}

/* =====================================================================
   INIT
   ===================================================================== */
function topOverlayClose(){
  if($("confirmOverlay").classList.contains("show")) closeConfirm();
  else if($("overlay").classList.contains("show")) closeModal();
  else if(selectionCount()) clearSelection();
}
function anyOverlayOpen(){
  return ["overlay", "confirmOverlay"].some(function(id){ return $(id).classList.contains("show"); });
}

function bindDateField(id){
  var inp = $(id), picker = $(id + "Picker");
  inp.addEventListener("input", function(e){
    if(e.inputType && e.inputType.indexOf("delete") === 0) return;   // silerken noktayı geri ekleme
    inp.value = maskDate(inp.value);
  });
  inp.addEventListener("blur", function(){
    var iso = trToISO(inp.value);
    if(iso) inp.value = isoToTR(iso);                                 // 4.11.2026 → 04.11.2026
    inp.classList.toggle("invalid", !!inp.value.trim() && !iso);
  });
  picker.addEventListener("change", function(){
    if(picker.value){ inp.value = isoToTR(picker.value); inp.classList.remove("invalid"); }
  });
}
function openPicker(id){
  var picker = $(id + "Picker");
  picker.value = trToISO($(id).value) || "";
  try{ if(picker.showPicker){ picker.showPicker(); return; } }catch(e){}
  picker.focus(); picker.click();
}

function bind(){
  editor = RichEditor.create($("fDescEditor"), {
    onImage: uploadImage,
    onAttach: function(){ $("attInput").click(); },
    onFiles: addFiles
  });

  /* Üst çubuk */
  $("btnNewTask").onclick = function(){ openModal(null); };
  $("btnEmptyNew").onclick = function(){ openModal(null); };
  $("searchInput").oninput = function(e){ state.search = e.target.value; renderBoard(); };
  $("archiveSearchInput").oninput = function(e){ state.archiveSearch = e.target.value; renderArchive(); };
  $("tabBoard").onclick = function(){ switchView("board"); };
  $("tabArchive").onclick = function(){ switchView("archive"); };
  $("tabSettings").onclick = function(){ switchView("settings"); };

  /* Kenar çubuğu filtreleri (delegasyon) */
  $("unitList").onclick = function(e){ var b = e.target.closest("[data-unit]"); if(b){ state.filterUnit = b.getAttribute("data-unit"); renderAll(); } };
  $("prioFilterRow").onclick = function(e){ var b = e.target.closest("[data-prio]"); if(b){ state.filterPrio = b.getAttribute("data-prio"); renderAll(); } };
  $("projectList").onclick = function(e){ var b = e.target.closest("[data-project]"); if(b){ state.filterProject = b.getAttribute("data-project"); renderAll(); } };
  $("pipeline").onclick = function(e){
    var b = e.target.closest("[data-status]"); if(!b) return;
    var s = b.getAttribute("data-status"); state.pipelineFilter = state.pipelineFilter === s ? null : s; renderAll();
  };

  /* Uyarılar */
  $("alertsToggle").onclick = function(){
    state.alertsOpen = !state.alertsOpen; pref(PREF_ALERTS_OPEN, state.alertsOpen ? "1" : "0"); renderAlerts();
  };
  $("alertChips").onclick = function(e){
    var b = e.target.closest("[data-urg]"); if(!b) return;
    var g = b.getAttribute("data-urg"); state.urgencyFilter = state.urgencyFilter === g ? null : g;
    if(state.view !== "board") switchView("board");
    renderAll();
  };
  $("alertPanel").onclick = function(e){
    var o = e.target.closest("[data-open]"), x = e.target.closest("[data-expand]");
    if(o) openModal(o.getAttribute("data-open"));
    else if(x){ var g = x.getAttribute("data-expand"); state.alertExpanded[g] = !state.alertExpanded[g]; renderAlerts(); }
  };

  $("saveStatus").onclick = function(e){
    if(e.target.closest("[data-reload]")) showConfirm({
      title: "Sayfayı yenile",
      message: "Dosya başka bir pencerede/sekmede değiştirildi. Yenilerseniz dosyadaki güncel veri yüklenir; bu penceredeki kaydedilmemiş son değişiklik kaybolur.",
      confirmLabel: "Yenile", danger: true,
      onConfirm: function(){ skipUnloadWarning = true; location.reload(); }
    });
    else if(e.target.closest("[data-retry]")) Storage.flush().then(function(ok){ toast(ok ? "Kaydedildi" : "Hâlâ kaydedilemiyor: " + Storage.getError(), !ok); });
  };

  /* Pano: tıklama + sürükle-bırak (delegasyon) */
  var board = $("board");
  board.onclick = function(e){
    var col = e.target.closest("[data-colcheck]");
    if(col){ toggleColumn(col.getAttribute("data-colcheck")); return; }
    var chk = e.target.closest(".card-check"), arch = e.target.closest(".card-archive"), del = e.target.closest(".card-del"), card = e.target.closest(".card");
    if(chk){ e.stopPropagation(); toggleSelect(chk.getAttribute("data-check")); }
    else if(arch){ e.stopPropagation(); archiveTask(arch.getAttribute("data-archive")); }
    else if(del){ e.stopPropagation(); deleteTask(del.getAttribute("data-del")); }
    else if(card){
      if(e.ctrlKey || e.metaKey){ toggleSelect(card.getAttribute("data-id")); return; }   // Ctrl+tık ile hızlı seçim
      openModal(card.getAttribute("data-id"));
    }
  };
  board.ondragstart = function(e){
    var c = e.target.closest(".card"); if(!c) return;
    c.classList.add("dragging");
    e.dataTransfer.setData("text/plain", c.getAttribute("data-id")); e.dataTransfer.effectAllowed = "move";
  };
  board.ondragend = function(e){ var c = e.target.closest(".card"); if(c) c.classList.remove("dragging"); };
  board.ondragover = function(e){
    var z = e.target.closest(".col-body"); if(!z) return;
    e.preventDefault(); z.closest(".column").classList.add("drag-over");
  };
  board.ondragleave = function(e){
    var z = e.target.closest(".col-body");
    if(z && !z.contains(e.relatedTarget)) z.closest(".column").classList.remove("drag-over");
  };
  board.ondrop = function(e){
    var z = e.target.closest(".col-body"); if(!z) return;
    e.preventDefault(); z.closest(".column").classList.remove("drag-over");
    moveTask(e.dataTransfer.getData("text/plain"), z.getAttribute("data-dropzone"));
  };

  /* Seçim çubuğu */
  $("btnSelectAll").onclick = function(){ filteredTasks().forEach(function(t){ state.selected[t.id] = true; }); renderBoard(); renderSelectBar(); };
  $("btnSelectClear").onclick = clearSelection;
  $("btnMailSelected").onclick = function(){ mailTasks(selectedTasks()); };

  /* Arşiv listesi */
  $("archiveList").onclick = function(e){
    var r = e.target.closest("[data-restore]"), d = e.target.closest("[data-perm-del]");
    if(r) restoreTask(r.getAttribute("data-restore"));
    else if(d) deleteArchived(d.getAttribute("data-perm-del"));
  };

  /* İş modalı */
  $("modalClose").onclick = closeModal;
  $("btnCancel").onclick = closeModal;
  $("btnSaveTask").onclick = function(){ saveTask(); };
  $("btnMailTask").onclick = function(){ var t = saveTask(); if(t) mailTasks([t]); };
  $("btnDeleteTask").onclick = function(){ if(state.editingId) deleteTask(state.editingId); };
  $("btnAddNote").onclick = addNote;
  $("fNoteInput").onkeydown = function(e){ if(e.key === "Enter" && !e.shiftKey){ e.preventDefault(); addNote(); } };
  $("notesList").onclick = function(e){
    var b = e.target.closest("[data-note-del]"); if(!b) return;
    var id = b.getAttribute("data-note-del");
    state.modalNotes = state.modalNotes.filter(function(n){ return n.id !== id; }); renderNotes();
  };
  $("attInput").onchange = function(e){ if(e.target.files.length) addFiles(e.target.files); e.target.value = ""; };
  $("attList").onclick = function(e){
    var b = e.target.closest("[data-att-del]"); if(!b) return;
    state.modalAttachments.splice(+b.getAttribute("data-att-del"), 1); renderAttachments();
  };
  $("fStatus").onchange = function(e){ updateDateMode(e.target.value); };
  bindDateField("fStart"); bindDateField("fDue");
  Array.prototype.forEach.call(document.querySelectorAll(".date-pick"), function(b){
    b.onclick = function(){ openPicker(b.getAttribute("data-pick")); };
  });
  $("overlay").onclick = function(e){ if(e.target.id === "overlay") closeModal(); };

  /* Ayarlar: sorumlular */
  $("btnAddUnit").onclick = addUnit;
  $("newUnitName").onkeydown = function(e){ if(e.key === "Enter"){ e.preventDefault(); addUnit(); } };
  var ul = $("unitManageList");
  ul.onchange = function(e){ var i = e.target.closest("[data-urename]"); if(i) renameUnit(i.getAttribute("data-urename"), i.value); };
  ul.onkeydown = function(e){ if(e.key === "Enter" && e.target.matches("[data-urename]")) e.target.blur(); };
  ul.onclick = function(e){
    var s = e.target.closest("[data-uswatch]"), m = e.target.closest("[data-umove]"), d = e.target.closest("[data-udel]");
    if(s) recolorUnit(s.getAttribute("data-uswatch"), s.getAttribute("data-color"));
    else if(m) moveUnit(m.getAttribute("data-umove"), +m.getAttribute("data-dir"));
    else if(d) deleteUnit(d.getAttribute("data-udel"));
  };

  /* Ayarlar: projeler */
  $("btnAddProject").onclick = addProject;
  $("newProjectName").onkeydown = function(e){ if(e.key === "Enter"){ e.preventDefault(); addProject(); } };
  var pl = $("projectManageList");
  pl.onchange = function(e){ var i = e.target.closest("[data-rename]"); if(i) renameProject(i.getAttribute("data-rename"), i.value); };
  pl.onkeydown = function(e){ if(e.key === "Enter" && e.target.matches("[data-rename]")) e.target.blur(); };
  pl.onclick = function(e){
    var s = e.target.closest("[data-swatch]"), t = e.target.closest("[data-toggle]"), d = e.target.closest("[data-pdel]");
    if(s) recolorProject(s.getAttribute("data-swatch"), s.getAttribute("data-color"));
    else if(t) toggleProject(t.getAttribute("data-toggle"));
    else if(d) deleteProject(d.getAttribute("data-pdel"));
  };

  /* Onay penceresi */
  $("confirmCancelBtn").onclick = function(){ var cb = cancelCb; closeConfirm(); if(cb) cb(); };
  $("confirmOkBtn").onclick = function(){
    var cb = confirmCb, val = $("confirmSelectWrap").style.display !== "none" ? $("confirmSelect").value : undefined;
    closeConfirm(); if(cb) cb(val);
  };
  $("confirmOverlay").onclick = function(e){ if(e.target.id === "confirmOverlay") closeConfirm(); };

  /* Yedek */
  $("btnExport").onclick = exportBackup;
  $("btnImport").onclick = function(){ $("fileInput").click(); };
  $("fileInput").onchange = function(e){ if(e.target.files[0]) importBackup(e.target.files[0]); e.target.value = ""; };
  $("btnClear").onclick = function(){
    if(!state.tasks.length) return;
    showConfirm({
      title: "Tüm aktif işleri sil",
      message: state.tasks.length + " aktif iş silinecek. Arşiv ve projeler korunur. Önce yedek almanız önerilir. Bu işlem geri alınamaz.",
      confirmLabel: "Hepsini Sil", danger: true,
      onConfirm: function(){ state.tasks = []; commit(["tasks"], "Tüm aktif işler silindi"); }
    });
  };

  /* Ayarlar: renk paleti aç/kapa (dışarı tıklayınca kapanır) */
  document.addEventListener("click", function(e){
    var dot = e.target.closest("[data-colorpop]");
    var pop = dot ? dot.parentNode : null;
    closeColorPops(pop);
    if(pop) pop.classList.toggle("open");
  });

  document.onkeydown = function(e){
    if(e.key !== "Escape") return;
    if(document.querySelector(".color-pop.open")) return closeColorPops();
    topOverlayClose();
  };

  /* Kayıt bitmeden sekme kapanırsa uyar */
  window.addEventListener("beforeunload", function(e){
    if(!skipUnloadWarning && Storage.hasUnsaved()){ e.preventDefault(); e.returnValue = ""; }
  });

  /* Sekmeye/pencereye dönüldüğünde, kaydedilmemiş değişiklik yoksa dosyadaki güncel veriyi yeniden oku
     (dosya elle düzenlendiyse ya da başka sekmede değişiklik yapıldıysa ekran güncellenir). */
  var reloadFromServer = function(){
    if(document.visibilityState !== "visible" || Storage.hasUnsaved() || anyOverlayOpen()) return;
    if(window.AiChat && AiChat.isBusy()) return;   // AI turu sürerken veri altından değişmesin
    if(document.activeElement && document.activeElement.matches && document.activeElement.matches("[data-rename],[data-urename]")) return;
    Storage.load().then(function(data){
      if(Storage.hasUnsaved() || anyOverlayOpen()) return;
      applyServerState(data); setFatal(false); renderAll();
    }).catch(function(){});
  };
  document.addEventListener("visibilitychange", reloadFromServer);
  window.addEventListener("focus", reloadFromServer);

  /* AI asistan paneli + model ayarları */
  AiModels.init({ confirm: showConfirm, toast: toast });
  AiChat.init({
    getBoard: aiBoardSnapshot,
    applyTools: aiApply,
    undo: aiUndo,
    openTask: function(id){
      if(!findTask(id)) return toast("Bu iş artık panoda değil", true);
      if(state.view !== "board") switchView("board");
      openModal(id);
    }
  });
}
var skipUnloadWarning = false;

function setFatal(on){
  $("fatalOverlay").classList.toggle("show", on);
  document.querySelector(".app").inert = on;   // kilitliyken klavyeyle arkadaki düğmelere ulaşılamasın
}

function boot(){
  setFatal(false);
  Storage.load().then(function(data){
    applyServerState(data);
    renderAll();
  }).catch(function(e){
    setFatal(true);
    var p = $("fatalOverlay").querySelector("p");
    if(e && e.message && e.message.indexOf("okunamadı") !== -1){
      p.innerHTML = "Sunucu çalışıyor ama bir veri dosyası okunamadı:<br><b>" + esc(e.message) + "</b><br><br>" +
        "Dosyayı data/ klasöründe düzeltin (ya da data/backup/ içindeki son yedekle değiştirin) ve tekrar deneyin. Uygulama, bozuk veriyi ezmemek için kilitli tutuluyor.";
    }
  });
}

bind();
$("fatalRetry").onclick = boot;
boot();

})();
