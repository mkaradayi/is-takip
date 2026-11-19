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
var PREF_STATUS_TAB = "isTakip.statusTab";   // panoda son seçilen durum sekmesi

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
  tasks: [], projects: [], archive: [], units: [], reminders: [], memos: [], projectNotes: [],
  projectView: null, pnSearch: "", pnEditingId: null, pnProjectId: null, pnBase: null, pnAttachments: [],
  view: "board",
  remEditing: null, remShowDone: false, remPresetTask: "",
  memoEditing: null, memoSearch: "", memoPresetTask: "",
  filterUnit: "all", filterPrio: "all", filterProject: "all", urgencyFilter: null,
  statusTab: STATUS_MAP[pref(PREF_STATUS_TAB)] ? pref(PREF_STATUS_TAB) : "devam", search: "", archiveSearch: "",
  editingId: null, modalNotes: [], modalAttachments: [], uploading: 0, pendingStatus: null, modalBase: null,
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
/* Hatırlatma / kişisel not: tarih zorunlu, saat ve iş bağlantısı isteğe bağlı */
var TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
function normalizeReminder(r){
  r = r && typeof r === "object" ? r : {};
  return {
    id: safeId(r.id) || uid(),
    text: str(r.text).slice(0, 2000),
    date: isoDay(r.date) || todayISO(),
    time: TIME_RE.test(r.time) ? r.time : "",
    taskId: safeId(r.taskId),
    done: r.done === true,
    doneAt: typeof r.doneAt === "string" ? r.doneAt : "",
    createdAt: typeof r.createdAt === "string" ? r.createdAt : new Date().toISOString()
  };
}
/* Kişisel not ("Notlarım"): tarihsiz; yalnızca metin ve isteğe bağlı iş bağlantısı. Zamanlar otomatik tutulur. */
function normalizeMemo(m){
  m = m && typeof m === "object" ? m : {};
  var created = typeof m.createdAt === "string" && m.createdAt ? m.createdAt : new Date().toISOString();
  return {
    id: safeId(m.id) || uid(),
    text: str(m.text).slice(0, 5000),
    taskId: safeId(m.taskId),
    createdAt: created,
    updatedAt: typeof m.updatedAt === "string" && m.updatedAt ? m.updatedAt : created
  };
}
/* Proje notu: zengin metin (temizlenmiş html) + ekler. text, arama/önizleme/LLM için html'den türetilir. */
function normalizeProjectNote(n){
  n = n && typeof n === "object" ? n : {};
  var html = RichEditor.sanitize(typeof n.html === "string" ? n.html : RichEditor.fromPlain(str(n.text)));
  var created = typeof n.createdAt === "string" && n.createdAt ? n.createdAt : new Date().toISOString();
  return {
    id: safeId(n.id) || uid(),
    projectId: safeId(n.projectId),
    title: str(n.title).slice(0, 200),
    html: html,
    text: RichEditor.toPlain(html),
    attachments: Array.isArray(n.attachments) ? n.attachments.map(normalizeAttachment).filter(Boolean) : [],
    createdAt: created,
    updatedAt: typeof n.updatedAt === "string" && n.updatedAt ? n.updatedAt : created
  };
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
  state.reminders = (data.reminders || []).map(normalizeReminder);
  if(state.remEditing && !findReminder(state.remEditing)) state.remEditing = null;
  state.memos = (data.memos || []).map(normalizeMemo);
  if(state.memoEditing && !findMemo(state.memoEditing)) state.memoEditing = null;
  state.projectNotes = (data.projectNotes || []).map(normalizeProjectNote);
  if(state.projectView && !getProject(state.projectView)) state.projectView = null;
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
function findReminder(id){ return state.reminders.filter(function(r){ return r.id === id; })[0] || null; }
function findMemo(id){ return state.memos.filter(function(m){ return m.id === id; })[0] || null; }
function findProjectNote(id){ return state.projectNotes.filter(function(n){ return n.id === id; })[0] || null; }
function notesOfProject(id){ return state.projectNotes.filter(function(n){ return n.projectId === id; }); }

/* =====================================================================
   STORAGE — sunucudaki data/*.json dosyalarına tek geçit
   ===================================================================== */
var Storage = (function(){
  var KINDS = ["tasks", "projects", "archive", "units", "reminders", "memos", "projectNotes"];
  var dirty = {}, version = {}, base = {};   // base: türün en son bilinen updatedAt değeri (çakışma kontrolü)
  KINDS.forEach(function(k){ dirty[k] = false; version[k] = 0; base[k] = ""; });
  var chain = Promise.resolve();
  var pending = 0;
  var status = "idle";          // idle | saving | saved | error
  var lastError = "";
  var lastSavedAt = "";
  var loaded = false;           // sunucudan başarıyla okunmadan hiçbir şey yazılmaz (boş state dosyayı ezmesin)
  var conflict = false;         // veri başka pencerede değişti; yenilemeden yazılmaz

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
      /* Arayüz güncellendi ama sunucu eski kodla çalışıyor (yeni veri türünü tanımıyor) */
      if(e.status === 404) e.message = "Sunucu eski sürümle çalışıyor. servis\\servis-kur.bat ile (ya da node server.js penceresini kapatıp yeniden açarak) sunucuyu yeniden başlatın";
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
/* Arama için Türkçe küçük harfe çevirir; "ı" de "i" sayılır (ISTANBUL / İstanbul / istanbul eşleşsin) */
function searchKey(s){ return String(s || "").toLocaleLowerCase("tr").replace(/ı/g, "i"); }
/* Eşleşme yoksa "", varsa nerede bulunduğu: "title" | "desc" | "note" */
function taskMatch(t, q){
  if(!q) return "title";
  if(searchKey(t.title).indexOf(q) !== -1) return "title";
  if(searchKey(t.description).indexOf(q) !== -1) return "desc";
  if(t.notes.some(function(n){ return searchKey(n.text).indexOf(q) !== -1; })) return "note";
  return "";
}
function filteredTasks(){
  var q = searchKey(state.search.trim());
  return state.tasks.filter(function(t){
    if(state.filterUnit !== "all" && t.unit !== state.filterUnit) return false;
    if(state.filterPrio !== "all" && t.priority !== state.filterPrio) return false;
    if(state.filterProject === "none" && t.projectId) return false;
    if(state.filterProject !== "all" && state.filterProject !== "none" && t.projectId !== state.filterProject) return false;
    if(state.urgencyFilter && urgencyGroup(t) !== state.urgencyFilter) return false;
    if(q && !taskMatch(t, q)) return false;
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
  file:    SV + '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/></svg>',
  bell:    SV + '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>',
  edit:    SV + '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  link:    SV + '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>',
  calendar: SV + '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></svg>'
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

/* Durum sekmeleri: sayılar kenar çubuğu filtrelerine, aramaya ve uyarı filtresine göre hesaplanır */
function statusCounts(tasks){
  var c = {}; STATUSES.forEach(function(s){ c[s.id] = 0; });
  tasks.forEach(function(t){ if(c[t.status] != null) c[t.status]++; });
  return c;
}
function filterActive(){
  return !!(state.search.trim() || state.urgencyFilter || state.filterUnit !== "all" || state.filterPrio !== "all" || state.filterProject !== "all");
}
function setStatusTab(id){
  if(!STATUS_MAP[id]) return;
  state.statusTab = id; pref(PREF_STATUS_TAB, id);
  renderPipeline(); renderBoard();
}
function renderPipeline(){
  var counts = statusCounts(filteredTasks()), hl = filterActive();
  $("pipeline").innerHTML = STATUSES.map(function(s){
    var on = state.statusTab === s.id, c = counts[s.id];
    return '<button type="button" role="tab" aria-selected="' + on + '" class="stab' + (on ? " active" : "") + (hl && c && !on ? " hit" : "") + '" data-status="' + s.id + '" style="--st:' + s.color + ';"' +
      ' title="' + s.name + (hl ? " — filtreyle eşleşen " + c + " iş" : " — " + c + " iş") + ' (kartı buraya sürükleyerek durumunu değiştirebilirsiniz)">' +
      '<span class="stab-dot"></span><span class="stab-name">' + s.name + '</span><span class="stab-count">' + c + '</span></button>';
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
  var rems = dueReminders();
  var total = groups.over.length + groups.today.length + groups.soon.length + rems.length;
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
  }).join("") + (rems.length
    ? '<button type="button" class="a-chip a-rem" data-remgo="1" title="Hatırlatmalar sayfasını aç">' + ICON.bell + '<b>' + rems.length + '</b> Hatırlatma</button>' : "");

  if(!state.alertsOpen){ $("alertPanel").innerHTML = ""; return; }
  var remCol = rems.length ? '<div class="a-col a-rem"><div class="a-col-head"><span class="a-col-dot"></span>Hatırlatmalar' +
    '<span class="a-col-count">' + rems.length + '</span></div><div class="a-rows">' + rems.slice(0, ALERT_ROWS).map(function(r){
      return '<button type="button" class="a-row" data-remgo="1"><span class="a-row-main"><span class="a-row-title">' + esc(r.text.split("\n")[0]) + '</span></span>' +
        '<span class="a-row-days">' + (remGroup(r) === "over" ? (-daysBetween(todayISO(), r.date)) + " gün" : r.time || "bugün") + '</span></button>';
    }).join("") + (rems.length > ALERT_ROWS ? '<button type="button" class="a-more" data-remgo="1">+' + (rems.length - ALERT_ROWS) + ' daha</button>' : "") + '</div></div>' : "";
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
  }).join("") + remCol;
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

/* Arama başlıkta değil de açıklama/notta eşleştiyse kartta küçük bir ipucu gösterilir */
function matchHint(t){
  var q = searchKey(state.search.trim()); if(!q) return "";
  var m = taskMatch(t, q);
  return m === "desc" || m === "note" ? '<span class="match-hint">' + (m === "desc" ? "açıklamada" : "notta") + ' eşleşti</span>' : "";
}
/* İşe bağlı, tamamlanmamış hatırlatma varsa zil (bugün/gecikmiş olanlar vurgulu) */
function remBell(t){
  var rs = taskReminders(t.id); if(!rs.length) return "";
  var due = rs.some(function(r){ var g = remGroup(r); return g === "over" || g === "today"; });
  return '<span class="card-bell' + (due ? " due" : "") + '" title="' + rs.length + ' hatırlatma · ilki: ' + esc(remWhen(rs[0])) + '">' + ICON.bell + rs.length + '</span>';
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
    '<div class="card-meta"><span>Giriş: ' + fmtDate(t.createdAt) + '</span>' + matchHint(t) + remBell(t) +
      (t.attachments.length ? '<span class="card-att" title="' + t.attachments.length + ' ek">' + ICON.clip + t.attachments.length + '</span>' : "") +
    '</div></div>';
}

function tabTasks(tasks, status){
  return tasks.filter(function(t){ return t.status === status; }).sort(function(a, b){
    var d = PRIO_MAP[a.priority].order - PRIO_MAP[b.priority].order;
    if(d) return d;
    return (a.dueDate || "9999").localeCompare(b.dueDate || "9999");
  });
}
/* Pano: seçili durum sekmesinin işleri kart ızgarasında; üstte "tümünü seç" çubuğu */
function renderBoard(){
  var tasks = filteredTasks();
  var board = $("board"), empty = $("emptyState");
  if(state.tasks.length > 0 && tasks.length === 0){ board.style.display = "none"; empty.classList.add("show"); }
  else { board.style.display = ""; empty.classList.remove("show"); }
  board.classList.toggle("selecting", selectionCount() > 0);
  var s = STATUS_MAP[state.statusTab];
  var items = tabTasks(tasks, s.id);
  var nSel = items.filter(function(t){ return state.selected[t.id]; }).length;
  var all = items.length > 0 && nSel === items.length;
  var lbl = all ? "Bu sekmedeki seçimi kaldır" : "Bu sekmedeki tüm işleri seç";
  var check = items.length
    ? '<button type="button" class="col-check' + (all ? " on" : nSel ? " partial" : "") + '" data-colcheck="' + s.id + '" aria-pressed="' + all + '" title="' + lbl + '" aria-label="' + lbl + '">' +
      (nSel && !all ? '<span class="dash"></span>' : ICON.check) + '</button>' : "";
  var bar = '<div class="tab-toolbar">' + check +
    (items.length ? '<span class="tab-toolbar-label" data-colcheck="' + s.id + '">' + (all ? "Seçimi kaldır" : "Tümünü seç") + '</span><span class="tab-toolbar-sep">·</span>' : "") +
    '<span class="tab-toolbar-count"><b>' + items.length + '</b> iş' + (nSel ? " · " + nSel + " seçili" : "") + '</span>' +
    '<span class="spacer"></span><span class="tab-toolbar-hint">Öncelik, sonra termine göre sıralı · durumu değiştirmek için kartı bir sekmeye sürükleyin</span></div>';
  var body;
  if(items.length) body = '<div class="tab-grid">' + items.map(cardHtml).join("") + '</div>';
  else {
    /* Bu sekme boş ama filtreyle eşleşen işler başka sekmelerdeyse oraya geçiş bağlantıları göster */
    var counts = statusCounts(tasks);
    var others = STATUSES.filter(function(x){ return x.id !== s.id && counts[x.id]; });
    body = '<div class="tab-empty">Bu sekmede ' + (filterActive() ? "filtreyle eşleşen " : "") + 'iş yok.' +
      (others.length ? '<div class="tab-empty-links">' + (filterActive() ? "Eşleşmeler: " : "Diğer sekmeler: ") + others.map(function(x){
        return '<button type="button" class="tab-jump" data-goto="' + x.id + '" style="--st:' + x.color + ';"><span class="stab-dot"></span>' + x.name + ' <b>' + counts[x.id] + '</b></button>';
      }).join("") + '</div>' : "") + '</div>';
  }
  board.innerHTML = bar + body;
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
  var q = searchKey(state.archiveSearch.trim());
  var items = state.archive.slice().sort(function(a, b){ return (b.archivedAt || "").localeCompare(a.archivedAt || ""); })
    .filter(function(t){ return !q || !!taskMatch(t, q); });
  $("archiveList").innerHTML = items.map(archiveCardHtml).join("");
  $("archiveEmptyState").classList.toggle("show", items.length === 0);
}

/* ---------- Hatırlatmalar ---------- */
var REM_GROUPS = [
  { id: "over",  name: "Gecikmiş" },
  { id: "today", name: "Bugün" },
  { id: "soon",  name: "Yaklaşan (7 gün)" },
  { id: "later", name: "Daha sonra" }
];
function remGroup(r){
  if(r.done) return "done";
  var d = daysBetween(todayISO(), r.date);
  return d < 0 ? "over" : d === 0 ? "today" : d <= 7 ? "soon" : "later";
}
/* Tarih, sonra saat (saatsizler günün başında), sonra eklenme sırası */
function remSort(a, b){ return a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.createdAt.localeCompare(b.createdAt); }
/* Bugün ve gecikmiş, tamamlanmamış hatırlatmalar (uyarı rozeti + kenar çubuğu sayısı) */
function dueReminders(){ return state.reminders.filter(function(r){ var g = remGroup(r); return g === "over" || g === "today"; }).sort(remSort); }
function taskReminders(id){ return state.reminders.filter(function(r){ return !r.done && r.taskId === id; }).sort(remSort); }
function remWhen(r){
  var d = daysBetween(todayISO(), r.date), t = r.time ? " " + r.time : "";
  if(r.done) return fmtDate(r.date) + t;
  if(d === 0) return "Bugün" + t;
  if(d === 1) return "Yarın" + t;
  if(d < 0) return fmtDate(r.date) + t + " · " + (-d) + " gün gecikti";
  return fmtDate(r.date) + t + (d <= 7 ? " · " + d + " gün sonra" : "");
}
/* Hatırlatma ve notlardaki bağlı iş çipi: aktif işse tıklanınca iş açılır */
function taskChip(taskId){
  if(!taskId) return "";
  var t = findTask(taskId);
  if(t) return '<button type="button" class="rem-task" data-open-task="' + t.id + '" title="İşi aç">' + ICON.link + '<span>' + esc(t.title) + '</span></button>';
  var a = findArchived(taskId);
  if(a) return '<span class="rem-task off" title="Bağlı iş arşivde">' + ICON.link + '<span>' + esc(a.title) + ' (arşivde)</span></span>';
  return '<span class="rem-task off">' + ICON.link + '<span>(silinmiş iş)</span></span>';
}
function remTaskChip(r){ return taskChip(r.taskId); }
/* "İşe bağla" seçenekleri: aktif işler duruma göre gruplu; seçili iş artık panoda değilse yine de korunur */
function taskOptions(selected){
  var h = '<option value="">İşe bağlama (isteğe bağlı)</option>';
  STATUSES.forEach(function(s){
    var list = state.tasks.filter(function(t){ return t.status === s.id; }).sort(function(a, b){ return a.title.localeCompare(b.title, "tr"); });
    if(list.length) h += '<optgroup label="' + s.name + '">' + list.map(function(t){
      return '<option value="' + t.id + '"' + (t.id === selected ? " selected" : "") + '>' + esc(t.title) + '</option>';
    }).join("") + '</optgroup>';
  });
  if(selected && !findTask(selected)) h += '<option value="' + selected + '" selected>(arşivdeki / silinmiş iş)</option>';
  return h;
}
function dateFieldHtml(id, value){
  return '<div class="date-field"><input type="text" id="' + id + '" value="' + esc(value) + '" placeholder="gg.aa.yyyy" inputmode="numeric" maxlength="10" autocomplete="off" />' +
    '<button type="button" class="date-pick" data-pick="' + id + '" title="Takvimden seç" aria-label="Takvimden seç">' + ICON.calendar + '</button>' +
    '<input type="date" class="date-native" id="' + id + 'Picker" tabindex="-1" aria-hidden="true" /></div>';
}
function remRowHtml(r){
  if(state.remEditing === r.id) return remEditHtml(r);
  var lbl = r.done ? "Tamamlanmadı olarak işaretle" : "Tamamlandı olarak işaretle";
  return '<div class="rem-row rem-' + remGroup(r) + '" data-rid="' + r.id + '">' +
    '<button type="button" class="rem-check' + (r.done ? " on" : "") + '" data-rdone="' + r.id + '" title="' + lbl + '" aria-label="' + lbl + '" aria-pressed="' + r.done + '">' + ICON.check + '</button>' +
    '<div class="rem-main"><div class="rem-text">' + esc(r.text) + '</div>' +
      '<div class="rem-meta"><span class="rem-when">' + (r.time ? ICON.clock : ICON.calendar) + remWhen(r) + '</span>' + remTaskChip(r) + '</div></div>' +
    '<div class="rem-actions">' +
      '<button type="button" data-redit="' + r.id + '" title="Düzenle" aria-label="Düzenle">' + ICON.edit + '</button>' +
      '<button type="button" data-rdel="' + r.id + '" title="Sil" aria-label="Sil">' + ICON.trash + '</button></div></div>';
}
function remEditHtml(r){
  return '<div class="rem-row editing" data-rid="' + r.id + '"><div class="rem-form">' +
    '<textarea class="rem-e-text" maxlength="2000" rows="2">' + esc(r.text) + '</textarea>' +
    '<div class="rem-form-row">' + dateFieldHtml("remEditDate", isoToTR(r.date)) +
      '<input type="time" class="rem-e-time" value="' + r.time + '" title="Saat (isteğe bağlı)" />' +
      '<select class="rem-e-task">' + taskOptions(r.taskId) + '</select>' +
      '<span class="spacer"></span>' +
      '<button type="button" class="btn btn-sm" data-rcancel="1">Vazgeç</button>' +
      '<button type="button" class="btn btn-sm btn-primary" data-rsave="' + r.id + '">Kaydet</button></div></div></div>';
}
function renderReminders(){
  var due = dueReminders().length, badge = $("remCountBadge");
  badge.textContent = due; badge.style.display = due ? "" : "none";
  if(state.view !== "reminders") return;
  /* Düzenleme formu açıkken yeniden çizim yazılanı silmesin */
  var keep = null, ed = document.querySelector("#remList .rem-row.editing");
  if(ed && state.remEditing === ed.getAttribute("data-rid")){
    keep = { text: ed.querySelector(".rem-e-text").value, date: $("remEditDate").value, time: ed.querySelector(".rem-e-time").value, task: ed.querySelector(".rem-e-task").value };
  }
  var list = state.reminders.slice().sort(remSort);
  var html = REM_GROUPS.map(function(g){
    var items = list.filter(function(r){ return remGroup(r) === g.id; });
    if(!items.length) return "";
    return '<section class="rem-group rem-g-' + g.id + '"><h3 class="rem-group-head"><span class="rem-dot"></span>' + g.name +
      '<span class="rem-group-count">' + items.length + '</span></h3>' + items.map(remRowHtml).join("") + '</section>';
  }).join("");
  var done = list.filter(function(r){ return r.done; }).sort(function(a, b){ return b.doneAt.localeCompare(a.doneAt); });
  if(done.length){
    html += '<section class="rem-group rem-g-done"><button type="button" class="rem-group-head rem-toggle" data-rtoggle="1" aria-expanded="' + state.remShowDone + '">' +
      (state.remShowDone ? ICON.down : ICON.up) + 'Tamamlanan<span class="rem-group-count">' + done.length + '</span></button>' +
      (state.remShowDone ? done.map(remRowHtml).join("") : "") + '</section>';
  }
  $("remList").innerHTML = html;
  $("remEmpty").classList.toggle("show", !state.reminders.length);
  if(state.remEditing && $("remEditDate")){
    bindDateField("remEditDate");
    if(keep){
      ed = document.querySelector("#remList .rem-row.editing");
      ed.querySelector(".rem-e-text").value = keep.text; $("remEditDate").value = keep.date;
      ed.querySelector(".rem-e-time").value = keep.time; ed.querySelector(".rem-e-task").value = keep.task;
    }
  }
  var sel = $("rTask"), cur = state.remPresetTask || sel.value;
  sel.innerHTML = taskOptions(cur); sel.value = findTask(cur) ? cur : "";
  state.remPresetTask = "";
  $("btnNotifyPerm").style.display = window.Notification && Notification.permission === "default" ? "" : "none";
}

/* Eylemler */
function readRemForm(text, dateTxt, time, taskId){
  text = text.trim();
  if(!text){ toast("Hatırlatma metnini yazın", true); return null; }
  var date = dateTxt.trim() ? trToISO(dateTxt) : todayISO();   // tarih boşsa bugün
  if(!date){ toast("Tarih geçersiz — gg.aa.yyyy biçiminde girin", true); return null; }
  return { text: text, date: date, time: TIME_RE.test(time) ? time : "", taskId: safeId(taskId) };
}
function addReminder(){
  var f = readRemForm($("rText").value, $("rDate").value, $("rTime").value, $("rTask").value);
  if(!f){ $("rText").focus(); return; }
  state.reminders.push(normalizeReminder(Object.assign({ id: uid(), createdAt: new Date().toISOString() }, f)));
  $("rText").value = ""; $("rDate").value = ""; $("rTime").value = ""; $("rTask").value = ""; $("rDate").classList.remove("invalid");
  commit(["reminders"], "Hatırlatma eklendi (" + remWhen(state.reminders[state.reminders.length - 1]) + ")");
  $("rText").focus();
}
function saveReminderEdit(id){
  var r = findReminder(id), ed = document.querySelector('#remList .rem-row.editing[data-rid="' + id + '"]');
  if(!r || !ed) return;
  var f = readRemForm(ed.querySelector(".rem-e-text").value, $("remEditDate").value, ed.querySelector(".rem-e-time").value, ed.querySelector(".rem-e-task").value);
  if(!f) return;
  Object.assign(r, f);
  state.remEditing = null;
  commit(["reminders"], "Hatırlatma güncellendi");
}
function toggleReminderDone(id){
  var r = findReminder(id); if(!r) return;
  r.done = !r.done; r.doneAt = r.done ? new Date().toISOString() : "";
  commit(["reminders"], r.done ? "Hatırlatma tamamlandı" : "Hatırlatma yeniden açıldı");
}
function deleteReminder(id){
  var r = findReminder(id); if(!r) return;
  showConfirm({
    title: "Hatırlatmayı sil", message: '"' + r.text.slice(0, 80) + (r.text.length > 80 ? "…" : "") + '" silinecek.',
    confirmLabel: "Sil", danger: true,
    onConfirm: function(){
      state.reminders = state.reminders.filter(function(x){ return x.id !== id; });
      if(state.remEditing === id) state.remEditing = null;
      commit(["reminders"], "Hatırlatma silindi");
    }
  });
}
/* İş penceresinden: (gerekirse kaydedip) Hatırlatmalar sayfasını bu iş seçili açar */
function addReminderForTask(){
  var id = state.editingId; if(!id) return;
  if(modalDirty()){ if(!saveTask()) return; } else closeModal();
  state.remPresetTask = id;
  switchView("reminders");
  $("rText").focus();
}

/* ---------- Notlarım (tarihsiz kişisel notlar) ---------- */
function memoTime(isoStr){
  var d = new Date(isoStr); if(isNaN(d)) return "";
  var day = isoOf(d), hm = pad(d.getHours()) + ":" + pad(d.getMinutes());
  return relLabel(day) + " " + hm;
}
function taskMemos(id){ return state.memos.filter(function(m){ return m.taskId === id; }); }
function memoRowHtml(m){
  if(state.memoEditing === m.id){
    return '<div class="rem-row editing" data-mid="' + m.id + '"><div class="rem-form">' +
      '<textarea class="memo-e-text" maxlength="5000" rows="4">' + esc(m.text) + '</textarea>' +
      '<div class="rem-form-row"><select class="memo-e-task">' + taskOptions(m.taskId) + '</select><span class="spacer"></span>' +
      '<button type="button" class="btn btn-sm" data-mcancel="1">Vazgeç</button>' +
      '<button type="button" class="btn btn-sm btn-primary" data-msave="' + m.id + '">Kaydet</button></div></div></div>';
  }
  var edited = m.updatedAt !== m.createdAt;
  return '<div class="rem-row memo-row" data-mid="' + m.id + '">' + ICON.note +
    '<div class="rem-main"><div class="rem-text">' + esc(m.text) + '</div>' +
      '<div class="rem-meta"><span class="memo-time" title="Oluşturuldu: ' + esc(memoTime(m.createdAt)) + '">' + (edited ? "Güncellendi " : "") + esc(memoTime(m.updatedAt)) + '</span>' + taskChip(m.taskId) + '</div></div>' +
    '<div class="rem-actions">' +
      '<button type="button" data-medit="' + m.id + '" title="Düzenle" aria-label="Düzenle">' + ICON.edit + '</button>' +
      '<button type="button" data-mdel="' + m.id + '" title="Sil" aria-label="Sil">' + ICON.trash + '</button></div></div>';
}
function renderMemos(){
  var badge = $("memoCountBadge");
  badge.textContent = state.memos.length; badge.style.display = state.memos.length ? "" : "none";
  if(state.view !== "memos") return;
  var keep = null, ed = document.querySelector("#memoList .rem-row.editing");
  if(ed && state.memoEditing === ed.getAttribute("data-mid")) keep = { text: ed.querySelector(".memo-e-text").value, task: ed.querySelector(".memo-e-task").value };
  var q = searchKey(state.memoSearch.trim());
  var list = state.memos.filter(function(m){
    if(!q) return true;
    var t = findTask(m.taskId) || findArchived(m.taskId);
    return searchKey(m.text).indexOf(q) !== -1 || (t && searchKey(t.title).indexOf(q) !== -1);
  }).sort(function(a, b){ return b.updatedAt.localeCompare(a.updatedAt); });   // en son güncellenen başta
  $("memoList").innerHTML = list.map(memoRowHtml).join("");
  $("memoEmpty").classList.toggle("show", !state.memos.length);
  $("memoNoMatch").classList.toggle("show", !!state.memos.length && !list.length);
  if(keep && (ed = document.querySelector("#memoList .rem-row.editing"))){
    ed.querySelector(".memo-e-text").value = keep.text; ed.querySelector(".memo-e-task").value = keep.task;
  }
  var sel = $("memoTask"), cur = state.memoPresetTask || sel.value;
  sel.innerHTML = taskOptions(cur); sel.value = findTask(cur) ? cur : "";
  state.memoPresetTask = "";
}
function addMemo(){
  var text = $("memoText").value.trim();
  if(!text){ toast("Not metnini yazın", true); $("memoText").focus(); return; }
  var now = new Date().toISOString();
  state.memos.push(normalizeMemo({ id: uid(), text: text, taskId: $("memoTask").value, createdAt: now, updatedAt: now }));
  $("memoText").value = ""; $("memoTask").value = "";
  commit(["memos"], "Not eklendi");
  $("memoText").focus();
}
function saveMemoEdit(id){
  var m = findMemo(id), ed = document.querySelector('#memoList .rem-row.editing[data-mid="' + id + '"]');
  if(!m || !ed) return;
  var text = ed.querySelector(".memo-e-text").value.trim();
  if(!text){ toast("Not metni boş olamaz", true); return; }
  var taskId = safeId(ed.querySelector(".memo-e-task").value);
  state.memoEditing = null;
  if(text === m.text && taskId === m.taskId){ renderMemos(); return; }   // değişiklik yok: zamanı güncelleme
  m.text = text; m.taskId = taskId; m.updatedAt = new Date().toISOString();
  commit(["memos"], "Not güncellendi");
}
function deleteMemo(id){
  var m = findMemo(id); if(!m) return;
  showConfirm({
    title: "Notu sil", message: '"' + m.text.slice(0, 80) + (m.text.length > 80 ? "…" : "") + '" silinecek.',
    confirmLabel: "Sil", danger: true,
    onConfirm: function(){
      state.memos = state.memos.filter(function(x){ return x.id !== id; });
      if(state.memoEditing === id) state.memoEditing = null;
      commit(["memos"], "Not silindi");
    }
  });
}
function addMemoForTask(){
  var id = state.editingId; if(!id) return;
  if(modalDirty()){ if(!saveTask()) return; } else closeModal();
  state.memoPresetTask = id;
  switchView("memos");
  $("memoText").focus();
}

/* Saati gelen hatırlatmalar: sayfa açıkken 30 sn'de bir bakılır; her biri oturumda bir kez bildirilir */
var remNotified = {}, remLastDay = todayISO(), remTimer = null;
function checkReminderTimes(){
  var now = new Date(), today = todayISO(), hm = pad(now.getHours()) + ":" + pad(now.getMinutes());
  if(today !== remLastDay){ remLastDay = today; renderAll(); }   // gün döndü: gruplar ve rozetler güncellensin
  var fired = state.reminders.filter(function(r){
    var key = r.id + "|" + r.date + "|" + r.time;
    if(r.done || !r.time || r.date !== today || r.time > hm || remNotified[key]) return false;
    remNotified[key] = true; return true;
  });
  if(!fired.length) return;
  toast(fired.length === 1 ? "🔔 " + fired[0].time + " · " + fired[0].text.slice(0, 140) : "🔔 " + fired.length + " hatırlatmanın saati geldi");
  if(window.Notification && Notification.permission === "granted"){
    fired.forEach(function(r){
      try{
        var n = new Notification("İş Takip — hatırlatma", { body: r.time + " · " + r.text.slice(0, 200), tag: "rem-" + r.id });
        n.onclick = function(){ window.focus(); switchView("reminders"); n.close(); };
      }catch(e){}
    });
  }
}

/* ---------- Projeler: liste + proje detayı (işler, notlar, dosyalar) ---------- */
var pnEditor = null;
function projectStats(p){
  var tasks = state.tasks.filter(function(t){ return t.projectId === p.id; });
  var notes = notesOfProject(p.id);
  return {
    tasks: tasks, notes: notes,
    over: tasks.filter(function(t){ return urgencyGroup(t) === "over"; }).length,
    archived: state.archive.filter(function(t){ return t.projectId === p.id; }).length,
    files: notes.reduce(function(n, x){ return n + x.attachments.length; }, 0),
    lastNote: notes.reduce(function(m, x){ return x.updatedAt > m ? x.updatedAt : m; }, "")
  };
}
function projectFiles(p){
  var out = [];
  notesOfProject(p.id).sort(function(a, b){ return b.updatedAt.localeCompare(a.updatedAt); }).forEach(function(n){
    n.attachments.forEach(function(a){ out.push({ att: a, note: n }); });
  });
  return out;
}
function renderProjects(){
  var active = state.projects.filter(function(p){ return p.status === "aktif"; }).length, badge = $("projCountBadge");
  badge.textContent = active; badge.style.display = active ? "" : "none";
  if(state.view !== "projects") return;
  var p = state.projectView ? getProject(state.projectView) : null;
  if(state.projectView && !p) state.projectView = null;
  $("projListView").style.display = p ? "none" : "";
  $("projDetailView").style.display = p ? "" : "none";
  if(p) renderProjectDetail(p); else renderProjectList();
}
function projectCardHtml(p){
  var s = projectStats(p);
  return '<button type="button" class="proj-card' + (p.status === "arsivlenmis" ? " archived" : "") + '" data-proj-open="' + p.id + '" style="--pc:' + p.color + ';">' +
    '<span class="proj-card-name"><span class="proj-dot"></span>' + esc(p.name) + '</span>' +
    '<span class="proj-card-stats">' +
      '<span><b>' + s.tasks.length + '</b> aktif iş</span>' +
      (s.over ? '<span class="over"><b>' + s.over + '</b> gecikmiş</span>' : "") +
      '<span><b>' + s.notes.length + '</b> not</span>' +
      '<span><b>' + s.files + '</b> dosya</span></span>' +
    '<span class="proj-card-foot">' + (s.lastNote ? "Son not: " + esc(memoTime(s.lastNote)) : "Henüz not yok") + '</span></button>';
}
function renderProjectList(){
  var act = sortedProjects().filter(function(p){ return p.status === "aktif"; });
  var arc = sortedProjects().filter(function(p){ return p.status !== "aktif"; });
  $("projGrid").innerHTML = act.map(projectCardHtml).join("");
  $("projArchivedWrap").style.display = arc.length ? "" : "none";
  $("projArchivedGrid").innerHTML = arc.map(projectCardHtml).join("");
  $("projEmpty").classList.toggle("show", !state.projects.length);
}
function renderProjectDetail(p){
  var s = projectStats(p);
  $("projTitle").innerHTML = '<span class="proj-dot" style="--pc:' + p.color + ';"></span>' + esc(p.name) +
    (p.status !== "aktif" ? ' <span class="project-status-pill archived">Arşivde</span>' : "");
  /* İşler: durum sayıları (tıklayınca pano o proje + durumla açılır) ve listesi */
  var counts = statusCounts(s.tasks);
  $("projStatusChips").innerHTML = STATUSES.map(function(st){
    return '<button type="button" class="tab-jump" data-proj-status="' + st.id + '" style="--st:' + st.color + ';"' + (counts[st.id] ? "" : " disabled") + '>' +
      '<span class="stab-dot"></span>' + st.name + ' <b>' + counts[st.id] + '</b></button>';
  }).join("") + (s.archived ? '<span class="proj-muted">' + s.archived + ' iş arşivde</span>' : "");
  var tl = s.tasks.slice().sort(function(a, b){
    var ua = { over: 0, today: 1, soon: 2 }, ga = ua[urgencyGroup(a)], gb = ua[urgencyGroup(b)];
    return (ga == null ? 9 : ga) - (gb == null ? 9 : gb) || PRIO_MAP[a.priority].order - PRIO_MAP[b.priority].order;
  });
  $("projTasks").innerHTML = tl.length ? tl.slice(0, 12).map(function(t){
    return '<button type="button" class="proj-task" data-open="' + t.id + '"><span class="stab-dot" style="--st:' + STATUS_MAP[t.status].color + ';"></span>' +
      '<span class="proj-task-title">' + esc(t.title) + '</span>' + dueBadge(t) + '</button>';
  }).join("") + (tl.length > 12 ? '<button type="button" class="a-more" data-proj-board="1">Panoda tümünü gör (' + tl.length + ')</button>' : "")
    : '<div class="note-empty">Bu projede aktif iş yok.</div>';
  /* Notlar */
  var q = searchKey(state.pnSearch.trim());
  var notes = s.notes.filter(function(n){ return !q || searchKey(n.title + " " + n.text).indexOf(q) !== -1; })
    .sort(function(a, b){ return b.updatedAt.localeCompare(a.updatedAt); });
  $("pnList").innerHTML = notes.map(function(n){
    return '<button type="button" class="pn-card" data-pn-open="' + n.id + '">' +
      '<span class="pn-card-head"><span class="pn-card-title">' + esc(n.title || "Adsız not") + '</span><span class="memo-time">' + esc(memoTime(n.updatedAt)) + '</span></span>' +
      (n.text ? '<span class="pn-card-text">' + esc(n.text.slice(0, 400)) + '</span>' : "") +
      (n.attachments.length ? '<span class="pn-card-att">' + ICON.clip + n.attachments.length + ' ek</span>' : "") + '</button>';
  }).join("");
  $("pnEmpty").style.display = notes.length ? "none" : "";
  $("pnEmpty").textContent = s.notes.length ? "Aramayla eşleşen not yok." : "Henüz not yok. \"Yeni not\" ile toplantı notları, kararlar, yazışmalar ekleyin; dosya da ekleyebilirsiniz.";
  $("pnCount").textContent = s.notes.length;
  /* Dosyalar (notlardaki tüm ekler) */
  var files = projectFiles(p);
  $("projFiles").innerHTML = files.length ? files.map(function(f){
    return '<div class="proj-file">' + ICON.file +
      '<span class="proj-file-main"><a class="proj-file-name" href="/api/attachments/' + f.att.id + '" target="_blank" rel="noopener" title="Aç / indir">' + esc(f.att.name) + '</a>' +
      '<span class="proj-file-sub"><span class="att-size">' + fmtSize(f.att.size) + '</span>' + attTextBadge(f.att.id) +
      '<button type="button" class="proj-file-note" data-pn-open="' + f.note.id + '" title="Notu aç">' + esc(f.note.title || "Adsız not") + '</button></span></span></div>';
  }).join("") : '<div class="note-empty">Notlara eklenen dosyalar burada listelenir.</div>';
  $("projFileCount").textContent = files.length;
  loadAttTextStatus(files.map(function(f){ return f.att.id; }));
  renderPa(p);
}

/* Eklerden metin çıkarma durumu (LLM'e hangi dosyaların içeriğinin gidebileceği). Sunucu sonucu önbelleğe alır. */
var attTextCache = {}, attTextPending = {};
var ATT_TEXT_LABEL = {
  ok:          ["ok",   "✓ okunabilir"],
  partial:     ["warn", "⚠ kısmen okunabilir"],
  none:        ["bad",  "✗ okunamadı"],
  unsupported: ["off",  "– desteklenmiyor"]
};
function attTextBadge(id){
  var r = attTextCache[id];
  if(!r) return '<span class="att-text pending" data-att-st="' + id + '">metin okunuyor…</span>';
  var l = ATT_TEXT_LABEL[r.status] || ATT_TEXT_LABEL.none;
  var tip = r.status === "ok" || r.status === "partial" ? r.chars.toLocaleString("tr-TR") + " karakter metin LLM'e verilebilir" + (r.reason ? " · " + r.reason : "") : r.reason;
  return '<span class="att-text ' + l[0] + '" data-att-st="' + id + '" title="' + esc(tip) + '">' + l[1] +
    (r.status === "ok" || r.status === "partial" ? ' · ' + (r.chars >= 1000 ? Math.round(r.chars / 1000) + " bin" : r.chars) + " kr." : "") + '</span>';
}
function loadAttTextStatus(ids){
  var need = ids.filter(function(id){ return !attTextCache[id] && !attTextPending[id]; });
  if(!need.length) return;
  need.forEach(function(id){ attTextPending[id] = true; });
  fetch("/api/attachments/text-status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: need }) })
    .then(function(r){ return r.ok ? r.json() : { items: {} }; })
    .then(function(j){
      need.forEach(function(id){ delete attTextPending[id]; if(j.items && j.items[id]) attTextCache[id] = j.items[id]; });
      /* Yalnızca rozetleri güncelle (tüm sayfayı yeniden çizme) */
      need.forEach(function(id){
        Array.prototype.forEach.call(document.querySelectorAll('[data-att-st="' + id + '"]'), function(el){ el.outerHTML = attTextBadge(id); });
      });
      if(state.view === "projects" && state.projectView) renderPaSources();   // asistanın kaynak özeti dosya durumlarına bağlı
    }, function(){ need.forEach(function(id){ delete attTextPending[id]; }); });
}

/* ---------- Proje asistanı (LLM): projenin notları + eklerin metni üzerinden soru-cevap ----------
   Bağlamı sunucu kurar; buradan yalnızca hangi not/eklerin dahil olduğu gider. Sohbet yalnızca bellekte tutulur. */
var PA_QUICK = {
  ozet:    "Bu projenin kaynaklarına göre kısa bir yönetici özeti çıkar: amaç, mevcut durum, son önemli gelişmeler ve sıradaki adımlar.",
  riskler: "Kaynaklara göre açık konuları, riskleri ve engelleri listele; her biri için varsa sorumlu kişiyi ve tarihi belirt.",
  kararlar: "Kaynaklarda alınmış kararları ve aksiyon maddelerini listele (kim, ne, ne zaman). Tarihi olmayanları ayrıca belirt."
};
var pa = { projectId: null, items: [], history: [], busy: false, ctrl: null, exclNotes: {}, exclFiles: {}, tasks: false, srcOpen: false };
function paReset(projectId){
  if(pa.ctrl) try{ pa.ctrl.abort(); }catch(e){}
  pa = { projectId: projectId, items: [], history: [], busy: false, ctrl: null, exclNotes: {}, exclFiles: {}, tasks: false, srcOpen: false };
}
function paBudget(){ var m = window.AiModels ? AiModels.selected() : null; return m && !m.builtin ? 40000 : 150000; }
/* Seçili kaynaklar: varsayılan olarak tüm notlar ve okunabilir dosyalar (yeni eklenenler de otomatik dahil) */
function paSources(p){
  var notes = notesOfProject(p.id).sort(function(a, b){ return b.updatedAt.localeCompare(a.updatedAt); });
  var files = projectFiles(p).map(function(f){
    var st = attTextCache[f.att.id], readable = !!st && (st.status === "ok" || st.status === "partial");
    return { att: f.att, note: f.note, st: st, readable: readable, on: readable && !pa.exclFiles[f.att.id] };
  });
  return {
    notes: notes.map(function(n){ return { note: n, on: !pa.exclNotes[n.id] }; }),
    files: files,
    chars: notes.filter(function(n){ return !pa.exclNotes[n.id]; }).reduce(function(s, n){ return s + n.text.length; }, 0) +
      files.filter(function(f){ return f.on; }).reduce(function(s, f){ return s + f.st.chars; }, 0) +
      (pa.tasks ? state.tasks.concat(state.archive).filter(function(t){ return t.projectId === p.id; }).length * 300 : 0)
  };
}
function kChars(n){ return n >= 1000 ? Math.round(n / 1000).toLocaleString("tr-TR") + " bin" : String(n); }
function renderPaSources(){
  var p = getProject(state.projectView); if(!p) return;
  var s = paSources(p), budget = paBudget();
  var nOn = s.notes.filter(function(x){ return x.on; }).length, fOn = s.files.filter(function(x){ return x.on; }).length;
  var fRead = s.files.filter(function(x){ return x.readable; }).length, pending = s.files.some(function(x){ return !x.st; });
  $("paSrcSummary").innerHTML = '<b>Kaynaklar:</b> ' + nOn + '/' + s.notes.length + ' not · ' + fOn + '/' + s.files.length + ' dosya' +
    (s.files.length > fRead && !pending ? ' <span class="proj-muted">(' + (s.files.length - fRead) + ' dosya okunamıyor)</span>' : "") +
    (pa.tasks ? ' · işler dahil' : "") + ' · ≈ ' + kChars(s.chars) + ' karakter' +
    (s.chars > budget ? ' <span class="pa-warn" title="Gönderilirken büyük kaynaklar kısaltılır">— sınır ' + kChars(budget) + ', kısaltılacak</span>' : "");
  $("paSrcToggle").textContent = pa.srcOpen ? "Seçimi kapat" : "Kaynakları seç";
  $("paSrcList").style.display = pa.srcOpen ? "" : "none";
  if(pa.srcOpen){
    $("paSrcList").innerHTML =
      '<label class="pa-chk pa-chk-all"><input type="checkbox" data-pa-tasks="1"' + (pa.tasks ? " checked" : "") + '> Projenin işlerini de ekle <span class="proj-muted">(başlık, durum, tarihler, son notlar)</span></label>' +
      (s.notes.length ? '<div class="pa-src-head">Notlar</div>' + s.notes.map(function(x){
        return '<label class="pa-chk"><input type="checkbox" data-pa-note="' + x.note.id + '"' + (x.on ? " checked" : "") + '> ' + esc(x.note.title || "Adsız not") +
          ' <span class="proj-muted">' + kChars(x.note.text.length) + ' kr.</span></label>';
      }).join("") : "") +
      (s.files.length ? '<div class="pa-src-head">Dosyalar</div>' + s.files.map(function(x){
        return '<label class="pa-chk' + (x.readable ? "" : " off") + '"><input type="checkbox" data-pa-file="' + x.att.id + '"' + (x.on ? " checked" : "") + (x.readable ? "" : " disabled") + '> ' +
          esc(x.att.name) + ' ' + attTextBadge(x.att.id) + '</label>';
      }).join("") : "");
  }
}
function paModelOptions(list){
  var sel = $("paModel"), cur = AiModels.selected();
  sel.innerHTML = list.map(function(m){ return '<option value="' + esc(m.id) + '"' + (m.available ? "" : " disabled") + '>' + esc(m.name) + (m.available ? "" : " (anahtar yok)") + '</option>'; }).join("");
  sel.value = cur.id;
  $("paFoot").textContent = "Seçilen notlar ve dosya içerikleri " + (cur.builtin ? "OpenRouter'a (internet)" : cur.baseUrl + " adresine") + " gönderilir. Sohbet kaydedilmez.";
  if(state.view === "projects" && state.projectView) renderPaSources();   // bütçe modele bağlı
}
function paRenderLog(){
  $("paLog").innerHTML = pa.items.map(function(it, i){
    if(it.kind === "user") return '<div class="pa-msg user">' + esc(it.text) + '</div>';
    if(it.kind === "error") return '<div class="pa-msg err">' + esc(it.text) + '</div>';
    var u = it.used || [], nN = u.filter(function(x){ return x.kind === "note"; }).length, nF = u.filter(function(x){ return x.kind === "file"; }).length;
    var cut = u.filter(function(x){ return x.truncated; }).map(function(x){ return x.name; });
    return '<div class="pa-msg bot">' + AiChat.format(it.text) +
      '<div class="pa-meta">' + esc(it.modelName || "") + ' · ' + nN + ' not, ' + nF + ' dosya' + (u.some(function(x){ return x.kind === "tasks"; }) ? ", işler" : "") + ' kullanıldı' +
        (cut.length ? '<br><span class="pa-warn">Kısaltılan: ' + esc(cut.join(", ")) + '</span>' : "") +
        (it.unreadable && it.unreadable.length ? '<br>Okunamayan: ' + esc(it.unreadable.join(", ")) : "") + '</div>' +
      '<div class="pa-actions"><button type="button" class="btn btn-sm" data-pa-save="' + i + '"' + (it.saved ? " disabled" : "") + '>' + ICON.note + (it.saved ? "Nota kaydedildi" : "Yanıtı nota kaydet") + '</button>' +
        '<button type="button" class="btn btn-sm btn-ghost" data-pa-copy="' + i + '">Kopyala</button></div></div>';
  }).join("") + (pa.busy ? '<div class="pa-msg bot pa-thinking"><span class="pa-dots"><i></i><i></i><i></i></span> Kaynaklar okunuyor ve yanıt hazırlanıyor… <button type="button" class="btn btn-sm btn-ghost" data-pa-stop="1">Durdur</button></div>' : "");
  $("paLog").style.display = pa.items.length || pa.busy ? "" : "none";
  $("paSend").disabled = pa.busy;
  Array.prototype.forEach.call(document.querySelectorAll("[data-pa-q]"), function(b){ b.disabled = pa.busy; });
  var log = $("paLog"); log.scrollTop = log.scrollHeight;
}
function paAsk(question){
  question = String(question || "").trim();
  var p = getProject(state.projectView);
  if(!question || !p || pa.busy) return;
  var s = paSources(p);
  if(!s.notes.some(function(x){ return x.on; }) && !s.files.some(function(x){ return x.on; }) && !pa.tasks){
    toast("En az bir not, okunabilir dosya ya da 'işler' seçin", true); return;
  }
  pa.items.push({ kind: "user", text: question });
  pa.busy = true; pa.ctrl = window.AbortController ? new AbortController() : null;
  paRenderLog();
  var pid = p.id, ctrl = pa.ctrl;
  fetch("/api/ai/project", {
    method: "POST", headers: { "Content-Type": "application/json" }, signal: ctrl ? ctrl.signal : undefined,
    body: JSON.stringify({ projectId: pid, question: question, history: pa.history,
      noteIds: s.notes.filter(function(x){ return x.on; }).map(function(x){ return x.note.id; }),
      /* Okunamayan dosyalar da gönderilir: sunucu onları içerik yerine yalnızca adıyla bildirir */
      attIds: s.files.filter(function(x){ return x.on || (x.st && !x.readable); }).map(function(x){ return x.att.id; }),
      includeTasks: pa.tasks, modelId: AiModels.selected().id })
  }).then(function(r){
    return r.json().catch(function(){ return {}; }).then(function(j){ if(!r.ok) throw new Error(j.error || ("HTTP " + r.status)); return j; });
  }).then(function(j){
    if(pa.projectId !== pid || pa.ctrl !== ctrl) return;   // bu arada proje değişti / yeni sohbet
    pa.items.push({ kind: "bot", text: j.answer, question: question, used: j.used, unreadable: j.unreadable, modelName: j.modelName });
    pa.history.push({ role: "user", content: question }, { role: "assistant", content: j.answer });
  }, function(e){
    if(pa.projectId !== pid || pa.ctrl !== ctrl) return;
    pa.items.push({ kind: "error", text: e.name === "AbortError" ? "Durduruldu." : "Yanıt alınamadı: " + e.message });
  }).then(function(){
    if(pa.projectId !== pid || pa.ctrl !== ctrl) return;
    pa.busy = false; pa.ctrl = null; paRenderLog();
  });
}
function paSaveAnswer(i){
  var it = pa.items[i], p = getProject(state.projectView);
  if(!it || it.kind !== "bot" || it.saved || !p) return;
  var now = new Date().toISOString();
  var html = RichEditor.sanitize('<p><b>Soru:</b> ' + esc(it.question) + '</p>' + AiChat.format(it.text) +
    '<p><i>' + esc((it.modelName || "AI") + " yanıtı · " + memoTime(now)) + '</i></p>');
  state.projectNotes.push(normalizeProjectNote({ id: uid(), projectId: p.id, title: ("Asistan: " + it.question).slice(0, 120), html: html, createdAt: now, updatedAt: now }));
  it.saved = true;
  commit(["projectNotes"], "Yanıt proje notu olarak kaydedildi");
}
function renderPa(p){
  if(pa.projectId !== p.id) paReset(p.id);
  renderPaSources(); paRenderLog();
}
function openProject(id){ state.projectView = id; state.pnSearch = ""; $("pnSearch").value = ""; switchView("projects"); }

/* Proje notu penceresi */
function pnSnapshot(){
  return JSON.stringify([$("pnTitle").value, pnEditor.getHtml(), $("pnProject").value, state.pnAttachments.map(function(a){ return a.id || a.name; })]);
}
function openProjectNote(id, projectId){
  var n = id ? findProjectNote(id) : null;
  state.pnEditingId = n ? n.id : null;
  state.pnProjectId = n ? n.projectId : projectId;
  $("pnModalTitle").textContent = n ? "Notu düzenle" : "Yeni proje notu";
  $("pnModalSub").textContent = n ? "Oluşturuldu: " + memoTime(n.createdAt) + (n.updatedAt !== n.createdAt ? " · Güncellendi: " + memoTime(n.updatedAt) : "") : "";
  $("pnTitle").value = n ? n.title : "";
  pnEditor.setHtml(n ? n.html : "");
  var cur = state.pnProjectId;
  $("pnProject").innerHTML = state.projects.filter(function(p){ return p.status === "aktif" || p.id === cur; })
    .sort(function(a, b){ return a.name.localeCompare(b.name, "tr"); })
    .map(function(p){ return '<option value="' + p.id + '">' + esc(p.name) + '</option>'; }).join("");
  $("pnProject").value = cur;
  state.pnAttachments = n ? n.attachments.slice() : [];
  renderPnAttachments();
  $("btnPnDelete").style.display = n ? "" : "none";
  $("pnOverlay").classList.add("show");
  state.pnBase = pnSnapshot();
  $("pnTitle").focus();
}
function closeProjectNote(){ $("pnOverlay").classList.remove("show"); state.pnEditingId = null; state.pnBase = null; }
function requestCloseProjectNote(){
  if(!state.pnBase || pnSnapshot() === state.pnBase) return closeProjectNote();
  showConfirm({ title: "Kaydedilmemiş değişiklikler", message: "Bu notta kaydetmediğiniz değişiklikler var. Kaydetmeden kapatırsanız kaybolacak.",
    confirmLabel: "Kaydetmeden kapat", cancelLabel: "Düzenlemeye dön", danger: true, onConfirm: closeProjectNote });
}
function renderPnAttachments(){
  $("pnAttList").innerHTML = state.pnAttachments.map(function(a, i){
    var name = esc(a.name);
    return '<div class="att-item' + (a.uploading ? " uploading" : "") + '">' + ICON.file +
      (a.uploading ? '<span class="att-name">' + name + '</span><span class="att-size">yükleniyor…</span>'
        : '<a class="att-name" href="/api/attachments/' + a.id + '" target="_blank" rel="noopener" title="Aç / indir">' + name + '</a><span class="att-size">' + fmtSize(a.size) + '</span>' +
          '<button type="button" class="att-del" data-pnatt-del="' + i + '" title="Eki kaldır" aria-label="Eki kaldır">' + ICON.x + '</button>') + '</div>';
  }).join("");
}
function pnAddFiles(files){
  Array.prototype.forEach.call(files, function(f){
    if(f.size > MAX_UPLOAD){ toast('"' + f.name + '" çok büyük (en fazla 25 MB)', true); return; }
    var ph = { uploading: true, name: f.name, size: f.size };
    state.pnAttachments.push(ph); state.uploading++; renderPnAttachments();
    Storage.upload(f).then(function(meta){
      var i = state.pnAttachments.indexOf(ph);
      if(i !== -1) state.pnAttachments[i] = normalizeAttachment(meta);
    }, function(e){
      state.pnAttachments = state.pnAttachments.filter(function(x){ return x !== ph; });
      toast('"' + f.name + '" yüklenemedi: ' + e.message, true);
    }).then(function(){ state.uploading--; renderPnAttachments(); });
  });
}
function saveProjectNote(){
  if(state.uploading > 0){ toast("Ekler yükleniyor, lütfen bitmesini bekleyin", true); return; }
  var html = pnEditor.getHtml(), text = RichEditor.toPlain(html), title = $("pnTitle").value.trim();
  var atts = state.pnAttachments.filter(function(a){ return a && !a.uploading; });
  if(!title && !text.trim() && !atts.length){ toast("Not boş — başlık, metin ya da dosya ekleyin", true); $("pnTitle").focus(); return; }
  if(!title) title = (text.trim().split("\n")[0] || (atts[0] && atts[0].name) || "Adsız not").slice(0, 80);
  var projectId = safeId($("pnProject").value) || state.pnProjectId;
  var now = new Date().toISOString(), n = state.pnEditingId ? findProjectNote(state.pnEditingId) : null, isNew = !n;
  if(isNew){ n = normalizeProjectNote({ id: uid(), createdAt: now }); state.projectNotes.push(n); }
  Object.assign(n, { projectId: projectId, title: title.slice(0, 200), html: html, text: text, attachments: atts, updatedAt: now });
  if(projectId !== state.projectView && state.view === "projects") state.projectView = projectId;   // başka projeye taşındıysa onu göster
  closeProjectNote();
  commit(["projectNotes"], isNew ? "Proje notu eklendi" : "Proje notu güncellendi");
}
function deleteProjectNote(){
  var n = state.pnEditingId ? findProjectNote(state.pnEditingId) : null; if(!n) return;
  showConfirm({ title: "Notu sil", message: '"' + (n.title || "Adsız not") + '" ve ' + (n.attachments.length ? n.attachments.length + " eki " : "") + "kalıcı olarak silinecek.",
    confirmLabel: "Sil", danger: true,
    onConfirm: function(){
      state.projectNotes = state.projectNotes.filter(function(x){ return x.id !== n.id; });
      closeProjectNote();
      commit(["projectNotes"], "Proje notu silindi");
    }
  });
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
  renderSidebar(); renderPipeline(); renderAlerts(); renderBoard(); renderArchive(); renderReminders(); renderMemos(); renderProjects(); renderSaveStatus(); renderSelectBar();
  if(state.view === "settings") renderSettings();
}

/* Görünüm → [sekme butonu, sayfa, görünürken display değeri] */
var VIEWS = {
  board:     ["tabBoard", "boardPage", ""],
  projects:  ["tabProjects", "projectsPage", "flex"],
  reminders: ["tabReminders", "remindersPage", "flex"],
  memos:     ["tabMemos", "memosPage", "flex"],
  archive:   ["tabArchive", "archivePage", "flex"],
  settings:  ["tabSettings", "settingsPage", "flex"]
};
function switchView(v){
  if(!VIEWS[v]) return;
  state.view = v;
  Object.keys(VIEWS).forEach(function(k){
    var on = k === v;
    $(VIEWS[k][0]).classList.toggle("active", on);
    $(VIEWS[k][1]).style.display = on ? VIEWS[k][2] : "none";
  });
  if(v === "settings") renderSettings();
  if(v === "reminders") renderReminders();
  if(v === "memos") renderMemos();
  if(v === "projects") renderProjects();
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
  /* Bu işe bağlı hatırlatmalar ve kişisel notlar (yalnızca kayıtlı işlerde) */
  $("fRemField").style.display = t ? "" : "none";
  if(t){
    var rs = taskReminders(t.id), ms = taskMemos(t.id).sort(function(a, b){ return b.updatedAt.localeCompare(a.updatedAt); });
    $("modalRemList").innerHTML = (rs.length || ms.length) ? rs.map(function(r){
      return '<div class="modal-rem rem-' + remGroup(r) + '">' + ICON.bell + '<span class="modal-rem-text">' + esc(r.text.split("\n")[0]) + '</span><span class="modal-rem-when">' + esc(remWhen(r)) + '</span></div>';
    }).join("") + ms.map(function(m){
      return '<div class="modal-rem memo">' + ICON.note + '<span class="modal-rem-text">' + esc(m.text.split("\n")[0]) + '</span><span class="modal-rem-when">' + esc(memoTime(m.updatedAt)) + '</span></div>';
    }).join("") : '<div class="note-empty">Bu işe bağlı hatırlatma ya da not yok.</div>';
  }
  $("btnDeleteTask").style.display = t ? "inline-flex" : "none";
  $("btnMailTask").style.display = t ? "inline-flex" : "none";
  $("overlay").classList.add("show");
  state.modalBase = modalSnapshot();
  $("fTitle").focus();
}
function closeModal(){ $("overlay").classList.remove("show"); state.editingId = null; state.pendingStatus = null; state.modalBase = null; }
/* Formun o anki hali; açılıştaki halden farklıysa kapatmadan önce sorulur */
function modalSnapshot(){
  return JSON.stringify([
    $("fTitle").value, editor.getHtml(), $("fStart").value, $("fDue").value,
    $("fUnitSeg").dataset.value, $("fPrioSeg").dataset.value, $("fProject").value, $("fStatus").value,
    state.modalNotes.map(function(n){ return n.id; }),
    state.modalAttachments.map(function(a){ return a.id || a.name; }),
    $("fNoteInput").value.trim()
  ]);
}
function modalDirty(){ return !!state.modalBase && modalSnapshot() !== state.modalBase; }
/* Arka plan, Esc, İptal ve X buradan geçer; kaydedilmemiş değişiklik varsa onay ister */
function requestCloseModal(){
  if(!modalDirty()) return closeModal();
  showConfirm({
    title: "Kaydedilmemiş değişiklikler",
    message: "Bu pencerede kaydetmediğiniz değişiklikler var. Kaydetmeden kapatırsanız kaybolacak.",
    confirmLabel: "Kaydetmeden kapat", cancelLabel: "Düzenlemeye dön", danger: true,
    onConfirm: closeModal
  });
}
/* Yalnızca fare hem basılıp hem bırakıldığında arka plandaysa kapatır.
   (Modal içinde metin seçerken fare dışarı taşınca "click" arka plana düşüyordu.) */
function bindBackdropClose(el, onClose){
  var downOnBackdrop = false;
  el.addEventListener("mousedown", function(e){ downOnBackdrop = e.target === el; });
  el.addEventListener("click", function(e){
    var ok = downOnBackdrop && e.target === el;
    downOnBackdrop = false;
    if(ok) onClose();
  });
}

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
  addNote();   // not kutusuna yazılıp "Ekle"ye basılmamış metin kaybolmasın

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
/* Sekmedeki (filtreyle görünen) işlerin hepsi seçiliyse seçimi kaldırır, değilse hepsini seçer */
function toggleTab(status){
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
/* İşler seçilen projeye ya da "Projesiz"e aktarılır. Proje notları bir projeye ait olmak zorunda:
   başka bir proje seçilirse oraya taşınır, "Projesiz" seçilirse (ekleriyle birlikte) silinir. */
function deleteProject(id){
  var p = getProject(id); if(!p) return;
  var n = projectTaskCount(id), nn = notesOfProject(id).length;
  var remove = function(target){
    if(n) allTasks().forEach(function(t){ if(t.projectId === id) t.projectId = target || ""; });
    if(nn){
      if(target) state.projectNotes.forEach(function(x){ if(x.projectId === id) x.projectId = target; });
      else state.projectNotes = state.projectNotes.filter(function(x){ return x.projectId !== id; });
    }
    state.projects = state.projects.filter(function(x){ return x.id !== id; });
    if(state.filterProject === id) state.filterProject = "all";
    if(state.projectView === id) state.projectView = target || null;
    var kinds = (n ? ["tasks", "archive"] : []).concat(nn ? ["projectNotes"] : []).concat(["projects"]);
    commit(kinds, "Proje silindi" + (n ? ", " + n + " iş aktarıldı" : "") + (nn ? ", " + nn + " not " + (target ? "taşındı" : "silindi") : ""));
  };
  if(!n && !nn) return showConfirm({ title: "Projeyi sil", message: '"' + p.name + '" kalıcı olarak silinecek.', confirmLabel: "Sil", danger: true, onConfirm: remove });
  var parts = [];
  if(n) parts.push(n + " iş (aktif + arşiv)");
  if(nn) parts.push(nn + " proje notu");
  showConfirm({
    title: "Projeyi sil",
    message: '"' + p.name + '" projesine bağlı ' + parts.join(" ve ") + ' var. Silmeden önce bunlar seçtiğiniz projeye aktarılacak.' +
      (nn ? ' "Projesiz" seçerseniz işler projesiz kalır, proje notları ise ekleriyle birlikte SİLİNİR.' : ""),
    confirmLabel: "Aktar ve sil", danger: true,
    select: { label: "Aktarılacak proje", value: nn ? ((sortedProjects().filter(function(x){ return x.id !== id; })[0] || {}).id || "") : "",
      options: [{ id: "", name: nn ? "Projesiz (notlar silinir)" : "Projesiz" }].concat(sortedProjects().filter(function(x){ return x.id !== id; })) },
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
  var notes = latestNotes(t, t.notes.length);
  var notesHtml = notes.length
    ? '<div style="margin-top:12px;padding-top:10px;border-top:1px solid #EAEDF2;font-size:12.5px;color:#5B6472;font-weight:600">Durum notları (' + notes.length + ')</div><ul style="margin:4px 0 0;padding-left:18px;font-size:13px">' +
      notes.map(function(n){ return '<li style="margin:3px 0"><span style="color:#8A93A3">' + fmtDate(n.date) + '</span> — ' + esc(n.text).replace(/\r?\n/g, "<br>") + '</li>'; }).join("") + '</ul>' : "";
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
  var notes = latestNotes(t, t.notes.length);
  if(notes.length){ lines.push("", "Durum notları (" + notes.length + "):"); notes.forEach(function(n){ lines.push("- " + fmtDate(n.date) + " — " + n.text.replace(/\r?\n/g, "\n  ")); }); }
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
    tasks: state.tasks, projects: state.projects, archive: state.archive, units: state.units, reminders: state.reminders, memos: state.memos, projectNotes: state.projectNotes }, null, 2);
  download("is-takip-yedek-" + todayISO().replace(/-/g, "") + ".json", new Blob([data], { type: "application/json" }));
  toast("Yedek dosyası indirildi (ek dosyaları dahil değildir)");
}
function importBackup(file){
  var r = new FileReader();
  r.onload = function(){
    var parsed;
    try{ parsed = JSON.parse(r.result); }catch(e){ return showInfo("Dosya okunamadı", "Geçerli bir JSON dosyası seçin."); }
    var tasks, projects = null, archive = null, units = null, reminders = null, memos = null, pnotes = null;
    if(Array.isArray(parsed)) tasks = parsed;                       // en eski biçim: düz iş dizisi
    else if(parsed && Array.isArray(parsed.tasks)){ tasks = parsed.tasks; projects = parsed.projects; archive = parsed.archive; units = parsed.units; reminders = parsed.reminders; memos = parsed.memos; pnotes = parsed.projectNotes; }
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
      if(Array.isArray(reminders)){ state.reminders = reminders.map(normalizeReminder); state.remEditing = null; kinds.push("reminders"); }
      if(Array.isArray(memos)){ state.memos = memos.map(normalizeMemo); state.memoEditing = null; kinds.push("memos"); }
      if(Array.isArray(pnotes)){ state.projectNotes = pnotes.map(normalizeProjectNote); kinds.push("projectNotes"); }
      if(state.projectView && !getProject(state.projectView)) state.projectView = null;
      state.selected = {};
      commit(kinds, tasks.length + " iş içe aktarıldı");
    };
    var willReplace = ["Mevcut " + state.tasks.length + " aktif iş → yedekteki " + tasks.length + " iş"];
    if(Array.isArray(projects)) willReplace.push(state.projects.length + " proje → " + projects.length + " proje");
    if(Array.isArray(archive)) willReplace.push(state.archive.length + " arşiv kaydı → " + archive.length + " arşiv kaydı");
    if(hasUnits) willReplace.push(state.units.length + " sorumlu → " + units.length + " sorumlu");
    if(Array.isArray(reminders)) willReplace.push(state.reminders.length + " hatırlatma → " + reminders.length + " hatırlatma");
    if(Array.isArray(memos)) willReplace.push(state.memos.length + " not → " + memos.length + " not");
    if(Array.isArray(pnotes)) willReplace.push(state.projectNotes.length + " proje notu → " + pnotes.length + " proje notu");
    var hasData = state.tasks.length || (Array.isArray(projects) && state.projects.length) || (Array.isArray(archive) && state.archive.length) || hasUnits ||
      (Array.isArray(reminders) && state.reminders.length) || (Array.isArray(memos) && state.memos.length) || (Array.isArray(pnotes) && state.projectNotes.length);
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
  else if($("pnOverlay").classList.contains("show")) requestCloseProjectNote();
  else if($("overlay").classList.contains("show")) requestCloseModal();
  else if(selectionCount()) clearSelection();
}
function anyOverlayOpen(){
  return ["overlay", "confirmOverlay", "pnOverlay"].some(function(id){ return $(id).classList.contains("show"); });
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
  $("searchInput").oninput = function(e){ state.search = e.target.value; renderPipeline(); renderBoard(); };
  $("archiveSearchInput").oninput = function(e){ state.archiveSearch = e.target.value; renderArchive(); };
  $("tabBoard").onclick = function(){ switchView("board"); };
  $("tabArchive").onclick = function(){ switchView("archive"); };
  $("tabSettings").onclick = function(){ switchView("settings"); };
  $("tabReminders").onclick = function(){ switchView("reminders"); };

  /* Hatırlatmalar */
  $("btnAddReminder").onclick = addReminder;
  $("rText").onkeydown = function(e){ if(e.key === "Enter" && !e.shiftKey){ e.preventDefault(); addReminder(); } };
  $("btnTaskReminder").onclick = addReminderForTask;
  $("btnTaskMemo").onclick = addMemoForTask;

  /* Projeler */
  $("tabProjects").onclick = function(){ state.projectView = null; switchView("projects"); };
  var projOpen = function(e){ var b = e.target.closest("[data-proj-open]"); if(b) openProject(b.getAttribute("data-proj-open")); };
  $("projGrid").onclick = projOpen; $("projArchivedGrid").onclick = projOpen;
  $("btnProjManage").onclick = function(){ switchView("settings"); };
  $("btnProjEmptyManage").onclick = function(){ switchView("settings"); };
  $("btnProjBack").onclick = function(){ state.projectView = null; renderProjects(); };
  $("btnNewPn").onclick = function(){ if(state.projectView) openProjectNote(null, state.projectView); };
  var projToBoard = function(status){
    state.filterProject = state.projectView; state.filterUnit = "all"; state.filterPrio = "all"; state.urgencyFilter = null; state.search = ""; $("searchInput").value = "";
    if(status){ state.statusTab = status; pref(PREF_STATUS_TAB, status); }
    switchView("board"); renderAll();
  };
  $("btnProjBoard").onclick = function(){ projToBoard(null); };
  $("projStatusChips").onclick = function(e){ var b = e.target.closest("[data-proj-status]"); if(b && !b.disabled) projToBoard(b.getAttribute("data-proj-status")); };
  $("projTasks").onclick = function(e){
    var o = e.target.closest("[data-open]"); if(o) return openModal(o.getAttribute("data-open"));
    if(e.target.closest("[data-proj-board]")) projToBoard(null);
  };
  var pnOpen = function(e){ var b = e.target.closest("[data-pn-open]"); if(b) openProjectNote(b.getAttribute("data-pn-open")); };
  $("pnList").onclick = pnOpen; $("projFiles").onclick = pnOpen;
  $("pnSearch").oninput = function(e){ state.pnSearch = e.target.value; renderProjects(); };
  /* Proje notu penceresi */
  pnEditor = RichEditor.create($("pnEditor"), {
    placeholder: "Toplantı notu, karar, yazışma özeti… (resim yapıştırabilirsiniz)",
    onImage: uploadImage,
    onAttach: function(){ $("pnAttInput").click(); },
    onFiles: pnAddFiles
  });
  $("pnAttInput").onchange = function(e){ pnAddFiles(e.target.files); e.target.value = ""; };
  $("pnAttList").onclick = function(e){
    var b = e.target.closest("[data-pnatt-del]"); if(!b) return;
    state.pnAttachments.splice(+b.getAttribute("data-pnatt-del"), 1); renderPnAttachments();
  };
  $("btnPnSave").onclick = saveProjectNote;
  $("btnPnCancel").onclick = requestCloseProjectNote;
  $("pnClose").onclick = requestCloseProjectNote;
  $("btnPnDelete").onclick = deleteProjectNote;
  bindBackdropClose($("pnOverlay"), requestCloseProjectNote);

  /* Notlarım */
  $("tabMemos").onclick = function(){ switchView("memos"); };
  $("btnAddMemo").onclick = addMemo;
  /* Notlar çok satırlı olabilir: Enter yeni satır, Ctrl+Enter ekler */
  $("memoText").onkeydown = function(e){ if(e.key === "Enter" && (e.ctrlKey || e.metaKey)){ e.preventDefault(); addMemo(); } };
  $("memoSearch").oninput = function(e){ state.memoSearch = e.target.value; renderMemos(); };
  $("memoList").onclick = function(e){
    var b = e.target.closest("[data-medit],[data-mdel],[data-msave],[data-mcancel],[data-open-task]");
    if(!b) return;
    if(b.hasAttribute("data-medit")){ state.memoEditing = b.getAttribute("data-medit"); renderMemos(); var ta = document.querySelector("#memoList .memo-e-text"); if(ta){ ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); } }
    else if(b.hasAttribute("data-mdel")) deleteMemo(b.getAttribute("data-mdel"));
    else if(b.hasAttribute("data-msave")) saveMemoEdit(b.getAttribute("data-msave"));
    else if(b.hasAttribute("data-mcancel")){ state.memoEditing = null; renderMemos(); }
    else if(b.hasAttribute("data-open-task")) openModal(b.getAttribute("data-open-task"));
  };
  $("memoList").onkeydown = function(e){
    if(!state.memoEditing) return;
    if(e.key === "Enter" && (e.ctrlKey || e.metaKey)){ e.preventDefault(); saveMemoEdit(state.memoEditing); }
    else if(e.key === "Escape"){ e.stopPropagation(); state.memoEditing = null; renderMemos(); }
  };
  $("btnNotifyPerm").onclick = function(){
    if(!window.Notification) return;
    Notification.requestPermission().then(function(p){
      toast(p === "granted" ? "Masaüstü bildirimleri açıldı" : "Bildirim izni verilmedi; hatırlatmalar yalnızca sayfa içinde gösterilecek", p !== "granted");
      renderReminders();
    });
  };
  $("remList").onclick = function(e){
    var b = e.target.closest("[data-rdone],[data-redit],[data-rdel],[data-rsave],[data-rcancel],[data-rtoggle],[data-open-task],[data-pick]");
    if(!b) return;
    if(b.hasAttribute("data-rdone")) toggleReminderDone(b.getAttribute("data-rdone"));
    else if(b.hasAttribute("data-redit")){ state.remEditing = b.getAttribute("data-redit"); renderReminders(); var ta = document.querySelector("#remList .rem-e-text"); if(ta){ ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); } }
    else if(b.hasAttribute("data-rdel")) deleteReminder(b.getAttribute("data-rdel"));
    else if(b.hasAttribute("data-rsave")) saveReminderEdit(b.getAttribute("data-rsave"));
    else if(b.hasAttribute("data-rcancel")){ state.remEditing = null; renderReminders(); }
    else if(b.hasAttribute("data-rtoggle")){ state.remShowDone = !state.remShowDone; renderReminders(); }
    else if(b.hasAttribute("data-open-task")) openModal(b.getAttribute("data-open-task"));
    else if(b.hasAttribute("data-pick")) openPicker(b.getAttribute("data-pick"));
  };
  /* Düzenleme formunda Ctrl+Enter kaydeder, Esc vazgeçer */
  $("remList").onkeydown = function(e){
    if(!state.remEditing) return;
    if(e.key === "Enter" && (e.ctrlKey || e.metaKey)){ e.preventDefault(); saveReminderEdit(state.remEditing); }
    else if(e.key === "Escape"){ e.stopPropagation(); state.remEditing = null; renderReminders(); }
  };
  bindDateField("rDate");

  /* Kenar çubuğu filtreleri (delegasyon) */
  $("unitList").onclick = function(e){ var b = e.target.closest("[data-unit]"); if(b){ state.filterUnit = b.getAttribute("data-unit"); renderAll(); } };
  $("prioFilterRow").onclick = function(e){ var b = e.target.closest("[data-prio]"); if(b){ state.filterPrio = b.getAttribute("data-prio"); renderAll(); } };
  $("projectList").onclick = function(e){ var b = e.target.closest("[data-project]"); if(b){ state.filterProject = b.getAttribute("data-project"); renderAll(); } };
  /* Durum sekmeleri: tıklayınca sekme değişir; sürüklenen kart bir sekmeye bırakılınca durumu değişir */
  var tabs = $("pipeline");
  tabs.onclick = function(e){ var b = e.target.closest("[data-status]"); if(b) setStatusTab(b.getAttribute("data-status")); };
  var dragTab = null;
  var clearDragTab = function(){ if(dragTab){ dragTab.classList.remove("drag-over"); dragTab = null; } };
  /* Bırakınca pano yeniden çizildiği için "dragend" sayfadan kalkmış karta gelir ve panoya ulaşmaz;
     vurguyu bu yüzden bırakma anında ve belge düzeyinde de temizleriz. */
  var endDrag = function(){ document.body.classList.remove("dragging-card"); clearDragTab(); };
  document.addEventListener("drop", endDrag);
  document.addEventListener("dragend", endDrag, true);
  tabs.ondragover = function(e){
    var b = e.target.closest("[data-status]"); if(!b || !document.body.classList.contains("dragging-card")) return;
    e.preventDefault(); e.dataTransfer.dropEffect = "move";
    if(dragTab !== b){ clearDragTab(); dragTab = b; b.classList.add("drag-over"); }
  };
  tabs.ondragleave = function(e){ if(dragTab && !dragTab.contains(e.relatedTarget)) clearDragTab(); };
  tabs.ondrop = function(e){
    var b = e.target.closest("[data-status]"); endDrag(); if(!b) return;
    e.preventDefault();
    moveTask(e.dataTransfer.getData("text/plain"), b.getAttribute("data-status"));
  };

  /* Uyarılar */
  $("alertsToggle").onclick = function(){
    state.alertsOpen = !state.alertsOpen; pref(PREF_ALERTS_OPEN, state.alertsOpen ? "1" : "0"); renderAlerts();
  };
  $("alertChips").onclick = function(e){
    if(e.target.closest("[data-remgo]")){ switchView("reminders"); return; }
    var b = e.target.closest("[data-urg]"); if(!b) return;
    var g = b.getAttribute("data-urg"); state.urgencyFilter = state.urgencyFilter === g ? null : g;
    if(state.view !== "board") switchView("board");
    /* Filtreyle eşleşen iş bu sekmede yoksa eşleşmesi olan ilk sekmeye geç */
    if(state.urgencyFilter){
      var c = statusCounts(filteredTasks());
      if(!c[state.statusTab]){ var first = STATUSES.filter(function(s){ return c[s.id]; })[0]; if(first){ state.statusTab = first.id; pref(PREF_STATUS_TAB, first.id); } }
    }
    renderAll();
  };
  $("alertPanel").onclick = function(e){
    var o = e.target.closest("[data-open]"), x = e.target.closest("[data-expand]");
    if(e.target.closest("[data-remgo]")) switchView("reminders");
    else if(o) openModal(o.getAttribute("data-open"));
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
    var col = e.target.closest("[data-colcheck]"), go = e.target.closest("[data-goto]");
    if(col){ toggleTab(col.getAttribute("data-colcheck")); return; }
    if(go){ setStatusTab(go.getAttribute("data-goto")); return; }
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
    c.classList.add("dragging"); document.body.classList.add("dragging-card");
    e.dataTransfer.setData("text/plain", c.getAttribute("data-id")); e.dataTransfer.effectAllowed = "move";
  };
  board.ondragend = function(e){
    var c = e.target.closest(".card"); if(c) c.classList.remove("dragging");
    endDrag();
  };

  /* Seçim çubuğu */
  $("btnSelectAll").onclick = function(){ tabTasks(filteredTasks(), state.statusTab).forEach(function(t){ state.selected[t.id] = true; }); renderBoard(); renderSelectBar(); };
  $("btnSelectClear").onclick = clearSelection;
  $("btnMailSelected").onclick = function(){ mailTasks(selectedTasks()); };

  /* Arşiv listesi */
  $("archiveList").onclick = function(e){
    var r = e.target.closest("[data-restore]"), d = e.target.closest("[data-perm-del]");
    if(r) restoreTask(r.getAttribute("data-restore"));
    else if(d) deleteArchived(d.getAttribute("data-perm-del"));
  };

  /* İş modalı */
  $("modalClose").onclick = requestCloseModal;
  $("btnCancel").onclick = requestCloseModal;
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
  bindBackdropClose($("overlay"), requestCloseModal);

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
  bindBackdropClose($("confirmOverlay"), closeConfirm);

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
    if(state.remEditing || state.memoEditing) return;   // hatırlatma/not düzenlenirken veri altından değişmesin
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

  /* Proje asistanı */
  AiModels.onChange(paModelOptions);
  $("paModel").onchange = function(e){ AiModels.select(e.target.value); };
  $("paNew").onclick = function(){ paReset(state.projectView); renderPaSources(); paRenderLog(); $("paInput").focus(); };
  $("paSrcToggle").onclick = function(){ pa.srcOpen = !pa.srcOpen; renderPaSources(); };
  $("paSrcList").onchange = function(e){
    var c = e.target; if(!c || c.type !== "checkbox") return;
    if(c.hasAttribute("data-pa-note")){ var n = c.getAttribute("data-pa-note"); if(c.checked) delete pa.exclNotes[n]; else pa.exclNotes[n] = true; }
    else if(c.hasAttribute("data-pa-file")){ var f = c.getAttribute("data-pa-file"); if(c.checked) delete pa.exclFiles[f]; else pa.exclFiles[f] = true; }
    else if(c.hasAttribute("data-pa-tasks")) pa.tasks = c.checked;
    renderPaSources();
  };
  $("paQuick").onclick = function(e){ var b = e.target.closest("[data-pa-q]"); if(b && !b.disabled) paAsk(PA_QUICK[b.getAttribute("data-pa-q")]); };
  $("paSend").onclick = function(){ var v = $("paInput").value; if(v.trim() && !pa.busy){ $("paInput").value = ""; paAsk(v); } };
  $("paInput").onkeydown = function(e){ if(e.key === "Enter" && !e.shiftKey){ e.preventDefault(); $("paSend").click(); } };
  $("paLog").onclick = function(e){
    var sv = e.target.closest("[data-pa-save]"), cp = e.target.closest("[data-pa-copy]");
    if(e.target.closest("[data-pa-stop]")){ if(pa.ctrl) pa.ctrl.abort(); return; }
    if(sv) paSaveAnswer(+sv.getAttribute("data-pa-save"));
    else if(cp){
      var it = pa.items[+cp.getAttribute("data-pa-copy")];
      if(it && navigator.clipboard) navigator.clipboard.writeText(it.text).then(function(){ toast("Yanıt panoya kopyalandı"); }, function(){ toast("Kopyalanamadı", true); });
    }
  };
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
    /* Sunucu yanıtında yeni türler yoksa sunucu eski koddadır: kayıtlar başarısız olacağı için baştan uyar */
    if(!data.meta || ["reminders", "memos", "projectNotes"].some(function(k){ return typeof data.meta[k] !== "string"; })){
      showInfo("Sunucuyu yeniden başlatın",
        "Uygulama güncellendi ama sunucu hâlâ eski sürümle çalışıyor; hatırlatmalar ve notlar gibi yeni özellikler kaydedilemez. " +
        "Proje klasöründeki servis\\servis-kur.bat dosyasını çalıştırın (elle açtıysanız node server.js penceresinde Ctrl+C'ye basıp yeniden çalıştırın), ardından bu sayfayı yenileyin.");
    }
    checkReminderTimes();
    if(!remTimer) remTimer = setInterval(checkReminderTimes, 30000);
  }).catch(function(e){
    setFatal(true);
    var p = $("fatalOverlay").querySelector("p");
    if(e && e.message && e.message.indexOf("okunamadı") !== -1){
      p.innerHTML = "Sunucu çalışıyor ama veriler okunamadı:<br><b>" + esc(e.message) + "</b><br><br>" +
        "Sunucuyu kapatıp data/backup/ içindeki son .db yedeğini data/is-takip.db adıyla geri koyun ve tekrar deneyin. Uygulama, bozuk veriyi ezmemek için kilitli tutuluyor.";
    }
  });
}

bind();
$("fatalRetry").onclick = boot;
boot();

})();
