/* Hatırlatmalar sayfası: gruplar, ekleme, satır içi düzenleme */
import { ICON, STATUSES } from "../core/config.js";
import { switchView } from "../core/render.js";
import { TIME_RE, findArchived, findReminder, findTask, normalizeReminder, safeId, state } from "../core/state.js";
import { commit } from "../core/storage.js";
import { bindDateField, openPicker, showConfirm, toast } from "../core/ui.js";
import { $, daysBetween, esc, fmtDate, isoToTR, todayISO, trToISO, uid } from "../core/utils.js";
import { closeModal, modalDirty, openModal, saveTask } from "../modals/task-modal.js";
import { addMemoForTask } from "./memos.js";

export var REM_GROUPS = [
  { id: "over",  name: "Gecikmiş" },
  { id: "today", name: "Bugün" },
  { id: "soon",  name: "Yaklaşan (7 gün)" },
  { id: "later", name: "Daha sonra" }
];
export function remGroup(r){
  if(r.done) return "done";
  var d = daysBetween(todayISO(), r.date);
  return d < 0 ? "over" : d === 0 ? "today" : d <= 7 ? "soon" : "later";
}
/* Tarih, sonra saat (saatsizler günün başında), sonra eklenme sırası */
export function remSort(a, b){ return a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.createdAt.localeCompare(b.createdAt); }
/* Bugün ve gecikmiş, tamamlanmamış hatırlatmalar (uyarı rozeti + kenar çubuğu sayısı) */
export function dueReminders(){ return state.reminders.filter(function(r){ var g = remGroup(r); return g === "over" || g === "today"; }).sort(remSort); }
export function taskReminders(id){ return state.reminders.filter(function(r){ return !r.done && r.taskId === id; }).sort(remSort); }
export function remWhen(r){
  var d = daysBetween(todayISO(), r.date), t = r.time ? " " + r.time : "";
  if(r.done) return fmtDate(r.date) + t;
  if(d === 0) return "Bugün" + t;
  if(d === 1) return "Yarın" + t;
  if(d < 0) return fmtDate(r.date) + t + " · " + (-d) + " gün gecikti";
  return fmtDate(r.date) + t + (d <= 7 ? " · " + d + " gün sonra" : "");
}
/* Hatırlatma ve notlardaki bağlı iş çipi: aktif işse tıklanınca iş açılır */
export function taskChip(taskId){
  if(!taskId) return "";
  var t = findTask(taskId);
  if(t) return '<button type="button" class="rem-task" data-open-task="' + t.id + '" title="İşi aç">' + ICON.link + '<span>' + esc(t.title) + '</span></button>';
  var a = findArchived(taskId);
  if(a) return '<span class="rem-task off" title="Bağlı iş arşivde">' + ICON.link + '<span>' + esc(a.title) + ' (arşivde)</span></span>';
  return '<span class="rem-task off">' + ICON.link + '<span>(silinmiş iş)</span></span>';
}
export function remTaskChip(r){ return taskChip(r.taskId); }
/* "İşe bağla" seçenekleri: aktif işler duruma göre gruplu; seçili iş artık panoda değilse yine de korunur */
export function taskOptions(selected){
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
export function dateFieldHtml(id, value){
  return '<div class="date-field"><input type="text" id="' + id + '" value="' + esc(value) + '" placeholder="gg.aa.yyyy" inputmode="numeric" maxlength="10" autocomplete="off" />' +
    '<button type="button" class="date-pick" data-pick="' + id + '" title="Takvimden seç" aria-label="Takvimden seç">' + ICON.calendar + '</button>' +
    '<input type="date" class="date-native" id="' + id + 'Picker" tabindex="-1" aria-hidden="true" /></div>';
}
export function remRowHtml(r){
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
export function remEditHtml(r){
  return '<div class="rem-row editing" data-rid="' + r.id + '"><div class="rem-form">' +
    '<textarea class="rem-e-text" maxlength="2000" rows="2">' + esc(r.text) + '</textarea>' +
    '<div class="rem-form-row">' + dateFieldHtml("remEditDate", isoToTR(r.date)) +
      '<input type="time" class="rem-e-time" value="' + r.time + '" title="Saat (isteğe bağlı)" />' +
      '<select class="rem-e-task">' + taskOptions(r.taskId) + '</select>' +
      '<span class="spacer"></span>' +
      '<button type="button" class="btn btn-sm" data-rcancel="1">Vazgeç</button>' +
      '<button type="button" class="btn btn-sm btn-primary" data-rsave="' + r.id + '">Kaydet</button></div></div></div>';
}
export function renderReminders(){
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
export function readRemForm(text, dateTxt, time, taskId){
  text = text.trim();
  if(!text){ toast("Hatırlatma metnini yazın", true); return null; }
  var date = dateTxt.trim() ? trToISO(dateTxt) : todayISO();   // tarih boşsa bugün
  if(!date){ toast("Tarih geçersiz — gg.aa.yyyy biçiminde girin", true); return null; }
  return { text: text, date: date, time: TIME_RE.test(time) ? time : "", taskId: safeId(taskId) };
}
export function addReminder(){
  var f = readRemForm($("rText").value, $("rDate").value, $("rTime").value, $("rTask").value);
  if(!f){ $("rText").focus(); return; }
  state.reminders.push(normalizeReminder(Object.assign({ id: uid(), createdAt: new Date().toISOString() }, f)));
  $("rText").value = ""; $("rDate").value = ""; $("rTime").value = ""; $("rTask").value = ""; $("rDate").classList.remove("invalid");
  commit(["reminders"], "Hatırlatma eklendi (" + remWhen(state.reminders[state.reminders.length - 1]) + ")");
  $("rText").focus();
}
export function saveReminderEdit(id){
  var r = findReminder(id), ed = document.querySelector('#remList .rem-row.editing[data-rid="' + id + '"]');
  if(!r || !ed) return;
  var f = readRemForm(ed.querySelector(".rem-e-text").value, $("remEditDate").value, ed.querySelector(".rem-e-time").value, ed.querySelector(".rem-e-task").value);
  if(!f) return;
  Object.assign(r, f);
  state.remEditing = null;
  commit(["reminders"], "Hatırlatma güncellendi");
}
export function toggleReminderDone(id){
  var r = findReminder(id); if(!r) return;
  r.done = !r.done; r.doneAt = r.done ? new Date().toISOString() : "";
  commit(["reminders"], r.done ? "Hatırlatma tamamlandı" : "Hatırlatma yeniden açıldı");
}
export function deleteReminder(id){
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
export function addReminderForTask(){
  var id = state.editingId; if(!id) return;
  if(modalDirty()){ if(!saveTask()) return; } else closeModal();
  state.remPresetTask = id;
  switchView("reminders");
  $("rText").focus();
}

/* ---------- Notlarım (tarihsiz kişisel notlar) ---------- */

/* Olay bağlama (main.js → bind) */
export function bindReminders(){
  /* Hatırlatmalar */
  $("btnAddReminder").onclick = addReminder;
  $("rText").onkeydown = function(e){ if(e.key === "Enter" && !e.shiftKey){ e.preventDefault(); addReminder(); } };
  $("btnTaskReminder").onclick = addReminderForTask;
  $("btnTaskMemo").onclick = addMemoForTask;

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
}
