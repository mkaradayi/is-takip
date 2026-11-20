/* İş kuralları: termin/aciliyet, tarih zorunluluğu, arama, filtreleme, seçim */
import { DUE_SOON_DAYS } from "./config.js";
import { state } from "./state.js";
import { daysBetween, todayISO } from "./utils.js";

export function urgency(t){
  if(t.status === "tamamlandi") return "done";
  if(t.status === "iptal") return "cancelled";
  if(!t.dueDate) return "normal";
  var d = daysBetween(todayISO(), t.dueDate);
  if(d < 0) return "over";
  if(d <= DUE_SOON_DAYS) return "soon";
  return "normal";
}
/* Uyarı paneli grupları: over | today | soon | null */
export function urgencyGroup(t){
  var u = urgency(t);
  if(u === "over") return "over";
  if(u === "soon") return daysBetween(todayISO(), t.dueDate) === 0 ? "today" : "soon";
  return null;
}
export function dueText(t){
  var d = daysBetween(todayISO(), t.dueDate);
  return d < 0 ? Math.abs(d) + " gün gecikti" : d === 0 ? "bugün son gün" : d + " gün kaldı";
}
export function hasDates(t){ return !!(t.startDate && t.dueDate); }
/* Başlangıç + bitiş tarihi zorunlu olan durumlar: Backlog'da henüz plan yok, İptal'de ise artık gerekmiyor */
export function needsDates(status){ return status !== "backlog" && status !== "iptal"; }
export function allTasks(){ return state.tasks.concat(state.archive); }
export function projectTaskCount(id){ return allTasks().filter(function(t){ return t.projectId === id; }).length; }
export function unitTaskCount(id){ return allTasks().filter(function(t){ return t.units.indexOf(id) !== -1; }).length; }
export function memberTaskCount(id){ return allTasks().filter(function(t){ return t.members.indexOf(id) !== -1; }).length; }
/* Arama için Türkçe küçük harfe çevirir; "ı" de "i" sayılır (ISTANBUL / İstanbul / istanbul eşleşsin) */
export function searchKey(s){ return String(s || "").toLocaleLowerCase("tr").replace(/ı/g, "i"); }
/* Eşleşme yoksa "", varsa nerede bulunduğu: "title" | "desc" | "note" */
export function taskMatch(t, q){
  if(!q) return "title";
  if(searchKey(t.title).indexOf(q) !== -1) return "title";
  if(searchKey(t.description).indexOf(q) !== -1) return "desc";
  if(t.notes.some(function(n){ return searchKey(n.text).indexOf(q) !== -1; })) return "note";
  return "";
}
export function filteredTasks(){
  var q = searchKey(state.search.trim());
  return state.tasks.filter(function(t){
    if(state.filterUnit !== "all" && t.units.indexOf(state.filterUnit) === -1) return false;
    if(state.filterMember !== "all" && t.members.indexOf(state.filterMember) === -1) return false;
    if(state.filterPrio !== "all" && t.priority !== state.filterPrio) return false;
    if(state.filterProject === "none" && t.projectId) return false;
    if(state.filterProject !== "all" && state.filterProject !== "none" && t.projectId !== state.filterProject) return false;
    if(state.urgencyFilter && urgencyGroup(t) !== state.urgencyFilter) return false;
    if(q && !taskMatch(t, q)) return false;
    return true;
  });
}
export function latestNotes(t, n){
  return t.notes.slice().sort(function(a, b){ return (b.createdAt || b.date || "").localeCompare(a.createdAt || a.date || ""); }).slice(0, n);
}
export function selectedTasks(){ return state.tasks.filter(function(t){ return state.selected[t.id]; }); }
export function selectionCount(){ return selectedTasks().length; }

