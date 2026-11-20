/* Uygulama durumu (state) ve sunucudan gelen her değerin normalize* doğrulaması */
import { RichEditor } from "../components/editor.js";
import { DEFAULT_UNITS, PREF_ALERTS_OPEN, PREF_STATUS_TAB, PRIO_MAP, PROJECT_COLORS, STATUS_MAP } from "./config.js";
import { Storage } from "./storage.js";
import { $, pref, todayISO, uid } from "./utils.js";

export var UNIT_MAP = {};

export var state = {
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
export var SAFE_ID = /^[\w-]{1,64}$/, HEX_COLOR = /^#[0-9a-f]{6}$/i, ISO_DAY = /^\d{4}-\d{2}-\d{2}/;
export function safeId(v){ return typeof v === "string" && SAFE_ID.test(v) ? v : ""; }
export function str(v){ return v == null ? "" : String(v); }
export function isoDay(v){ return typeof v === "string" && ISO_DAY.test(v) ? v.slice(0, 10) : ""; }

export function setUnits(list){
  state.units = list.slice().sort(function(a, b){ return a.order - b.order; });
  state.units.forEach(function(u, i){ u.order = i; });
  UNIT_MAP = {}; state.units.forEach(function(u){ UNIT_MAP[u.id] = u; });
}
export function getUnit(id){ return UNIT_MAP[id] || { id: id, name: "(silinmiş sorumlu)", color: "#9AA1AD", missing: true }; }
export function defaultUnitId(){ return state.units.length ? state.units[0].id : "diger"; }
export function normalizeUnit(u, i){
  u = u || {};
  return { id: safeId(u.id) || uid(), name: str(u.name).trim() || "Adsız sorumlu",
    color: HEX_COLOR.test(u.color) ? u.color : "#6B7280", order: typeof u.order === "number" ? u.order : i };
}

export function normalizeNote(n){
  n = n && typeof n === "object" ? n : { text: n };
  var created = typeof n.createdAt === "string" ? n.createdAt : "";
  return Object.assign({}, n, { id: safeId(n.id) || uid(), text: str(n.text), date: isoDay(n.date) || isoDay(created), createdAt: created });
}
export function normalizeAttachment(a){
  if(!a || typeof a !== "object" || !safeId(a.id)) return null;
  return { id: a.id, name: str(a.name).slice(0, 200) || "dosya", size: +a.size || 0, type: str(a.type).slice(0, 100), uploadedAt: str(a.uploadedAt) };
}
export function normalizeTask(t){
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
export function normalizeProject(p){
  p = p || {};
  return Object.assign({ id: uid(), name: "Adsız proje", color: PROJECT_COLORS[0], status: "aktif" }, p, {
    id: safeId(p.id) || uid(),
    name: str(p.name) || "Adsız proje",
    color: HEX_COLOR.test(p.color) ? p.color : PROJECT_COLORS[0],
    status: p.status === "arsivlenmis" ? "arsivlenmis" : "aktif"
  });
}
/* Hatırlatma / kişisel not: tarih zorunlu, saat ve iş bağlantısı isteğe bağlı */
export var TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export function normalizeReminder(r){
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
export function normalizeMemo(m){
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
export function normalizeProjectNote(n){
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
export function unitsFrom(list){
  var seen = {}, out = (Array.isArray(list) ? list : []).map(normalizeUnit).filter(function(u){
    if(seen[u.id]) return false; seen[u.id] = true; return true;
  });
  return out.length ? out : DEFAULT_UNITS.map(function(u){ return Object.assign({}, u); });
}
export function applyServerState(data){
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
export function getProject(id){
  if(!id) return null;
  for(var i = 0; i < state.projects.length; i++) if(state.projects[i].id === id) return state.projects[i];
  return null;
}
export function findTask(id){ return state.tasks.filter(function(t){ return t.id === id; })[0] || null; }
export function findArchived(id){ return state.archive.filter(function(t){ return t.id === id; })[0] || null; }
export function findReminder(id){ return state.reminders.filter(function(r){ return r.id === id; })[0] || null; }
export function findMemo(id){ return state.memos.filter(function(m){ return m.id === id; })[0] || null; }
export function findProjectNote(id){ return state.projectNotes.filter(function(n){ return n.id === id; })[0] || null; }
export function notesOfProject(id){ return state.projectNotes.filter(function(n){ return n.projectId === id; }); }

