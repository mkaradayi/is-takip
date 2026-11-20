/* Ayarlar: sorumlu ve proje yönetimi (görünüm + eylemler) */
import { ICON, PROJECT_COLORS } from "../core/config.js";
import { allTasks, projectTaskCount, unitTaskCount } from "../core/domain.js";
import { UNIT_MAP, getProject, normalizeProject, normalizeUnit, notesOfProject, setUnits, state } from "../core/state.js";
import { commit } from "../core/storage.js";
import { showConfirm, showInfo, toast } from "../core/ui.js";
import { $, esc, uid } from "../core/utils.js";
import { sortedProjects } from "./sidebar.js";

/* Tek renk noktası; tıklayınca palet açılır (satırda ad alanına yer kalsın) */
export function swatches(attr, id, current){
  return '<div class="color-pop"><button type="button" class="color-dot" data-colorpop="1" style="background:' + current + ';" title="Rengi değiştir" aria-label="Rengi değiştir"></button>' +
    '<div class="color-menu">' + PROJECT_COLORS.map(function(c){
      return '<button type="button" class="project-swatch ' + (c.toLowerCase() === String(current).toLowerCase() ? "active-swatch" : "") + '" style="background:' + c + ';" ' +
        attr + '="' + id + '" data-color="' + c + '" title="Renk seç" aria-label="Renk seç"></button>';
    }).join("") + '</div></div>';
}
export function closeColorPops(except){
  Array.prototype.forEach.call(document.querySelectorAll(".color-pop.open"), function(p){ if(p !== except) p.classList.remove("open"); });
}
export function renderUnitManage(){
  var last = state.units.length - 1;
  $("unitManageList").innerHTML = state.units.map(function(u, i){
    return '<div class="project-manage-item">' + swatches("data-uswatch", u.id, u.color) +
      '<input type="text" value="' + esc(u.name) + '" data-urename="' + u.id + '" maxlength="80" />' +
      '<span class="project-status-pill">' + unitTaskCount(u.id) + ' iş</span>' +
      '<div class="project-manage-actions">' +
        '<button type="button" data-umove="' + u.id + '" data-dir="-1" title="Yukarı taşı"' + (i === 0 ? " disabled" : "") + '>' + ICON.up + '</button>' +
        '<button type="button" data-umove="' + u.id + '" data-dir="1" title="Aşağı taşı"' + (i === last ? " disabled" : "") + '>' + ICON.down + '</button>' +
        '<button type="button" data-udel="' + u.id + '" title="Sil">' + ICON.trash + '</button></div></div>';
  }).join("");
}
export function renderProjectManage(){
  var list = $("projectManageList"), empty = $("projectManageEmpty");
  if(!state.projects.length){ list.innerHTML = ""; empty.style.display = "block"; return; }
  empty.style.display = "none";
  list.innerHTML = sortedProjects().map(function(p){
    return '<div class="project-manage-item">' + swatches("data-swatch", p.id, p.color) +
      '<input type="text" value="' + esc(p.name) + '" data-rename="' + p.id + '" maxlength="80" />' +
      '<span class="project-status-pill ' + (p.status === "arsivlenmis" ? "archived" : "") + '">' + (p.status === "arsivlenmis" ? "Arşivde" : projectTaskCount(p.id) + " iş") + '</span>' +
      '<div class="project-manage-actions">' +
        '<button type="button" data-toggle="' + p.id + '" title="' + (p.status === "aktif" ? "Arşivle" : "Aktif Et") + '">' + ICON.archive + '</button>' +
        '<button type="button" data-pdel="' + p.id + '" title="Kalıcı Sil">' + ICON.trash + '</button></div></div>';
  }).join("");
}
export function renderSettings(){ renderUnitManage(); renderProjectManage(); }

export function nextColor(used){
  return PROJECT_COLORS.filter(function(c){ return used.indexOf(c) === -1; })[0] || PROJECT_COLORS[used.length % PROJECT_COLORS.length];
}
export function addUnit(){
  var inp = $("newUnitName"), name = inp.value.trim();
  if(!name){ inp.focus(); return; }
  if(state.units.some(function(u){ return u.name.toLocaleLowerCase("tr") === name.toLocaleLowerCase("tr"); })){
    toast('"' + name + '" adlı bir sorumlu zaten var', true); inp.focus(); return;
  }
  var u = normalizeUnit({ id: uid(), name: name, color: nextColor(state.units.map(function(x){ return x.color; })), order: state.units.length });
  setUnits(state.units.concat(u));
  inp.value = ""; commit(["units"], '"' + name + '" sorumlusu eklendi'); inp.focus();
}
export function renameUnit(id, name){
  var u = UNIT_MAP[id]; name = name.trim();
  if(!u || !name || name === u.name){ renderUnitManage(); return; }
  u.name = name; commit(["units"], "Sorumlu adı güncellendi");
}
export function recolorUnit(id, color){
  var u = UNIT_MAP[id]; if(!u) return;
  u.color = color; commit(["units"], "Sorumlu rengi güncellendi");
}
export function moveUnit(id, dir){
  var i = state.units.indexOf(UNIT_MAP[id]), j = i + dir;
  if(i < 0 || j < 0 || j >= state.units.length) return;
  var a = state.units[i]; state.units[i] = state.units[j]; state.units[j] = a;
  setUnits(state.units.map(function(u, k){ u.order = k; return u; }));
  commit(["units"], "Sıralama güncellendi");
}
export function deleteUnit(id){
  var u = UNIT_MAP[id]; if(!u) return;
  if(state.units.length <= 1){ showInfo("Silinemedi", "En az bir sorumlu ekip kalmalı."); return; }
  var n = unitTaskCount(id), nm = u.members.length;
  /* İşlerde bu ekip hedef ekiple değiştirilir; ekibin çalışanları hedef ekibe taşınır (işlerdeki çalışan atamaları korunur) */
  var remove = function(target){
    var tu = UNIT_MAP[target];
    if(n) allTasks().forEach(function(t){
      var i = t.units.indexOf(id); if(i === -1) return;
      t.units.splice(i, 1); if(t.units.indexOf(target) === -1) t.units.splice(i, 0, target);
    });
    if(nm && tu) tu.members = tu.members.concat(u.members);
    setUnits(state.units.filter(function(x){ return x.id !== id; }));
    if(state.filterUnit === id) state.filterUnit = "all";
    commit(n ? ["tasks", "archive", "units"] : ["units"], '"' + u.name + '" silindi' + (n ? ", " + n + " iş aktarıldı" : "") + (nm ? ", " + nm + " çalışan taşındı" : ""));
  };
  if(!n && !nm) return showConfirm({ title: "Ekibi sil", message: '"' + u.name + '" silinecek.', confirmLabel: "Sil", danger: true, onConfirm: remove });
  var others = state.units.filter(function(x){ return x.id !== id; });
  var parts = []; if(n) parts.push(n + " iş (aktif + arşiv)"); if(nm) parts.push(nm + " çalışan");
  showConfirm({
    title: "Ekibi sil",
    message: '"' + u.name + '" ekibine bağlı ' + parts.join(" ve ") + ' var. Silmeden önce bunlar seçtiğiniz ekibe aktarılacak.',
    confirmLabel: "Aktar ve sil", danger: true,
    select: { label: "Aktarılacak ekip", options: others, value: others[0].id },
    onConfirm: remove
  });
}

export function addProject(){
  var inp = $("newProjectName"), name = inp.value.trim();
  if(!name){ inp.focus(); return; }
  var color = nextColor(state.projects.map(function(p){ return p.color; }));
  state.projects.push(normalizeProject({ id: uid(), name: name, color: color, status: "aktif" }));
  inp.value = ""; commit(["projects"], '"' + name + '" projesi eklendi'); inp.focus();
}
export function renameProject(id, name){
  var p = getProject(id); name = name.trim();
  if(!p || !name || name === p.name){ renderProjectManage(); return; }
  p.name = name; commit(["projects"], "Proje adı güncellendi");
}
export function recolorProject(id, color){
  var p = getProject(id); if(!p) return;
  p.color = color; commit(["projects"], "Proje rengi güncellendi");
}
export function toggleProject(id){
  var p = getProject(id); if(!p) return;
  p.status = p.status === "aktif" ? "arsivlenmis" : "aktif";
  commit(["projects"], '"' + p.name + '" ' + (p.status === "aktif" ? "tekrar aktifleştirildi" : "arşivlendi"));
}
/* İşler seçilen projeye ya da "Projesiz"e aktarılır. Proje notları bir projeye ait olmak zorunda:
   başka bir proje seçilirse oraya taşınır, "Projesiz" seçilirse (ekleriyle birlikte) silinir. */
export function deleteProject(id){
  var p = getProject(id); if(!p) return;
  var n = projectTaskCount(id), nn = notesOfProject(id).length;
  var remove = function(target){
    if(n) allTasks().forEach(function(t){ if(t.projectId === id) t.projectId = target || ""; });
    if(nn){
      if(target) state.projectNotes.forEach(function(x){ if(x.projectId === id) x.projectId = target; });
      else state.projectNotes = state.projectNotes.filter(function(x){ return x.projectId !== id; });
    }
    state.projects = state.projects.filter(function(x){ return x.id !== id; });
    if(state.filterProject === id) state.filterProject = "all";
    if(state.projectView === id) state.projectView = target || null;
    var kinds = (n ? ["tasks", "archive"] : []).concat(nn ? ["projectNotes"] : []).concat(["projects"]);
    commit(kinds, "Proje silindi" + (n ? ", " + n + " iş aktarıldı" : "") + (nn ? ", " + nn + " not " + (target ? "taşındı" : "silindi") : ""));
  };
  if(!n && !nn) return showConfirm({ title: "Projeyi sil", message: '"' + p.name + '" kalıcı olarak silinecek.', confirmLabel: "Sil", danger: true, onConfirm: remove });
  var parts = [];
  if(n) parts.push(n + " iş (aktif + arşiv)");
  if(nn) parts.push(nn + " proje notu");
  showConfirm({
    title: "Projeyi sil",
    message: '"' + p.name + '" projesine bağlı ' + parts.join(" ve ") + ' var. Silmeden önce bunlar seçtiğiniz projeye aktarılacak.' +
      (nn ? ' "Projesiz" seçerseniz işler projesiz kalır, proje notları ise ekleriyle birlikte SİLİNİR.' : ""),
    confirmLabel: "Aktar ve sil", danger: true,
    select: { label: "Aktarılacak proje", value: nn ? ((sortedProjects().filter(function(x){ return x.id !== id; })[0] || {}).id || "") : "",
      options: [{ id: "", name: nn ? "Projesiz (notlar silinir)" : "Projesiz" }].concat(sortedProjects().filter(function(x){ return x.id !== id; })) },
    onConfirm: remove
  });
}

/* Olay bağlama (main.js → bind) */
export function bindSettings(){
  /* Ayarlar: sorumlular */
  $("btnAddUnit").onclick = addUnit;
  $("newUnitName").onkeydown = function(e){ if(e.key === "Enter"){ e.preventDefault(); addUnit(); } };
  var ul = $("unitManageList");
  ul.onchange = function(e){ var i = e.target.closest("[data-urename]"); if(i) renameUnit(i.getAttribute("data-urename"), i.value); };
  ul.onkeydown = function(e){ if(e.key === "Enter" && e.target.matches("[data-urename]")) e.target.blur(); };
  ul.onclick = function(e){
    var s = e.target.closest("[data-uswatch]"), m = e.target.closest("[data-umove]"), d = e.target.closest("[data-udel]");
    if(s) recolorUnit(s.getAttribute("data-uswatch"), s.getAttribute("data-color"));
    else if(m) moveUnit(m.getAttribute("data-umove"), +m.getAttribute("data-dir"));
    else if(d) deleteUnit(d.getAttribute("data-udel"));
  };

  /* Ayarlar: projeler */
  $("btnAddProject").onclick = addProject;
  $("newProjectName").onkeydown = function(e){ if(e.key === "Enter"){ e.preventDefault(); addProject(); } };
  var pl = $("projectManageList");
  pl.onchange = function(e){ var i = e.target.closest("[data-rename]"); if(i) renameProject(i.getAttribute("data-rename"), i.value); };
  pl.onkeydown = function(e){ if(e.key === "Enter" && e.target.matches("[data-rename]")) e.target.blur(); };
  pl.onclick = function(e){
    var s = e.target.closest("[data-swatch]"), t = e.target.closest("[data-toggle]"), d = e.target.closest("[data-pdel]");
    if(s) recolorProject(s.getAttribute("data-swatch"), s.getAttribute("data-color"));
    else if(t) toggleProject(t.getAttribute("data-toggle"));
    else if(d) deleteProject(d.getAttribute("data-pdel"));
  };

  /* Ayarlar: renk paleti aç/kapa (dışarı tıklayınca kapanır) */
  document.addEventListener("click", function(e){
    var dot = e.target.closest("[data-colorpop]");
    var pop = dot ? dot.parentNode : null;
    closeColorPops(pop);
    if(pop) pop.classList.toggle("open");
  });

}
