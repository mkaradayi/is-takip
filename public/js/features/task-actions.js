/* İş eylemleri: sil, arşivle, geri al, taşı, seç */
import { STATUS_MAP } from "../core/config.js";
import { filteredTasks, hasDates, needsDates } from "../core/domain.js";
import { findArchived, findTask, state } from "../core/state.js";
import { commit } from "../core/storage.js";
import { showConfirm, toast } from "../core/ui.js";
import { todayISO } from "../core/utils.js";
import { closeModal, openModal } from "../modals/task-modal.js";
import { renderBoard, renderSelectBar } from "../views/board.js";

export function deleteTask(id){
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
export function archiveTask(id){
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
export function restoreTask(id){
  var t = findArchived(id); if(!t) return;
  state.archive = state.archive.filter(function(x){ return x.id !== id; });
  delete t.archivedAt;
  state.tasks.push(t);
  commit(["tasks", "archive"], '"' + t.title + '" panoya geri alındı');
}
export function deleteArchived(id){
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
export function moveTask(id, status){
  var t = findTask(id); if(!t || t.status === status) return;
  if(needsDates(status) && !hasDates(t)){
    toast("Bu işi " + STATUS_MAP[status].name + " durumuna taşımak için önce başlangıç ve bitiş tarihi girin", true);
    state.pendingStatus = status; openModal(id); return;
  }
  t.status = status; t.updatedAt = todayISO();
  commit(["tasks"], '"' + t.title + '" → ' + STATUS_MAP[status].name);
}
export function toggleSelect(id){
  if(state.selected[id]) delete state.selected[id]; else state.selected[id] = true;
  renderBoard(); renderSelectBar();
}
export function clearSelection(){ state.selected = {}; renderBoard(); renderSelectBar(); }
/* Sekmedeki (filtreyle görünen) işlerin hepsi seçiliyse seçimi kaldırır, değilse hepsini seçer */
export function toggleTab(status){
  var items = filteredTasks().filter(function(t){ return t.status === status; });
  var all = items.length && items.every(function(t){ return state.selected[t.id]; });
  items.forEach(function(t){ if(all) delete state.selected[t.id]; else state.selected[t.id] = true; });
  renderBoard(); renderSelectBar();
}

