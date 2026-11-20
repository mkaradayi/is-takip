/* Açık pencereler: Esc ile en üstteki kapatılır; AI ve yeniden yükleme için kontrol */
import { selectionCount } from "./domain.js";
import { closeConfirm } from "./ui.js";
import { $ } from "./utils.js";
import { clearSelection } from "../features/task-actions.js";
import { requestCloseProjectNote } from "../modals/project-note-modal.js";
import { requestCloseModal } from "../modals/task-modal.js";

export function topOverlayClose(){
  if($("confirmOverlay").classList.contains("show")) closeConfirm();
  else if($("pnOverlay").classList.contains("show")) requestCloseProjectNote();
  else if($("overlay").classList.contains("show")) requestCloseModal();
  else if(selectionCount()) clearSelection();
}
export function anyOverlayOpen(){
  return ["overlay", "confirmOverlay", "pnOverlay"].some(function(id){ return $(id).classList.contains("show"); });
}
