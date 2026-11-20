/* Ayarlar: ekipler ve çalışanlar, projeler (görünüm + eylemler) */
import { ICON, PROJECT_COLORS } from "../core/config.js";
import { allTasks, memberTaskCount, projectTaskCount, searchKey, unitTaskCount } from "../core/domain.js";
import { UNIT_MAP, getProject, normEmail, normalizeProject, normalizeUnit, notesOfProject, setUnits, state } from "../core/state.js";
import { commit } from "../core/storage.js";
import { showConfirm, showInfo, toast } from "../core/ui.js";
import { $, esc, initials, uid } from "../core/utils.js";
import { openProject } from "./projects.js";
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
/* Ayarlar arayüz durumu (bellekte): arama, açık ekipler, proje süzgeci ve sıralaması */
var ui = { unitQ: "", openUnits: {}, projQ: "", projStatus: "all", projSort: "name" };
function pill(text, cls){ return '<span class="st-pill' + (cls ? " " + cls : "") + '">' + text + '</span>'; }

/* Mail adresi alanı (boş bırakılabilir). Değer normEmail'den geçmiş olsa da esc() ile basılır. */
function emailInput(attr, id, value, label){
  return '<input type="email" class="st-email" ' + attr + '="' + id + '" value="' + esc(value || "") + '" maxlength="254" placeholder="Mail adresi" ' +
    'autocomplete="off" spellcheck="false" aria-label="' + label + '" title="' + label + ' (boş bırakılabilir)" />';
}
function memberRow(u, m){
  var n = memberTaskCount(m.id);
  return '<div class="st-member' + (m.active ? "" : " inactive") + '">' +
    '<span class="ms-avatar" style="background:' + u.color + ';">' + esc(initials(m.name)) + '</span>' +
    '<input type="text" class="st-name" value="' + esc(m.name) + '" data-mrename="' + m.id + '" maxlength="80" aria-label="Çalışan adı" />' +
    emailInput("data-memail", m.id, m.email, "Çalışanın mail adresi") +
    '<span class="st-meta">' + pill(n + " iş") + '</span>' +
    '<select class="st-select st-move" data-mmove="' + m.id + '" title="Ekibini değiştir" aria-label="Ekibini değiştir">' +
      state.units.map(function(x){ return '<option value="' + x.id + '"' + (x.id === u.id ? " selected" : "") + '>' + esc(x.name) + '</option>'; }).join("") + '</select>' +
    '<button type="button" class="st-switch' + (m.active ? " on" : "") + '" data-mactive="' + m.id + '" aria-pressed="' + m.active + '" title="' + (m.active ? "Pasif yap: yeni atamalarda listelenmez" : "Aktif yap") + '">' +
      '<span class="st-switch-knob"></span>' + (m.active ? "Aktif" : "Pasif") + '</button>' +
    '<div class="project-manage-actions"><button type="button" data-mdel="' + m.id + '" title="Çalışanı sil">' + ICON.trash + '</button></div></div>';
}
export function renderUnitManage(){
  var q = searchKey(ui.unitQ.trim()), last = state.units.length - 1, html = "", shown = 0;
  var memberTotal = 0, passive = 0;
  state.units.forEach(function(u){ memberTotal += u.members.length; passive += u.members.filter(function(m){ return !m.active; }).length; });
  $("unitStats").innerHTML = pill(state.units.length + " ekip") + pill(memberTotal + " çalışan") + (passive ? pill(passive + " pasif", "muted") : "");
  state.units.forEach(function(u, i){
    var unitHit = !q || searchKey(u.name).indexOf(q) !== -1 || searchKey(u.email).indexOf(q) !== -1;
    var hits = q ? u.members.filter(function(m){ return searchKey(m.name).indexOf(q) !== -1 || searchKey(m.email).indexOf(q) !== -1; }) : u.members;
    if(q && !unitHit && !hits.length) return;
    shown++;
    var open = !!ui.openUnits[u.id] || (q && !unitHit && hits.length > 0);
    var members = q && !unitHit ? hits : u.members;
    html += '<div class="st-unit' + (open ? " open" : "") + '">' +
      '<div class="st-row">' +
        '<button type="button" class="st-caret" data-uopen="' + u.id + '" aria-expanded="' + open + '" title="' + (open ? "Çalışanları gizle" : "Çalışanları göster") + '">' + ICON.chevron + '</button>' +
        swatches("data-uswatch", u.id, u.color) +
        '<input type="text" class="st-name st-unit-name" value="' + esc(u.name) + '" data-urename="' + u.id + '" maxlength="80" aria-label="Ekip adı" />' +
        emailInput("data-uemail", u.id, u.email, "Ekibin mail adresi") +
        '<span class="st-meta">' + pill(u.members.length + " çalışan") + pill(unitTaskCount(u.id) + " iş") + '</span>' +
        '<div class="project-manage-actions">' +
          '<button type="button" data-umove="' + u.id + '" data-dir="-1" title="Yukarı taşı"' + (i === 0 || q ? " disabled" : "") + '>' + ICON.up + '</button>' +
          '<button type="button" data-umove="' + u.id + '" data-dir="1" title="Aşağı taşı"' + (i === last || q ? " disabled" : "") + '>' + ICON.down + '</button>' +
          '<button type="button" data-udel="' + u.id + '" title="Ekibi sil">' + ICON.trash + '</button></div>' +
      '</div>' +
      (open ? '<div class="st-members">' + (members.length ? members.map(function(m){ return memberRow(u, m); }).join("") : '<div class="st-members-empty">Bu ekipte henüz çalışan yok.</div>') +
        (q ? "" : '<div class="st-add-member"><input type="text" data-newmember="' + u.id + '" placeholder="Yeni çalışan adı" maxlength="80" aria-label="' + esc(u.name) + ' ekibine çalışan ekle" />' +
          '<button type="button" class="btn btn-sm" data-addmember="' + u.id + '">Çalışan ekle</button></div>') + '</div>' : "") +
    '</div>';
  });
  $("unitManageList").innerHTML = html;
  $("unitManageEmpty").style.display = shown ? "none" : "block";
}
export function renderProjectManage(){
  var list = $("projectManageList"), empty = $("projectManageEmpty");
  var active = state.projects.filter(function(p){ return p.status === "aktif"; }).length;
  $("projectStats").innerHTML = pill(state.projects.length + " proje") + pill(active + " aktif") + (state.projects.length - active ? pill((state.projects.length - active) + " arşivde", "muted") : "");
  Array.prototype.forEach.call($("projectStatusFilter").children, function(b){ b.classList.toggle("active", b.getAttribute("data-pstatus") === ui.projStatus); });
  var q = searchKey(ui.projQ.trim());
  var items = sortedProjects().filter(function(p){
    return (ui.projStatus === "all" || p.status === ui.projStatus) && (!q || searchKey(p.name).indexOf(q) !== -1);
  }).map(function(p){ return { p: p, tasks: projectTaskCount(p.id), notes: notesOfProject(p.id).length }; });
  if(ui.projSort !== "name") items.sort(function(a, b){ return (b[ui.projSort] - a[ui.projSort]) || a.p.name.localeCompare(b.p.name, "tr"); });
  if(!items.length){
    list.innerHTML = ""; empty.style.display = "block";
    empty.textContent = state.projects.length ? "Bu süzgece uyan proje yok." : "Henüz proje eklenmedi.";
    return;
  }
  empty.style.display = "none";
  list.innerHTML = items.map(function(x){
    var p = x.p, arch = p.status === "arsivlenmis";
    return '<div class="st-row st-project' + (arch ? " archived" : "") + '">' + swatches("data-swatch", p.id, p.color) +
      '<input type="text" class="st-name" value="' + esc(p.name) + '" data-rename="' + p.id + '" maxlength="80" aria-label="Proje adı" />' +
      '<span class="st-meta">' + pill(x.tasks + " iş") + pill(x.notes + " not") + pill(arch ? "Arşivde" : "Aktif", arch ? "muted" : "ok") + '</span>' +
      '<div class="project-manage-actions">' +
        '<button type="button" data-popen="' + p.id + '" title="Proje sayfasını aç">' + ICON.folder + '</button>' +
        '<button type="button" data-toggle="' + p.id + '" title="' + (arch ? "Aktif et" : "Arşivle") + '">' + (arch ? ICON.restore : ICON.archive) + '</button>' +
        '<button type="button" data-pdel="' + p.id + '" title="Kalıcı sil">' + ICON.trash + '</button></div></div>';
  }).join("");
}

/* ---------- Çalışan eylemleri ---------- */
function memberById(id){
  for(var i = 0; i < state.units.length; i++){
    var m = state.units[i].members.filter(function(x){ return x.id === id; })[0];
    if(m) return { unit: state.units[i], member: m };
  }
  return null;
}
export function addMember(unitId){
  var u = UNIT_MAP[unitId], inp = document.querySelector('[data-newmember="' + unitId + '"]');
  if(!u || !inp) return;
  var name = inp.value.trim();
  if(!name){ inp.focus(); return; }
  if(u.members.some(function(m){ return m.name.toLocaleLowerCase("tr") === name.toLocaleLowerCase("tr"); })){
    toast('"' + u.name + '" ekibinde "' + name + '" adlı bir çalışan zaten var', true); inp.focus(); return;
  }
  u.members.push({ id: uid(), name: name.slice(0, 80), email: "", active: true });
  setUnits(state.units);
  ui.openUnits[unitId] = true;
  commit(["units"], '"' + name + '" ' + u.name + ' ekibine eklendi');
  var again = document.querySelector('[data-newmember="' + unitId + '"]'); if(again) again.focus();
}
export function renameMember(id, name){
  var r = memberById(id); name = name.trim();
  if(!r || !name || name === r.member.name){ renderUnitManage(); return; }
  r.member.name = name.slice(0, 80); setUnits(state.units);
  commit(["units"], "Çalışan adı güncellendi");
}
/* Mail adresi: boş → silinir; geçersiz → uyarı ve eski değer geri gelir; değişmediyse kayıt yok */
function applyEmail(obj, value, what){
  var raw = String(value || "").trim(), email = normEmail(raw);
  if(raw && !email){ toast('"' + raw + '" geçerli bir mail adresi değil (örnek: ad.soyad@firma.com)', true); renderUnitManage(); return; }
  if(email === (obj.email || "")){ renderUnitManage(); return; }
  obj.email = email; setUnits(state.units);
  commit(["units"], what + (email ? " mail adresi güncellendi" : " mail adresi kaldırıldı"));
}
export function setMemberEmail(id, value){
  var r = memberById(id); if(r) applyEmail(r.member, value, '"' + r.member.name + '"');
}
export function setUnitEmail(id, value){
  var u = UNIT_MAP[id]; if(u) applyEmail(u, value, '"' + u.name + '" ekibinin');
}
export function toggleMember(id){
  var r = memberById(id); if(!r) return;
  r.member.active = !r.member.active; setUnits(state.units);
  commit(["units"], '"' + r.member.name + '" ' + (r.member.active ? "aktif yapıldı" : "pasif yapıldı (işlerde kalır, yeni atamalarda listelenmez)"));
}
/* Çalışan başka ekibe taşınınca, atandığı işlere yeni ekibi de eklenir (çalışanın ekibi her zaman işin ekipleri içinde olmalı) */
export function moveMember(id, target){
  var r = memberById(id), tu = UNIT_MAP[target];
  if(!r || !tu || r.unit.id === target) return;
  r.unit.members = r.unit.members.filter(function(m){ return m.id !== id; });
  tu.members.push(r.member);
  setUnits(state.units);
  var n = 0;
  allTasks().forEach(function(t){ if(t.members.indexOf(id) !== -1 && t.units.indexOf(target) === -1){ t.units.push(target); n++; } });
  ui.openUnits[target] = true;
  commit(n ? ["units", "tasks", "archive"] : ["units"], '"' + r.member.name + '" → ' + tu.name + (n ? " (" + n + " işe ekip eklendi)" : ""));
}
export function deleteMember(id){
  var r = memberById(id); if(!r) return;
  var n = memberTaskCount(id), name = r.member.name;
  var remove = function(target){
    r.unit.members = r.unit.members.filter(function(m){ return m.id !== id; });
    var tm = target ? memberById(target) : null;
    allTasks().forEach(function(t){
      var i = t.members.indexOf(id); if(i === -1) return;
      t.members.splice(i, 1);
      if(tm){
        if(t.members.indexOf(target) === -1) t.members.push(target);
        if(t.units.indexOf(tm.unit.id) === -1) t.units.push(tm.unit.id);
      }
    });
    setUnits(state.units);
    if(state.filterMember === id) state.filterMember = "all";
    commit(n ? ["units", "tasks", "archive"] : ["units"], '"' + name + '" silindi' + (n ? (tm ? ", " + n + " iş " + tm.member.name + " adlı çalışana aktarıldı" : ", " + n + " işten kaldırıldı") : ""));
  };
  if(!n) return showConfirm({ title: "Çalışanı sil", message: '"' + name + '" silinecek.', confirmLabel: "Sil", danger: true, onConfirm: function(){ remove(""); } });
  var others = [{ id: "", name: "— Aktarma, yalnızca işlerden kaldır —" }];
  state.units.forEach(function(u){ u.members.forEach(function(m){ if(m.id !== id && m.active) others.push({ id: m.id, name: m.name + " (" + u.name + ")" }); }); });
  showConfirm({
    title: "Çalışanı sil",
    message: '"' + name + '" ' + n + ' işe (aktif + arşiv) atanmış. İşleri başka bir çalışana aktarabilir ya da yalnızca işlerden kaldırabilirsiniz; işlerin ekipleri korunur.',
    confirmLabel: "Sil", danger: true,
    select: { label: "İşlerin aktarılacağı çalışan", options: others, value: "" },
    onConfirm: remove
  });
}
export function renderSettings(){ renderUnitManage(); renderProjectManage(); }

export function nextColor(used){
  return PROJECT_COLORS.filter(function(c){ return used.indexOf(c) === -1; })[0] || PROJECT_COLORS[used.length % PROJECT_COLORS.length];
}
export function addUnit(){
  var inp = $("newUnitName"), name = inp.value.trim();
  if(!name){ inp.focus(); return; }
  if(state.units.some(function(u){ return u.name.toLocaleLowerCase("tr") === name.toLocaleLowerCase("tr"); })){
    toast('"' + name + '" adlı bir ekip zaten var', true); inp.focus(); return;
  }
  var u = normalizeUnit({ id: uid(), name: name, color: nextColor(state.units.map(function(x){ return x.color; })), order: state.units.length });
  setUnits(state.units.concat(u));
  inp.value = ""; commit(["units"], '"' + name + '" ekibi eklendi'); inp.focus();
}
export function renameUnit(id, name){
  var u = UNIT_MAP[id]; name = name.trim();
  if(!u || !name || name === u.name){ renderUnitManage(); return; }
  u.name = name; commit(["units"], "Ekip adı güncellendi");
}
export function recolorUnit(id, color){
  var u = UNIT_MAP[id]; if(!u) return;
  u.color = color; commit(["units"], "Ekip rengi güncellendi");
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
    if(state.filterMember !== "all" && u.members.some(function(m){ return m.id === state.filterMember; })) state.filterMember = "all";
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
  /* Ayarlar: ekipler ve çalışanlar */
  $("btnAddUnit").onclick = addUnit;
  $("newUnitName").onkeydown = function(e){ if(e.key === "Enter"){ e.preventDefault(); addUnit(); } };
  $("unitManageSearch").oninput = function(e){ ui.unitQ = e.target.value; renderUnitManage(); };
  var ul = $("unitManageList");
  ul.onchange = function(e){
    var i = e.target.closest("[data-urename]"), mr = e.target.closest("[data-mrename]"), mv = e.target.closest("[data-mmove]");
    var ue = e.target.closest("[data-uemail]"), me = e.target.closest("[data-memail]");
    if(ue) setUnitEmail(ue.getAttribute("data-uemail"), ue.value);
    else if(me) setMemberEmail(me.getAttribute("data-memail"), me.value);
    else if(i) renameUnit(i.getAttribute("data-urename"), i.value);
    else if(mr) renameMember(mr.getAttribute("data-mrename"), mr.value);
    else if(mv) moveMember(mv.getAttribute("data-mmove"), mv.value);
  };
  ul.onkeydown = function(e){
    if(e.key !== "Enter") return;
    if(e.target.matches("[data-urename],[data-mrename],[data-uemail],[data-memail]")) e.target.blur();
    else if(e.target.matches("[data-newmember]")){ e.preventDefault(); addMember(e.target.getAttribute("data-newmember")); }
  };
  ul.onclick = function(e){
    var s = e.target.closest("[data-uswatch]"), m = e.target.closest("[data-umove]"), d = e.target.closest("[data-udel]"), o = e.target.closest("[data-uopen]");
    var am = e.target.closest("[data-addmember]"), ma = e.target.closest("[data-mactive]"), md = e.target.closest("[data-mdel]");
    if(s) recolorUnit(s.getAttribute("data-uswatch"), s.getAttribute("data-color"));
    else if(m) moveUnit(m.getAttribute("data-umove"), +m.getAttribute("data-dir"));
    else if(d) deleteUnit(d.getAttribute("data-udel"));
    else if(o){ var id = o.getAttribute("data-uopen"); ui.openUnits[id] = !o.closest(".st-unit").classList.contains("open"); renderUnitManage(); }
    else if(am) addMember(am.getAttribute("data-addmember"));
    else if(ma) toggleMember(ma.getAttribute("data-mactive"));
    else if(md) deleteMember(md.getAttribute("data-mdel"));
  };

  /* Ayarlar: projeler */
  $("btnAddProject").onclick = addProject;
  $("newProjectName").onkeydown = function(e){ if(e.key === "Enter"){ e.preventDefault(); addProject(); } };
  $("projectManageSearch").oninput = function(e){ ui.projQ = e.target.value; renderProjectManage(); };
  $("projectStatusFilter").onclick = function(e){ var b = e.target.closest("[data-pstatus]"); if(b){ ui.projStatus = b.getAttribute("data-pstatus"); renderProjectManage(); } };
  $("projectSort").onchange = function(e){ ui.projSort = e.target.value; renderProjectManage(); };
  var pl = $("projectManageList");
  pl.onchange = function(e){ var i = e.target.closest("[data-rename]"); if(i) renameProject(i.getAttribute("data-rename"), i.value); };
  pl.onkeydown = function(e){ if(e.key === "Enter" && e.target.matches("[data-rename]")) e.target.blur(); };
  pl.onclick = function(e){
    var s = e.target.closest("[data-swatch]"), t = e.target.closest("[data-toggle]"), d = e.target.closest("[data-pdel]"), op = e.target.closest("[data-popen]");
    if(s) recolorProject(s.getAttribute("data-swatch"), s.getAttribute("data-color"));
    else if(t) toggleProject(t.getAttribute("data-toggle"));
    else if(d) deleteProject(d.getAttribute("data-pdel"));
    else if(op) openProject(op.getAttribute("data-popen"));
  };

  /* Ayarlar: renk paleti aç/kapa (dışarı tıklayınca kapanır) */
  document.addEventListener("click", function(e){
    var dot = e.target.closest("[data-colorpop]");
    var pop = dot ? dot.parentNode : null;
    closeColorPops(pop);
    if(pop) pop.classList.toggle("open");
  });

}
