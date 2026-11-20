/* Notlarım sayfası (tarihsiz kişisel notlar) */
import { ICON } from "../core/config.js";
import { searchKey } from "../core/domain.js";
import { switchView } from "../core/render.js";
import { findArchived, findMemo, findTask, normalizeMemo, safeId, state } from "../core/state.js";
import { commit } from "../core/storage.js";
import { showConfirm, toast } from "../core/ui.js";
import { $, esc, isoOf, pad, relLabel, uid } from "../core/utils.js";
import { closeModal, modalDirty, openModal, saveTask } from "../modals/task-modal.js";
import { taskChip, taskOptions } from "./reminders.js";

export function memoTime(isoStr){
  var d = new Date(isoStr); if(isNaN(d)) return "";
  var day = isoOf(d), hm = pad(d.getHours()) + ":" + pad(d.getMinutes());
  return relLabel(day) + " " + hm;
}
export function taskMemos(id){ return state.memos.filter(function(m){ return m.taskId === id; }); }
export function memoRowHtml(m){
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
export function renderMemos(){
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
export function addMemo(){
  var text = $("memoText").value.trim();
  if(!text){ toast("Not metnini yazın", true); $("memoText").focus(); return; }
  var now = new Date().toISOString();
  state.memos.push(normalizeMemo({ id: uid(), text: text, taskId: $("memoTask").value, createdAt: now, updatedAt: now }));
  $("memoText").value = ""; $("memoTask").value = "";
  commit(["memos"], "Not eklendi");
  $("memoText").focus();
}
export function saveMemoEdit(id){
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
export function deleteMemo(id){
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
export function addMemoForTask(){
  var id = state.editingId; if(!id) return;
  if(modalDirty()){ if(!saveTask()) return; } else closeModal();
  state.memoPresetTask = id;
  switchView("memos");
  $("memoText").focus();
}

/* Olay bağlama (main.js → bind) */
export function bindMemos(){
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
}
