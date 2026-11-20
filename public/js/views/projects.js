/* Projeler: liste, proje detayı, dosyalar ve ek metni durumu */
import { ICON, PREF_STATUS_TAB, PRIO_MAP, STATUSES, STATUS_MAP } from "../core/config.js";
import { searchKey, urgencyGroup } from "../core/domain.js";
import { renderAll, switchView } from "../core/render.js";
import { getProject, notesOfProject, state } from "../core/state.js";
import { $, esc, fmtSize, pref } from "../core/utils.js";
import { openProjectNote } from "../modals/project-note-modal.js";
import { openModal } from "../modals/task-modal.js";
import { dueBadge, statusCounts } from "./board.js";
import { memoTime } from "./memos.js";
import { renderPa, renderPaSources } from "./project-assistant.js";
import { sortedProjects } from "./sidebar.js";

export function projectStats(p){
  var tasks = state.tasks.filter(function(t){ return t.projectId === p.id; });
  var notes = notesOfProject(p.id);
  return {
    tasks: tasks, notes: notes,
    over: tasks.filter(function(t){ return urgencyGroup(t) === "over"; }).length,
    archived: state.archive.filter(function(t){ return t.projectId === p.id; }).length,
    files: notes.reduce(function(n, x){ return n + x.attachments.length; }, 0),
    lastNote: notes.reduce(function(m, x){ return x.updatedAt > m ? x.updatedAt : m; }, "")
  };
}
export function projectFiles(p){
  var out = [];
  notesOfProject(p.id).sort(function(a, b){ return b.updatedAt.localeCompare(a.updatedAt); }).forEach(function(n){
    n.attachments.forEach(function(a){ out.push({ att: a, note: n }); });
  });
  return out;
}
export function renderProjects(){
  var active = state.projects.filter(function(p){ return p.status === "aktif"; }).length, badge = $("projCountBadge");
  badge.textContent = active; badge.style.display = active ? "" : "none";
  if(state.view !== "projects") return;
  var p = state.projectView ? getProject(state.projectView) : null;
  if(state.projectView && !p) state.projectView = null;
  $("projListView").style.display = p ? "none" : "";
  $("projDetailView").style.display = p ? "" : "none";
  if(p) renderProjectDetail(p); else renderProjectList();
}
export function projectCardHtml(p){
  var s = projectStats(p);
  return '<button type="button" class="proj-card' + (p.status === "arsivlenmis" ? " archived" : "") + '" data-proj-open="' + p.id + '" style="--pc:' + p.color + ';">' +
    '<span class="proj-card-name"><span class="proj-dot"></span>' + esc(p.name) + '</span>' +
    '<span class="proj-card-stats">' +
      '<span><b>' + s.tasks.length + '</b> aktif iş</span>' +
      (s.over ? '<span class="over"><b>' + s.over + '</b> gecikmiş</span>' : "") +
      '<span><b>' + s.notes.length + '</b> not</span>' +
      '<span><b>' + s.files + '</b> dosya</span></span>' +
    '<span class="proj-card-foot">' + (s.lastNote ? "Son not: " + esc(memoTime(s.lastNote)) : "Henüz not yok") + '</span></button>';
}
export function renderProjectList(){
  var act = sortedProjects().filter(function(p){ return p.status === "aktif"; });
  var arc = sortedProjects().filter(function(p){ return p.status !== "aktif"; });
  $("projGrid").innerHTML = act.map(projectCardHtml).join("");
  $("projArchivedWrap").style.display = arc.length ? "" : "none";
  $("projArchivedGrid").innerHTML = arc.map(projectCardHtml).join("");
  $("projEmpty").classList.toggle("show", !state.projects.length);
}
export function renderProjectDetail(p){
  var s = projectStats(p);
  $("projTitle").innerHTML = '<span class="proj-dot" style="--pc:' + p.color + ';"></span>' + esc(p.name) +
    (p.status !== "aktif" ? ' <span class="project-status-pill archived">Arşivde</span>' : "");
  /* İşler: durum sayıları (tıklayınca pano o proje + durumla açılır) ve listesi */
  var counts = statusCounts(s.tasks);
  $("projStatusChips").innerHTML = STATUSES.map(function(st){
    return '<button type="button" class="tab-jump" data-proj-status="' + st.id + '" style="--st:' + st.color + ';"' + (counts[st.id] ? "" : " disabled") + '>' +
      '<span class="stab-dot"></span>' + st.name + ' <b>' + counts[st.id] + '</b></button>';
  }).join("") + (s.archived ? '<span class="proj-muted">' + s.archived + ' iş arşivde</span>' : "");
  var tl = s.tasks.slice().sort(function(a, b){
    var ua = { over: 0, today: 1, soon: 2 }, ga = ua[urgencyGroup(a)], gb = ua[urgencyGroup(b)];
    return (ga == null ? 9 : ga) - (gb == null ? 9 : gb) || PRIO_MAP[a.priority].order - PRIO_MAP[b.priority].order;
  });
  $("projTasks").innerHTML = tl.length ? tl.slice(0, 12).map(function(t){
    return '<button type="button" class="proj-task" data-open="' + t.id + '"><span class="stab-dot" style="--st:' + STATUS_MAP[t.status].color + ';"></span>' +
      '<span class="proj-task-title">' + esc(t.title) + '</span>' + dueBadge(t) + '</button>';
  }).join("") + (tl.length > 12 ? '<button type="button" class="a-more" data-proj-board="1">Panoda tümünü gör (' + tl.length + ')</button>' : "")
    : '<div class="note-empty">Bu projede aktif iş yok.</div>';
  /* Notlar */
  var q = searchKey(state.pnSearch.trim());
  var notes = s.notes.filter(function(n){ return !q || searchKey(n.title + " " + n.text).indexOf(q) !== -1; })
    .sort(function(a, b){ return b.updatedAt.localeCompare(a.updatedAt); });
  $("pnList").innerHTML = notes.map(function(n){
    return '<button type="button" class="pn-card" data-pn-open="' + n.id + '">' +
      '<span class="pn-card-head"><span class="pn-card-title">' + esc(n.title || "Adsız not") + '</span><span class="memo-time">' + esc(memoTime(n.updatedAt)) + '</span></span>' +
      (n.text ? '<span class="pn-card-text">' + esc(n.text.slice(0, 400)) + '</span>' : "") +
      (n.attachments.length ? '<span class="pn-card-att">' + ICON.clip + n.attachments.length + ' ek</span>' : "") + '</button>';
  }).join("");
  $("pnEmpty").style.display = notes.length ? "none" : "";
  $("pnEmpty").textContent = s.notes.length ? "Aramayla eşleşen not yok." : "Henüz not yok. \"Yeni not\" ile toplantı notları, kararlar, yazışmalar ekleyin; dosya da ekleyebilirsiniz.";
  $("pnCount").textContent = s.notes.length;
  /* Dosyalar (notlardaki tüm ekler) */
  var files = projectFiles(p);
  $("projFiles").innerHTML = files.length ? files.map(function(f){
    return '<div class="proj-file">' + ICON.file +
      '<span class="proj-file-main"><a class="proj-file-name" href="/api/attachments/' + f.att.id + '" target="_blank" rel="noopener" title="Aç / indir">' + esc(f.att.name) + '</a>' +
      '<span class="proj-file-sub"><span class="att-size">' + fmtSize(f.att.size) + '</span>' + attTextBadge(f.att.id) +
      '<button type="button" class="proj-file-note" data-pn-open="' + f.note.id + '" title="Notu aç">' + esc(f.note.title || "Adsız not") + '</button></span></span></div>';
  }).join("") : '<div class="note-empty">Notlara eklenen dosyalar burada listelenir.</div>';
  $("projFileCount").textContent = files.length;
  loadAttTextStatus(files.map(function(f){ return f.att.id; }));
  renderPa(p);
}

/* Eklerden metin çıkarma durumu (LLM'e hangi dosyaların içeriğinin gidebileceği). Sunucu sonucu önbelleğe alır. */
export var attTextCache = {}, attTextPending = {};
export var ATT_TEXT_LABEL = {
  ok:          ["ok",   "✓ okunabilir"],
  partial:     ["warn", "⚠ kısmen okunabilir"],
  none:        ["bad",  "✗ okunamadı"],
  unsupported: ["off",  "– desteklenmiyor"]
};
export function attTextBadge(id){
  var r = attTextCache[id];
  if(!r) return '<span class="att-text pending" data-att-st="' + id + '">metin okunuyor…</span>';
  var l = ATT_TEXT_LABEL[r.status] || ATT_TEXT_LABEL.none;
  var tip = r.status === "ok" || r.status === "partial" ? r.chars.toLocaleString("tr-TR") + " karakter metin LLM'e verilebilir" + (r.reason ? " · " + r.reason : "") : r.reason;
  return '<span class="att-text ' + l[0] + '" data-att-st="' + id + '" title="' + esc(tip) + '">' + l[1] +
    (r.status === "ok" || r.status === "partial" ? ' · ' + (r.chars >= 1000 ? Math.round(r.chars / 1000) + " bin" : r.chars) + " kr." : "") + '</span>';
}
export function loadAttTextStatus(ids){
  var need = ids.filter(function(id){ return !attTextCache[id] && !attTextPending[id]; });
  if(!need.length) return;
  need.forEach(function(id){ attTextPending[id] = true; });
  fetch("/api/attachments/text-status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: need }) })
    .then(function(r){ return r.ok ? r.json() : { items: {} }; })
    .then(function(j){
      need.forEach(function(id){ delete attTextPending[id]; if(j.items && j.items[id]) attTextCache[id] = j.items[id]; });
      /* Yalnızca rozetleri güncelle (tüm sayfayı yeniden çizme) */
      need.forEach(function(id){
        Array.prototype.forEach.call(document.querySelectorAll('[data-att-st="' + id + '"]'), function(el){ el.outerHTML = attTextBadge(id); });
      });
      if(state.view === "projects" && state.projectView) renderPaSources();   // asistanın kaynak özeti dosya durumlarına bağlı
    }, function(){ need.forEach(function(id){ delete attTextPending[id]; }); });
}

/* ---------- Proje asistanı (LLM): projenin notları + eklerin metni üzerinden soru-cevap ----------
   Bağlamı sunucu kurar; buradan yalnızca hangi not/eklerin dahil olduğu gider. Sohbet yalnızca bellekte tutulur. */

export function openProject(id){ state.projectView = id; state.pnSearch = ""; $("pnSearch").value = ""; switchView("projects"); }

/* Olay bağlama (main.js → bind) */
export function bindProjects(){
  /* Projeler */
  $("tabProjects").onclick = function(){ state.projectView = null; switchView("projects"); };
  var projOpen = function(e){ var b = e.target.closest("[data-proj-open]"); if(b) openProject(b.getAttribute("data-proj-open")); };
  $("projGrid").onclick = projOpen; $("projArchivedGrid").onclick = projOpen;
  $("btnProjManage").onclick = function(){ switchView("settings"); };
  $("btnProjEmptyManage").onclick = function(){ switchView("settings"); };
  $("btnProjBack").onclick = function(){ state.projectView = null; renderProjects(); };
  $("btnNewPn").onclick = function(){ if(state.projectView) openProjectNote(null, state.projectView); };
  var projToBoard = function(status){
    state.filterProject = state.projectView; state.filterUnit = "all"; state.filterMember = "all"; state.filterPrio = "all"; state.urgencyFilter = null; state.search = ""; $("searchInput").value = "";
    if(status){ state.statusTab = status; pref(PREF_STATUS_TAB, status); }
    switchView("board"); renderAll();
  };
  $("btnProjBoard").onclick = function(){ projToBoard(null); };
  $("projStatusChips").onclick = function(e){ var b = e.target.closest("[data-proj-status]"); if(b && !b.disabled) projToBoard(b.getAttribute("data-proj-status")); };
  $("projTasks").onclick = function(e){
    var o = e.target.closest("[data-open]"); if(o) return openModal(o.getAttribute("data-open"));
    if(e.target.closest("[data-proj-board]")) projToBoard(null);
  };
  var pnOpen = function(e){ var b = e.target.closest("[data-pn-open]"); if(b) openProjectNote(b.getAttribute("data-pn-open")); };
  $("pnList").onclick = pnOpen; $("projFiles").onclick = pnOpen;
  $("pnSearch").oninput = function(e){ state.pnSearch = e.target.value; renderProjects(); };
}
