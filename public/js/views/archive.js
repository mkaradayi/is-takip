/* Arşiv sayfası */
import { ICON, STATUS_MAP } from "../core/config.js";
import { searchKey, taskMatch } from "../core/domain.js";
import { state } from "../core/state.js";
import { $, esc, fmtDate } from "../core/utils.js";
import { deleteArchived, restoreTask } from "../features/task-actions.js";
import { prioFlag, projectTag, unitTag } from "./board.js";

export function archiveCardHtml(t){
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
export function renderArchive(){
  $("archiveCountBadge").textContent = state.archive.length;
  var q = searchKey(state.archiveSearch.trim());
  var items = state.archive.slice().sort(function(a, b){ return (b.archivedAt || "").localeCompare(a.archivedAt || ""); })
    .filter(function(t){ return !q || !!taskMatch(t, q); });
  $("archiveList").innerHTML = items.map(archiveCardHtml).join("");
  $("archiveEmptyState").classList.toggle("show", items.length === 0);
}

/* ---------- Hatırlatmalar ---------- */

/* Olay bağlama (main.js → bind) */
export function bindArchive(){
  /* Arşiv listesi */
  $("archiveList").onclick = function(e){
    var r = e.target.closest("[data-restore]"), d = e.target.closest("[data-perm-del]");
    if(r) restoreTask(r.getAttribute("data-restore"));
    else if(d) deleteArchived(d.getAttribute("data-perm-del"));
  };
}
