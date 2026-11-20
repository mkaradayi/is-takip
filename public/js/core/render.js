/* Tüm görünümlerin yeniden çizimi (renderAll) ve sayfa geçişi (switchView) */
import { state } from "./state.js";
import { $ } from "./utils.js";
import { renderAlerts } from "../views/alerts.js";
import { renderArchive } from "../views/archive.js";
import { renderBoard, renderPipeline, renderSelectBar } from "../views/board.js";
import { renderMemos } from "../views/memos.js";
import { renderProjects } from "../views/projects.js";
import { renderReminders } from "../views/reminders.js";
import { renderSettings } from "../views/settings.js";
import { renderSaveStatus, renderSidebar } from "../views/sidebar.js";
import { renderCalendar } from "../views/calendar.js";

export function renderAll(){
  renderSidebar(); renderPipeline(); renderAlerts(); renderBoard(); renderArchive(); renderReminders(); renderMemos(); renderProjects(); renderSaveStatus(); renderSelectBar();
  if(state.view === "calendar") renderCalendar();
  if(state.view === "settings") renderSettings();
}

/* Görünüm → [sekme butonu, sayfa, görünürken display değeri] */
export var VIEWS = {
  board:     ["tabBoard", "boardPage", ""],
  calendar:  ["tabCalendar", "calendarPage", "flex"],
  projects:  ["tabProjects", "projectsPage", "flex"],
  reminders: ["tabReminders", "remindersPage", "flex"],
  memos:     ["tabMemos", "memosPage", "flex"],
  archive:   ["tabArchive", "archivePage", "flex"],
  settings:  ["tabSettings", "settingsPage", "flex"]
};
export function switchView(v){
  if(!VIEWS[v]) return;
  state.view = v;
  Object.keys(VIEWS).forEach(function(k){
    var on = k === v;
    $(VIEWS[k][0]).classList.toggle("active", on);
    $(VIEWS[k][1]).style.display = on ? VIEWS[k][2] : "none";
  });
  if(v === "settings") renderSettings();
  if(v === "calendar") renderCalendar();
  if(v === "reminders") renderReminders();
  if(v === "memos") renderMemos();
  if(v === "projects") renderProjects();
  renderSelectBar();
}

