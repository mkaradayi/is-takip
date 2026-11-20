/* Uyarı şeridi ve ayrıntı paneli (gecikmiş / bugün / yaklaşan + hatırlatmalar) */
import { ALERT_GROUPS, ALERT_ROWS, ICON, PREF_ALERTS_OPEN, PREF_STATUS_TAB, PRIO_MAP, STATUSES } from "../core/config.js";
import { filteredTasks, urgencyGroup } from "../core/domain.js";
import { renderAll, switchView } from "../core/render.js";
import { getProject, getUnit, state } from "../core/state.js";
import { $, daysBetween, esc, pref, todayISO } from "../core/utils.js";
import { openModal } from "../modals/task-modal.js";
import { statusCounts } from "./board.js";
import { dueReminders, remGroup } from "./reminders.js";

/* Uyarılar: kapalıyken tek satırlık özet şeridi, açıkken grup sütunlu ve yüksekliği sınırlı panel */
export function renderAlerts(){
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
        '<span class="dot" style="background:' + getUnit(t.units[0]).color + ';"></span>' +
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

/* Olay bağlama (main.js → bind) */
export function bindAlerts(){
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
}
