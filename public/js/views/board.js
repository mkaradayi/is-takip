/* Pano: durum sekmeleri, kartlar, sürükle-bırak, seçim çubuğu */
import { ICON, PREF_STATUS_TAB, PRIO_MAP, STATUSES, STATUS_MAP } from "../core/config.js";
import { dueText, filteredTasks, latestNotes, searchKey, selectedTasks, selectionCount, taskMatch, urgency } from "../core/domain.js";
import { findTask, getMember, getProject, getUnit, state } from "../core/state.js";
import { $, esc, fmtDate, initials, pref } from "../core/utils.js";
import { mailTasks } from "../features/mail.js";
import { archiveTask, clearSelection, deleteTask, moveTask, toggleSelect, toggleTab } from "../features/task-actions.js";
import { openModal } from "../modals/task-modal.js";
import { remGroup, remWhen, taskReminders } from "./reminders.js";

/* Durum sekmeleri: sayılar kenar çubuğu filtrelerine, aramaya ve uyarı filtresine göre hesaplanır */
export function statusCounts(tasks){
  var c = {}; STATUSES.forEach(function(s){ c[s.id] = 0; });
  tasks.forEach(function(t){ if(c[t.status] != null) c[t.status]++; });
  return c;
}
export function filterActive(){
  return !!(state.search.trim() || state.urgencyFilter || state.filterUnit !== "all" || state.filterPrio !== "all" || state.filterProject !== "all");
}
export function setStatusTab(id){
  if(!STATUS_MAP[id]) return;
  state.statusTab = id; pref(PREF_STATUS_TAB, id);
  renderPipeline(); renderBoard();
}
export function renderPipeline(){
  var counts = statusCounts(filteredTasks()), hl = filterActive();
  $("pipeline").innerHTML = STATUSES.map(function(s){
    var on = state.statusTab === s.id, c = counts[s.id];
    return '<button type="button" role="tab" aria-selected="' + on + '" class="stab' + (on ? " active" : "") + (hl && c && !on ? " hit" : "") + '" data-status="' + s.id + '" style="--st:' + s.color + ';"' +
      ' title="' + s.name + (hl ? " — filtreyle eşleşen " + c + " iş" : " — " + c + " iş") + ' (kartı buraya sürükleyerek durumunu değiştirebilirsiniz)">' +
      '<span class="stab-dot"></span><span class="stab-name">' + s.name + '</span><span class="stab-count">' + c + '</span></button>';
  }).join("");
}

export function dueBadge(t){
  var u = urgency(t);
  if(u === "done") return '<span class="due-badge due-done">' + ICON.check + fmtDate(t.dueDate) + '</span>';
  if(u === "cancelled") return '<span class="due-badge due-normal">' + fmtDate(t.dueDate) + '</span>';
  if(u === "over" || u === "soon"){
    var txt = dueText(t);
    return '<span class="due-badge due-' + u + '">' + ICON.clock + txt.charAt(0).toUpperCase() + txt.slice(1) + '</span>';
  }
  return '<span class="due-badge due-normal">' + ICON.clock + fmtDate(t.dueDate) + '</span>';
}
export function projectTag(t){
  var p = getProject(t.projectId);
  return p ? '<span class="project-tag" style="background:' + p.color + '22; color:' + p.color + ';">' + ICON.folder + esc(p.name) + '</span>' : "";
}
/* Sorumlular: en çok 2 ekip etiketi (+N), ardından çalışanların baş harfleri (ekip rengiyle) */
var MAX_UNIT_TAGS = 2, MAX_AVATARS = 3;
export function unitTag(t){
  var us = t.units.map(getUnit);
  var h = us.slice(0, MAX_UNIT_TAGS).map(function(u){
    return '<span class="unit-tag" style="background:' + u.color + '22; color:' + u.color + ';"><span class="dot" style="background:' + u.color + ';"></span>' + esc(u.name) + '</span>';
  }).join("");
  if(us.length > MAX_UNIT_TAGS) h += '<span class="unit-tag unit-more" title="' + esc(us.slice(MAX_UNIT_TAGS).map(function(u){ return u.name; }).join(", ")) + '">+' + (us.length - MAX_UNIT_TAGS) + '</span>';
  return h + memberStack(t);
}
export function memberStack(t){
  if(!t.members.length) return "";
  var ms = t.members.map(getMember);
  return '<span class="member-stack" title="' + esc(ms.map(function(m){ return m.name; }).join(", ")) + '">' + ms.slice(0, MAX_AVATARS).map(function(m){
    return '<span class="avatar" style="background:' + getUnit(m.unitId).color + ';">' + esc(initials(m.name)) + '</span>';
  }).join("") + (ms.length > MAX_AVATARS ? '<span class="avatar more">+' + (ms.length - MAX_AVATARS) + '</span>' : "") + '</span>';
}
export function prioFlag(t){
  var p = PRIO_MAP[t.priority];
  return '<span class="prio-flag" style="background:' + p.soft + '; color:' + p.color + ';">' + p.name + '</span>';
}

/* Arama başlıkta değil de açıklama/notta eşleştiyse kartta küçük bir ipucu gösterilir */
export function matchHint(t){
  var q = searchKey(state.search.trim()); if(!q) return "";
  var m = taskMatch(t, q);
  return m === "desc" || m === "note" ? '<span class="match-hint">' + (m === "desc" ? "açıklamada" : "notta") + ' eşleşti</span>' : "";
}
/* İşe bağlı, tamamlanmamış hatırlatma varsa zil (bugün/gecikmiş olanlar vurgulu) */
export function remBell(t){
  var rs = taskReminders(t.id); if(!rs.length) return "";
  var due = rs.some(function(r){ var g = remGroup(r); return g === "over" || g === "today"; });
  return '<span class="card-bell' + (due ? " due" : "") + '" title="' + rs.length + ' hatırlatma · ilki: ' + esc(remWhen(rs[0])) + '">' + ICON.bell + rs.length + '</span>';
}
export function cardHtml(t){
  var n = latestNotes(t, 1)[0];
  var sel = !!state.selected[t.id];
  var note = n ? '<div class="note-preview">' + ICON.note + '<span class="note-text">' + esc(n.text) + '</span>' +
    (t.notes.length > 1 ? '<span class="note-count">+' + (t.notes.length - 1) + '</span>' : "") + '</div>' : "";
  return '<div class="card' + (sel ? " selected" : "") + '" draggable="true" data-id="' + t.id + '">' +
    '<div class="card-top">' +
      '<div class="card-title">' + esc(t.title) + '</div>' + prioFlag(t) +
      '<button type="button" class="card-check' + (sel ? " on" : "") + '" data-check="' + t.id + '" title="Mail için seç" aria-label="Mail için seç" aria-pressed="' + sel + '">' + ICON.check + '</button>' +
      '<button type="button" class="card-archive" data-archive="' + t.id + '" title="Arşivle" aria-label="Arşivle">' + ICON.archive + '</button>' +
      '<button type="button" class="card-del" data-del="' + t.id + '" title="İşi sil" aria-label="İşi sil">' + ICON.trash + '</button></div>' +
    (t.description ? '<div class="card-desc">' + esc(t.description) + '</div>' : "") + note +
    '<div class="card-tags">' + unitTag(t) + projectTag(t) + dueBadge(t) + '</div>' +
    '<div class="card-meta"><span>Giriş: ' + fmtDate(t.createdAt) + '</span>' + matchHint(t) + remBell(t) +
      (t.attachments.length ? '<span class="card-att" title="' + t.attachments.length + ' ek">' + ICON.clip + t.attachments.length + '</span>' : "") +
    '</div></div>';
}

export function tabTasks(tasks, status){
  return tasks.filter(function(t){ return t.status === status; }).sort(function(a, b){
    var d = PRIO_MAP[a.priority].order - PRIO_MAP[b.priority].order;
    if(d) return d;
    return (a.dueDate || "9999").localeCompare(b.dueDate || "9999");
  });
}
/* Pano: seçili durum sekmesinin işleri kart ızgarasında; üstte "tümünü seç" çubuğu */
export function renderBoard(){
  var tasks = filteredTasks();
  var board = $("board"), empty = $("emptyState");
  if(state.tasks.length > 0 && tasks.length === 0){ board.style.display = "none"; empty.classList.add("show"); }
  else { board.style.display = ""; empty.classList.remove("show"); }
  board.classList.toggle("selecting", selectionCount() > 0);
  var s = STATUS_MAP[state.statusTab];
  var items = tabTasks(tasks, s.id);
  var nSel = items.filter(function(t){ return state.selected[t.id]; }).length;
  var all = items.length > 0 && nSel === items.length;
  var lbl = all ? "Bu sekmedeki seçimi kaldır" : "Bu sekmedeki tüm işleri seç";
  var check = items.length
    ? '<button type="button" class="col-check' + (all ? " on" : nSel ? " partial" : "") + '" data-colcheck="' + s.id + '" aria-pressed="' + all + '" title="' + lbl + '" aria-label="' + lbl + '">' +
      (nSel && !all ? '<span class="dash"></span>' : ICON.check) + '</button>' : "";
  var bar = '<div class="tab-toolbar">' + check +
    (items.length ? '<span class="tab-toolbar-label" data-colcheck="' + s.id + '">' + (all ? "Seçimi kaldır" : "Tümünü seç") + '</span><span class="tab-toolbar-sep">·</span>' : "") +
    '<span class="tab-toolbar-count"><b>' + items.length + '</b> iş' + (nSel ? " · " + nSel + " seçili" : "") + '</span>' +
    '<span class="spacer"></span><span class="tab-toolbar-hint">Öncelik, sonra termine göre sıralı · durumu değiştirmek için kartı bir sekmeye sürükleyin</span></div>';
  var body;
  if(items.length) body = '<div class="tab-grid">' + items.map(cardHtml).join("") + '</div>';
  else {
    /* Bu sekme boş ama filtreyle eşleşen işler başka sekmelerdeyse oraya geçiş bağlantıları göster */
    var counts = statusCounts(tasks);
    var others = STATUSES.filter(function(x){ return x.id !== s.id && counts[x.id]; });
    body = '<div class="tab-empty">Bu sekmede ' + (filterActive() ? "filtreyle eşleşen " : "") + 'iş yok.' +
      (others.length ? '<div class="tab-empty-links">' + (filterActive() ? "Eşleşmeler: " : "Diğer sekmeler: ") + others.map(function(x){
        return '<button type="button" class="tab-jump" data-goto="' + x.id + '" style="--st:' + x.color + ';"><span class="stab-dot"></span>' + x.name + ' <b>' + counts[x.id] + '</b></button>';
      }).join("") + '</div>' : "") + '</div>';
  }
  board.innerHTML = bar + body;
  layoutMasonry();
}

/* Masonry: CSS ızgarası bir satırdaki en uzun kart kadar yer ayırdığı için kısa kartların altında boşluk kalıyordu.
   Kartlar önce ızgaraya basılır; ızgaranın hesapladığı sütun sayısı ve kartların gerçek yükseklikleri ölçülür,
   sonra her kart (sıra korunarak) en kısa sütuna taşınır. Sütun genişliği ızgarayla aynı olduğu için ölçüm doğrudur.
   Pano görünmüyorsa (başka sayfa açık) ızgara olduğu gibi kalır; görünür olunca ResizeObserver yeniden dizer. */
var GRID_GAP = 12, masonryCols = 0;
function gridColumnCount(grid){
  var cols = getComputedStyle(grid).gridTemplateColumns;
  return cols && cols !== "none" ? cols.split(" ").length : 0;
}
export function layoutMasonry(){
  var grid = document.querySelector("#board .tab-grid");
  masonryCols = 0;
  if(!grid || !grid.offsetWidth) return;
  var n = gridColumnCount(grid);
  masonryCols = n;
  if(n < 2) return;
  var cards = Array.prototype.slice.call(grid.children);
  var heights = cards.map(function(c){ return c.offsetHeight; });
  var cols = [], sums = [];
  for(var i = 0; i < n; i++){ var col = document.createElement("div"); col.className = "tab-col"; cols.push(col); sums.push(0); }
  cards.forEach(function(card, k){
    var j = sums.indexOf(Math.min.apply(null, sums));
    cols[j].appendChild(card); sums[j] += heights[k] + GRID_GAP;
  });
  grid.classList.add("masonry");
  cols.forEach(function(col){ grid.appendChild(col); });
}
/* Genişlik değişip sütun sayısı değişirse (ya da pano görünür olursa) yeniden diz */
function watchMasonry(){
  var pending = false;
  var check = function(){
    pending = false;
    var grid = document.querySelector("#board .tab-grid");
    if(!grid || !grid.offsetWidth) return;
    var probe = document.createElement("div"); probe.className = "tab-grid"; probe.style.cssText = "visibility:hidden;height:0;overflow:hidden;";
    grid.parentNode.insertBefore(probe, grid);
    var n = gridColumnCount(probe); probe.remove();
    if(n !== masonryCols) renderBoard();
  };
  if(window.ResizeObserver) new ResizeObserver(function(){ if(!pending){ pending = true; requestAnimationFrame(check); } }).observe($("board"));
  if(document.fonts && document.fonts.ready) document.fonts.ready.then(function(){ if($("board").offsetWidth) renderBoard(); });   // yazı tipi yüklenince yükseklikler değişir
}

export function renderSelectBar(){
  /* Panoda olmayan (silinmiş/arşivlenmiş) işleri seçimden düşür */
  Object.keys(state.selected).forEach(function(id){ if(!findTask(id)) delete state.selected[id]; });
  var n = selectionCount();
  $("selectCount").textContent = n;
  $("selectBar").classList.toggle("show", n > 0 && state.view === "board");
  document.body.classList.toggle("has-selection", n > 0 && state.view === "board");
}

/* Olay bağlama (main.js → bind) */
export function bindBoard(){
  watchMasonry();
  /* Durum sekmeleri: tıklayınca sekme değişir; sürüklenen kart bir sekmeye bırakılınca durumu değişir */
  var tabs = $("pipeline");
  tabs.onclick = function(e){ var b = e.target.closest("[data-status]"); if(b) setStatusTab(b.getAttribute("data-status")); };
  var dragTab = null;
  var clearDragTab = function(){ if(dragTab){ dragTab.classList.remove("drag-over"); dragTab = null; } };
  /* Bırakınca pano yeniden çizildiği için "dragend" sayfadan kalkmış karta gelir ve panoya ulaşmaz;
     vurguyu bu yüzden bırakma anında ve belge düzeyinde de temizleriz. */
  var endDrag = function(){ document.body.classList.remove("dragging-card"); clearDragTab(); };
  document.addEventListener("drop", endDrag);
  document.addEventListener("dragend", endDrag, true);
  tabs.ondragover = function(e){
    var b = e.target.closest("[data-status]"); if(!b || !document.body.classList.contains("dragging-card")) return;
    e.preventDefault(); e.dataTransfer.dropEffect = "move";
    if(dragTab !== b){ clearDragTab(); dragTab = b; b.classList.add("drag-over"); }
  };
  tabs.ondragleave = function(e){ if(dragTab && !dragTab.contains(e.relatedTarget)) clearDragTab(); };
  tabs.ondrop = function(e){
    var b = e.target.closest("[data-status]"); endDrag(); if(!b) return;
    e.preventDefault();
    moveTask(e.dataTransfer.getData("text/plain"), b.getAttribute("data-status"));
  };

  /* Pano: tıklama + sürükle-bırak (delegasyon) */
  var board = $("board");
  board.onclick = function(e){
    var col = e.target.closest("[data-colcheck]"), go = e.target.closest("[data-goto]");
    if(col){ toggleTab(col.getAttribute("data-colcheck")); return; }
    if(go){ setStatusTab(go.getAttribute("data-goto")); return; }
    var chk = e.target.closest(".card-check"), arch = e.target.closest(".card-archive"), del = e.target.closest(".card-del"), card = e.target.closest(".card");
    if(chk){ e.stopPropagation(); toggleSelect(chk.getAttribute("data-check")); }
    else if(arch){ e.stopPropagation(); archiveTask(arch.getAttribute("data-archive")); }
    else if(del){ e.stopPropagation(); deleteTask(del.getAttribute("data-del")); }
    else if(card){
      if(e.ctrlKey || e.metaKey){ toggleSelect(card.getAttribute("data-id")); return; }   // Ctrl+tık ile hızlı seçim
      openModal(card.getAttribute("data-id"));
    }
  };
  board.ondragstart = function(e){
    var c = e.target.closest(".card"); if(!c) return;
    c.classList.add("dragging"); document.body.classList.add("dragging-card");
    e.dataTransfer.setData("text/plain", c.getAttribute("data-id")); e.dataTransfer.effectAllowed = "move";
  };
  board.ondragend = function(e){
    var c = e.target.closest(".card"); if(c) c.classList.remove("dragging");
    endDrag();
  };

  /* Seçim çubuğu */
  $("btnSelectAll").onclick = function(){ tabTasks(filteredTasks(), state.statusTab).forEach(function(t){ state.selected[t.id] = true; }); renderBoard(); renderSelectBar(); };
  $("btnSelectClear").onclick = clearSelection;
  $("btnMailSelected").onclick = function(){ mailTasks(selectedTasks()); };
}
