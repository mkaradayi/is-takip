/* Takvim: aylık ve haftalık görünüm.
   İşler başlangıç–bitiş aralığında çubuk olarak çizilir (hafta satırlarına bölünür, şeritlere yerleştirilir);
   yalnızca tek tarihi olan iş o güne tek günlük çubuk olur, tarihsiz işler gösterilmez (üst çubukta sayılır).
   Kenar çubuğu filtreleri, arama ve uyarı filtresi geçerlidir (filteredTasks). Hatırlatmalar: filtre varken yalnızca
   filtreyle eşleşen işlere bağlı olanlar; aramada metni ya da bağlı işi eşleşenler. */
import { ICON, PREF_CAL_MODE, PRIO_MAP, STATUS_MAP } from "../core/config.js";
import { filteredTasks, searchKey, urgency } from "../core/domain.js";
import { switchView } from "../core/render.js";
import { assigneeText, findTask, getUnit, state } from "../core/state.js";
import { $, addDays, daysBetween, esc, fmtDate, isoOf, parseISO, pref, todayISO } from "../core/utils.js";
import { openModal } from "../modals/task-modal.js";
import { remSort } from "./reminders.js";

var MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
var DAYS = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];
var MAX_LANES = 3;      // aylık görünümde gün başına gösterilen çubuk şeridi; fazlası "+N iş"
var MAX_REMS = 2;       // aylık görünümde gün başına gösterilen hatırlatma; fazlası "+N"
var cal = { mode: pref(PREF_CAL_MODE) === "week" ? "week" : "month", anchor: todayISO(), showDone: false };

function weekStart(iso){ return addDays(iso, -((parseISO(iso).getDay() + 6) % 7)); }   // Pazartesi
function monthStart(iso, delta){ var d = parseISO(iso); return isoOf(new Date(d.getFullYear(), d.getMonth() + (delta || 0), 1)); }
/* İşin takvimdeki aralığı: yalnızca biri varsa tek gün; hiç tarih yoksa null */
function span(t){
  var s = t.startDate || t.dueDate, e = t.dueDate || t.startDate;
  if(!s) return null;
  return e < s ? { s: e, e: s } : { s: s, e: e };
}
function isClosed(t){ return t.status === "tamamlandi" || t.status === "iptal"; }
function visibleTasks(){ return filteredTasks().filter(function(t){ return cal.showDone || !isClosed(t); }); }
function narrowed(){ return state.filterUnit !== "all" || state.filterMember !== "all" || state.filterPrio !== "all" || state.filterProject !== "all" || !!state.urgencyFilter; }
function visibleReminders(tasks){
  var ids = {}; tasks.forEach(function(t){ ids[t.id] = true; });
  var q = searchKey(state.search.trim()), nar = narrowed();
  return state.reminders.filter(function(r){
    if(r.done && !cal.showDone) return false;
    if(nar && !(r.taskId && ids[r.taskId])) return false;
    if(q && searchKey(r.text).indexOf(q) === -1 && !(r.taskId && ids[r.taskId])) return false;
    return true;
  }).sort(remSort);
}
function byDay(list, key){ var m = {}; list.forEach(function(x){ (m[x[key]] = m[x[key]] || []).push(x); }); return m; }

/* Bir haftadaki çubuklar: başlangıca göre, uzun olan önce; her biri çakışmayan ilk şeride yerleşir */
function layoutWeek(ws, tasks){
  var we = addDays(ws, 6), segs = [];
  tasks.forEach(function(t){
    var sp = span(t);
    if(!sp || sp.e < ws || sp.s > we) return;
    var s = sp.s < ws ? ws : sp.s, e = sp.e > we ? we : sp.e;
    segs.push({ t: t, c0: daysBetween(ws, s), c1: daysBetween(ws, e), contL: sp.s < ws, contR: sp.e > we, sp: sp });
  });
  segs.sort(function(a, b){
    return a.c0 - b.c0 || (b.c1 - b.c0) - (a.c1 - a.c0) || PRIO_MAP[a.t.priority].order - PRIO_MAP[b.t.priority].order || a.t.title.localeCompare(b.t.title, "tr");
  });
  var lanes = [];
  segs.forEach(function(sg){
    var l = 0;
    while(lanes[l] != null && lanes[l] >= sg.c0) l++;
    lanes[l] = sg.c1; sg.lane = l;
  });
  return { segs: segs, laneCount: lanes.length };
}
function barHtml(sg, row){
  var t = sg.t, u = getUnit(t.units[0]), urg = urgency(t);
  var tip = t.title + " — " + (sg.sp.s === sg.sp.e ? fmtDate(sg.sp.s) : fmtDate(sg.sp.s) + " – " + fmtDate(sg.sp.e)) +
    " · " + STATUS_MAP[t.status].name + " · " + PRIO_MAP[t.priority].name + " · " + assigneeText(t);
  return '<button type="button" class="cal-bar' + (urg === "over" ? " over" : "") + (isClosed(t) ? " closed" : "") +
    (sg.contL ? " cont-l" : "") + (sg.contR ? " cont-r" : "") + '" data-open="' + t.id + '" title="' + esc(tip) + '"' +
    ' style="grid-column:' + (sg.c0 + 1) + ' / ' + (sg.c1 + 2) + '; grid-row:' + row + '; --c:' + u.color + ';">' +
    '<span class="cal-bar-prio" style="background:' + PRIO_MAP[t.priority].color + ';"></span><span class="cal-bar-text">' + esc(t.title) + '</span></button>';
}
function remHtml(r){
  var over = !r.done && r.date < todayISO();
  return '<button type="button" class="cal-rem' + (r.done ? " done" : "") + (over ? " over" : "") + '" data-rem="' + r.id + '" title="' + esc(r.text) + '">' +
    ICON.bell + (r.time ? '<b>' + r.time + '</b>' : "") + '<span>' + esc(r.text.split("\n")[0]) + '</span></button>';
}
/* Hafta satırının ortak kısmı: gün zeminleri (çift tıklanabilir), başlık satırı, çubuklar */
function weekBase(ws, L, maxLanes, head){
  var today = todayISO(), h = "";
  for(var c = 0; c < 7; c++){
    var day = addDays(ws, c);
    h += '<div class="cal-cell' + (day === today ? " today" : "") + (c > 4 ? " weekend" : "") + (c === 6 ? " last" : "") + (cal.mode === "month" && parseISO(day).getMonth() !== parseISO(cal.anchor).getMonth() ? " out" : "") +
      '" data-day="' + day + '" style="grid-column:' + (c + 1) + '; grid-row:1 / -1;" title="Yeni iş için çift tıklayın"></div>';
    h += '<div class="cal-dnum' + (day === today ? " today" : "") + '" style="grid-column:' + (c + 1) + '; grid-row:1;">' + head(day) + '</div>';
  }
  L.segs.forEach(function(sg){ if(sg.lane < maxLanes) h += barHtml(sg, sg.lane + 2); });
  return h;
}

function renderMonth(tasks, rems){
  var first = monthStart(cal.anchor), month = parseISO(first).getMonth(), ws = weekStart(first);
  var remsBy = byDay(rems, "date"), html = '<div class="cal-month"><div class="cal-head">' + DAYS.map(function(d){ return "<div>" + d + "</div>"; }).join("") + '</div>';
  for(var w = 0; w < 6; w++){
    var start = addDays(ws, w * 7);
    if(w > 0 && parseISO(start).getMonth() !== month) break;
    var L = layoutWeek(start, tasks), shown = Math.min(L.laneCount, MAX_LANES), hidden = [0, 0, 0, 0, 0, 0, 0];
    L.segs.forEach(function(sg){ if(sg.lane >= MAX_LANES) for(var c = sg.c0; c <= sg.c1; c++) hidden[c]++; });
    html += '<div class="cal-week" style="grid-template-rows:28px' + (shown ? " repeat(" + shown + ", 24px)" : "") + ' minmax(30px, auto);">' +
      weekBase(start, L, MAX_LANES, function(day){ var d = parseISO(day); return d.getDate() === 1 ? "1 " + MONTHS[d.getMonth()].slice(0, 3) : String(d.getDate()); });
    for(var c = 0; c < 7; c++){
      var day = addDays(start, c), rs = remsBy[day] || [];
      var extra = (hidden[c] ? '<button type="button" class="cal-more" data-week-day="' + day + '">+' + hidden[c] + ' iş</button>' : "") +
        rs.slice(0, MAX_REMS).map(remHtml).join("") +
        (rs.length > MAX_REMS ? '<button type="button" class="cal-more" data-week-day="' + day + '">+' + (rs.length - MAX_REMS) + ' hatırlatma</button>' : "");
      if(extra) html += '<div class="cal-extra" style="grid-column:' + (c + 1) + '; grid-row:' + (shown + 2) + ';">' + extra + '</div>';
    }
    html += '</div>';
  }
  return html + '</div>';
}

function renderWeek(tasks, rems){
  var ws = weekStart(cal.anchor), L = layoutWeek(ws, tasks), remsBy = byDay(rems, "date"), today = todayISO();
  var html = '<div class="cal-weekview"><div class="cal-week cal-week-full" style="grid-template-rows:46px' + (L.laneCount ? " repeat(" + L.laneCount + ", 26px)" : "") + ' 10px;">' +
    weekBase(ws, L, Infinity, function(day){ var d = parseISO(day); return '<span class="cal-wd">' + DAYS[(d.getDay() + 6) % 7] + '</span><span class="cal-wdate">' + d.getDate() + " " + MONTHS[d.getMonth()].slice(0, 3) + '</span>'; }) +
    '</div><div class="cal-days7">';
  for(var c = 0; c < 7; c++){
    var day = addDays(ws, c), rs = remsBy[day] || [];
    var due = tasks.filter(function(t){ return t.dueDate === day; });
    html += '<div class="cal-daycol' + (day === today ? " today" : "") + '" data-day="' + day + '">' +
      '<div class="cal-daycol-head">' + DAYS[c] + " " + fmtDate(day).slice(0, 5) + '</div>' +
      (due.length ? '<div class="cal-sec">Termin</div>' + due.map(function(t){
        return '<button type="button" class="cal-due' + (urgency(t) === "over" ? " over" : "") + (isClosed(t) ? " closed" : "") + '" data-open="' + t.id + '" style="--c:' + getUnit(t.units[0]).color + ';">' +
          '<span class="dot"></span><span>' + esc(t.title) + '</span></button>';
      }).join("") : "") +
      (rs.length ? '<div class="cal-sec">Hatırlatmalar</div>' + rs.map(remHtml).join("") : "") +
      (!due.length && !rs.length ? '<div class="cal-none">—</div>' : "") + '</div>';
  }
  return html + '</div></div>';
}

function titleText(){
  var a = parseISO(cal.anchor);
  if(cal.mode === "month") return MONTHS[a.getMonth()] + " " + a.getFullYear();
  var s = parseISO(weekStart(cal.anchor)), e = parseISO(addDays(weekStart(cal.anchor), 6));
  if(s.getMonth() === e.getMonth()) return s.getDate() + " – " + e.getDate() + " " + MONTHS[e.getMonth()] + " " + e.getFullYear();
  return s.getDate() + " " + MONTHS[s.getMonth()] + (s.getFullYear() !== e.getFullYear() ? " " + s.getFullYear() : "") + " – " + e.getDate() + " " + MONTHS[e.getMonth()] + " " + e.getFullYear();
}

export function renderCalendar(){
  if(!$("calWrap")) return;
  var tasks = visibleTasks(), rems = visibleReminders(tasks);
  $("calTitle").textContent = titleText();
  Array.prototype.forEach.call($("calMode").children, function(b){ b.classList.toggle("active", b.getAttribute("data-mode") === cal.mode); });
  $("calShowDone").checked = cal.showDone;
  var undated = tasks.filter(function(t){ return !span(t); }).length;
  var info = [];
  if(undated) info.push('<span title="Başlangıç ve bitiş tarihi olmayan işler takvimde gösterilmez">' + undated + ' tarihsiz iş</span>');
  if(narrowed() || state.search.trim()) info.push('<span class="cal-filtered" title="Kenar çubuğu filtreleri ve arama takvime de uygulanıyor">Filtre uygulanıyor</span>');
  $("calInfo").innerHTML = info.join("");
  $("calWrap").innerHTML = cal.mode === "month" ? renderMonth(tasks, rems) : renderWeek(tasks, rems);
}

export function bindCalendar(){
  var go = function(delta){
    cal.anchor = cal.mode === "month" ? monthStart(cal.anchor, delta) : addDays(cal.anchor, 7 * delta);
    renderCalendar();
  };
  $("calPrev").onclick = function(){ go(-1); };
  $("calNext").onclick = function(){ go(1); };
  $("calToday").onclick = function(){ cal.anchor = todayISO(); renderCalendar(); };
  $("calMode").onclick = function(e){
    var b = e.target.closest("[data-mode]"); if(!b) return;
    cal.mode = b.getAttribute("data-mode"); pref(PREF_CAL_MODE, cal.mode); renderCalendar();
  };
  $("calShowDone").onchange = function(e){ cal.showDone = e.target.checked; renderCalendar(); };
  var wrap = $("calWrap");
  wrap.onclick = function(e){
    var op = e.target.closest("[data-open]"), rm = e.target.closest("[data-rem]"), wd = e.target.closest("[data-week-day]");
    if(op){ if(findTask(op.getAttribute("data-open"))) openModal(op.getAttribute("data-open")); }
    else if(rm) switchView("reminders");
    else if(wd){ cal.mode = "week"; cal.anchor = wd.getAttribute("data-week-day"); pref(PREF_CAL_MODE, cal.mode); renderCalendar(); }
  };
  /* Boş güne (gün zemini ya da haftalık gün sütunu) çift tıklama: o tarihli yeni iş */
  wrap.ondblclick = function(e){
    if(e.target.closest("[data-open],[data-rem],[data-week-day]")) return;
    var cell = e.target.closest("[data-day]"); if(!cell) return;
    var day = cell.getAttribute("data-day");
    openModal(null, { startDate: day, dueDate: day });
  };
}
