/* İş penceresi: form, editör, durum notları, ekler, kaydetme */
import { RichEditor } from "../components/editor.js";
import { MultiSelect } from "../components/multi-select.js";
import { ICON, MAX_UPLOAD, PRIORITIES, STATUSES } from "../core/config.js";
import { needsDates } from "../core/domain.js";
import { defaultUnitId, findTask, fixAssignees, normalizeAttachment, normalizeTask, state } from "../core/state.js";
import { Storage, commit } from "../core/storage.js";
import { bindBackdropClose, bindDateField, openPicker, showConfirm, toast } from "../core/ui.js";
import { $, esc, fmtDate, fmtSize, initials, isoToTR, relLabel, todayISO, trToISO, uid } from "../core/utils.js";
import { mailTasks } from "../features/mail.js";
import { deleteTask } from "../features/task-actions.js";
import { memoTime, taskMemos } from "../views/memos.js";
import { remGroup, remWhen, taskReminders } from "../views/reminders.js";

export var editor = null;
/* Sorumlular seçicisi: değerler "u:<ekip id>" ve "m:<çalışan id>" */
export var assigneeSelect = null;
export function assigneeOptions(){
  var cur = assigneeSelect ? assigneeSelect.get() : [], out = [];
  state.units.forEach(function(u){
    var active = u.members.filter(function(m){ return m.active; }).length;
    out.push({ value: "u:" + u.id, label: u.name, color: u.color, hint: active ? active + " çalışan" : "" });
    u.members.forEach(function(m){
      if(!m.active && cur.indexOf("m:" + m.id) === -1) return;   // pasif çalışan yalnızca zaten atanmışsa görünür
      out.push({ value: "m:" + m.id, label: m.name, color: u.color, parent: "u:" + u.id, avatar: initials(m.name), hint: m.active ? "" : "pasif" });
    });
  });
  cur.forEach(function(v){   // silinmiş ekip/çalışan: seçim kaybolmasın, çip olarak görünsün
    if(!out.some(function(x){ return x.value === v; })) out.push({ value: v, label: v.charAt(0) === "u" ? "(silinmiş ekip)" : "(silinmiş çalışan)", hidden: true });
  });
  return out;
}
/* Proje seçicisi (tekli): "" = Projesiz; arşivlenmiş proje yalnızca işin mevcut projesiyse listelenir */
export var projectSelect = null;
export function projectOptions(){
  var cur = projectSelect ? projectSelect.get()[0] || "" : "";
  var out = [{ value: "", label: "Projesiz", color: "#9AA1AD" }];
  state.projects.filter(function(p){ return p.status === "aktif" || p.id === cur; })
    .sort(function(a, b){ return a.name.localeCompare(b.name, "tr"); })
    .forEach(function(p){ out.push({ value: p.id, label: p.name, color: p.color, hint: p.status === "arsivlenmis" ? "arşivde" : "" }); });
  if(cur && !out.some(function(x){ return x.value === cur; })) out.push({ value: cur, label: "(silinmiş proje)", hidden: true });
  return out;
}
export function assigneeValues(t){
  return t.units.map(function(id){ return "u:" + id; }).concat(t.members.map(function(id){ return "m:" + id; }));
}
export function readAssignees(){
  var v = assigneeSelect.get();
  return {
    units: v.filter(function(x){ return x.indexOf("u:") === 0; }).map(function(x){ return x.slice(2); }),
    members: v.filter(function(x){ return x.indexOf("m:") === 0; }).map(function(x){ return x.slice(2); })
  };
}

export function buildSeg(id, options, current){
  var el = $(id);
  el.dataset.value = current;
  el.innerHTML = options.map(function(o){
    var on = o.id === current;
    return '<button type="button" class="seg-opt ' + (on ? "active" : "") + '" data-val="' + o.id + '" style="' + (on ? "background:" + o.color + ";" : "") + '">' + esc(o.name) + '</button>';
  }).join("");
  el.onclick = function(e){
    var b = e.target.closest(".seg-opt"); if(!b) return;
    var val = b.getAttribute("data-val");
    el.dataset.value = val;
    Array.prototype.forEach.call(el.querySelectorAll(".seg-opt"), function(x){ x.classList.remove("active"); x.style.background = ""; });
    b.classList.add("active");
    b.style.background = options.filter(function(o){ return o.id === val; })[0].color;
  };
}
export function updateDateMode(status){
  var req = needsDates(status);
  $("lblStart").innerHTML = "Başlangıç Tarihi" + (req ? ' <span class="req-mark">*</span>' : ' <span class="opt-mark">(opsiyonel)</span>');
  $("lblDue").innerHTML = "Bitiş / Termin Tarihi" + (req ? ' <span class="req-mark">*</span>' : ' <span class="opt-mark">(opsiyonel)</span>');
  $("backlogHint").style.display = req ? "none" : "flex";
}
export function renderNotes(){
  var el = $("notesList");
  var notes = state.modalNotes.slice().sort(function(a, b){ return (b.createdAt || "").localeCompare(a.createdAt || ""); });
  if(!notes.length){ el.innerHTML = '<div class="note-empty">Henüz not eklenmedi.</div>'; return; }
  el.innerHTML = notes.map(function(n){
    return '<div class="note-item"><button type="button" class="note-del" data-note-del="' + n.id + '">' + ICON.x + '</button>' +
      '<span class="note-date">' + relLabel(n.date) + '</span>' + esc(n.text) + '</div>';
  }).join("");
}
export function renderAttachments(){
  var el = $("attList");
  el.innerHTML = state.modalAttachments.map(function(a, i){
    var name = esc(a.name);
    return '<div class="att-item' + (a.uploading ? " uploading" : "") + '">' + ICON.file +
      (a.uploading ? '<span class="att-name">' + name + '</span><span class="att-size">yükleniyor…</span>'
        : '<a class="att-name" href="/api/attachments/' + a.id + '" target="_blank" rel="noopener" title="Aç / indir">' + name + '</a><span class="att-size">' + fmtSize(a.size) + '</span>' +
          '<button type="button" class="att-del" data-att-del="' + i + '" title="Eki kaldır" aria-label="Eki kaldır">' + ICON.x + '</button>') +
      '</div>';
  }).join("");
}
export function addFiles(files){
  Array.prototype.forEach.call(files, function(f){
    if(f.size > MAX_UPLOAD){ toast('"' + f.name + '" çok büyük (en fazla 25 MB)', true); return; }
    var ph = { uploading: true, name: f.name, size: f.size };
    state.modalAttachments.push(ph); state.uploading++; renderAttachments();
    Storage.upload(f).then(function(meta){
      var i = state.modalAttachments.indexOf(ph);
      if(i !== -1) state.modalAttachments[i] = normalizeAttachment(meta);
    }, function(e){
      state.modalAttachments = state.modalAttachments.filter(function(x){ return x !== ph; });
      toast('"' + f.name + '" yüklenemedi: ' + e.message, true);
    }).then(function(){ state.uploading--; renderAttachments(); });
  });
}
/* Editöre yapıştırılan/sürüklenen resim: ek olarak yüklenir, satır içi <img> için adres döner */
export function uploadImage(file){
  if(file.size > MAX_UPLOAD){ toast("Resim çok büyük (en fazla 25 MB)", true); return Promise.resolve(null); }
  state.uploading++;
  return Storage.upload(file).then(function(meta){ return "/api/attachments/" + meta.id; }, function(e){
    toast("Resim yüklenemedi: " + e.message, true); return null;
  }).then(function(src){ state.uploading--; return src; });
}

export function openModal(id){
  var t = id ? findTask(id) : null;
  state.editingId = t ? t.id : null;
  var status = t ? (state.pendingStatus || t.status) : "backlog";
  state.pendingStatus = null;
  $("modalTitle").textContent = t ? "İşi Düzenle" : "Yeni İş";
  $("modalEntryDate").textContent = t ? "Sisteme giriş: " + fmtDate(t.createdAt) : "Kaydedilince sisteme giriş tarihi otomatik atanacak";
  $("fTitle").value = t ? t.title : "";
  editor.setHtml(t ? t.descriptionHtml : "");
  $("fStart").value = t ? isoToTR(t.startDate) : "";
  $("fDue").value = t ? isoToTR(t.dueDate) : "";
  assigneeSelect.set(t ? assigneeValues(t) : ["u:" + defaultUnitId()]);
  buildSeg("fPrioSeg", PRIORITIES, t ? t.priority : "orta");

  projectSelect.set([t ? t.projectId : ""]);

  $("fStatus").innerHTML = STATUSES.map(function(s){ return '<option value="' + s.id + '">' + s.name + '</option>'; }).join("");
  $("fStatus").value = status;
  updateDateMode(status);

  state.modalNotes = t ? t.notes.slice() : [];
  state.modalAttachments = t ? t.attachments.slice() : [];
  $("fNoteInput").value = "";
  renderNotes(); renderAttachments();
  /* Bu işe bağlı hatırlatmalar ve kişisel notlar (yalnızca kayıtlı işlerde) */
  $("fRemField").style.display = t ? "" : "none";
  if(t){
    var rs = taskReminders(t.id), ms = taskMemos(t.id).sort(function(a, b){ return b.updatedAt.localeCompare(a.updatedAt); });
    $("modalRemList").innerHTML = (rs.length || ms.length) ? rs.map(function(r){
      return '<div class="modal-rem rem-' + remGroup(r) + '">' + ICON.bell + '<span class="modal-rem-text">' + esc(r.text.split("\n")[0]) + '</span><span class="modal-rem-when">' + esc(remWhen(r)) + '</span></div>';
    }).join("") + ms.map(function(m){
      return '<div class="modal-rem memo">' + ICON.note + '<span class="modal-rem-text">' + esc(m.text.split("\n")[0]) + '</span><span class="modal-rem-when">' + esc(memoTime(m.updatedAt)) + '</span></div>';
    }).join("") : '<div class="note-empty">Bu işe bağlı hatırlatma ya da not yok.</div>';
  }
  $("btnDeleteTask").style.display = t ? "inline-flex" : "none";
  $("btnMailTask").style.display = t ? "inline-flex" : "none";
  $("overlay").classList.add("show");
  state.modalBase = modalSnapshot();
  $("fTitle").focus();
}
export function closeModal(){ assigneeSelect.close(); projectSelect.close(); $("overlay").classList.remove("show"); state.editingId = null; state.pendingStatus = null; state.modalBase = null; }
/* Formun o anki hali; açılıştaki halden farklıysa kapatmadan önce sorulur */
export function modalSnapshot(){
  return JSON.stringify([
    $("fTitle").value, editor.getHtml(), $("fStart").value, $("fDue").value,
    assigneeSelect.get().slice().sort().join(","), $("fPrioSeg").dataset.value, projectSelect.get()[0] || "", $("fStatus").value,
    state.modalNotes.map(function(n){ return n.id; }),
    state.modalAttachments.map(function(a){ return a.id || a.name; }),
    $("fNoteInput").value.trim()
  ]);
}
export function modalDirty(){ return !!state.modalBase && modalSnapshot() !== state.modalBase; }
/* Arka plan, Esc, İptal ve X buradan geçer; kaydedilmemiş değişiklik varsa onay ister */
export function requestCloseModal(){
  if(!modalDirty()) return closeModal();
  showConfirm({
    title: "Kaydedilmemiş değişiklikler",
    message: "Bu pencerede kaydetmediğiniz değişiklikler var. Kaydetmeden kapatırsanız kaybolacak.",
    confirmLabel: "Kaydetmeden kapat", cancelLabel: "Düzenlemeye dön", danger: true,
    onConfirm: closeModal
  });
}

export function addNote(){
  var inp = $("fNoteInput"), text = inp.value.trim();
  if(!text) return;
  state.modalNotes.push({ id: uid(), text: text, date: todayISO(), createdAt: new Date().toISOString() });
  inp.value = ""; renderNotes();
}

/* Kaydedilen işi döndürür; doğrulama başarısızsa null */
export function saveTask(){
  var title = $("fTitle").value.trim();
  if(!title){ toast("Lütfen bir başlık girin", true); $("fTitle").focus(); return null; }
  if(state.uploading > 0){ toast("Ekler yükleniyor, lütfen bitmesini bekleyin", true); return null; }
  var startTxt = $("fStart").value.trim(), dueTxt = $("fDue").value.trim();
  var start = trToISO(startTxt), due = trToISO(dueTxt);
  if(startTxt && !start){ toast("Başlangıç tarihi geçersiz — gg.aa.yyyy biçiminde girin", true); $("fStart").focus(); return null; }
  if(dueTxt && !due){ toast("Bitiş tarihi geçersiz — gg.aa.yyyy biçiminde girin", true); $("fDue").focus(); return null; }
  var status = $("fStatus").value;
  if(needsDates(status) && (!start || !due)){
    toast("Beklemede, Devam Ediyor ve Tamamlandı durumları için başlangıç ve bitiş tarihi zorunludur", true);
    (!start ? $("fStart") : $("fDue")).focus(); return null;
  }
  if(start && due && due < start){ toast("Bitiş tarihi başlangıç tarihinden önce olamaz", true); $("fDue").focus(); return null; }
  var picked = readAssignees();
  if(!picked.units.length && !picked.members.length){ toast("En az bir sorumlu ekip seçin", true); $("fAssignees").querySelector(".ms-control").focus(); return null; }
  var asg = fixAssignees(picked.units, picked.members);
  addNote();   // not kutusuna yazılıp "Ekle"ye basılmamış metin kaybolmasın

  var html = editor.getHtml();
  var fields = {
    title: title, descriptionHtml: html, description: RichEditor.toPlain(html),
    units: asg.units, members: asg.members, priority: $("fPrioSeg").dataset.value,
    projectId: projectSelect.get()[0] || "", status: status, startDate: start, dueDate: due,
    notes: state.modalNotes.slice(),
    attachments: state.modalAttachments.filter(function(a){ return a && !a.uploading; }),
    updatedAt: todayISO()
  };
  var isNew = !state.editingId, t;
  if(isNew){ t = normalizeTask(Object.assign({ id: uid(), createdAt: todayISO() }, fields)); state.tasks.push(t); }
  else { t = findTask(state.editingId); Object.assign(t, fields); }
  closeModal();
  commit(["tasks"], isNew ? "İş oluşturuldu" : "İş güncellendi");
  return t;
}

/* Olay bağlama (main.js → bind) */
export function bindTaskModal(){
  assigneeSelect = MultiSelect.create($("fAssignees"), {
    multiple: true, linkParents: true, options: assigneeOptions,
    placeholder: "Ekip veya çalışan seçin…", searchPlaceholder: "Ekip ya da çalışan ara…", emptyText: "Eşleşen ekip ya da çalışan yok"
  });
  projectSelect = MultiSelect.create($("fProject"), {
    multiple: false, options: projectOptions,
    placeholder: "Projesiz", searchPlaceholder: "Proje ara…", emptyText: "Eşleşen proje yok"
  });
  editor = RichEditor.create($("fDescEditor"), {
    onImage: uploadImage,
    onAttach: function(){ $("attInput").click(); },
    onFiles: addFiles
  });

  /* İş modalı */
  $("modalClose").onclick = requestCloseModal;
  $("btnCancel").onclick = requestCloseModal;
  $("btnSaveTask").onclick = function(){ saveTask(); };
  $("btnMailTask").onclick = function(){ var t = saveTask(); if(t) mailTasks([t]); };
  $("btnDeleteTask").onclick = function(){ if(state.editingId) deleteTask(state.editingId); };
  $("btnAddNote").onclick = addNote;
  $("fNoteInput").onkeydown = function(e){ if(e.key === "Enter" && !e.shiftKey){ e.preventDefault(); addNote(); } };
  $("notesList").onclick = function(e){
    var b = e.target.closest("[data-note-del]"); if(!b) return;
    var id = b.getAttribute("data-note-del");
    state.modalNotes = state.modalNotes.filter(function(n){ return n.id !== id; }); renderNotes();
  };
  $("attInput").onchange = function(e){ if(e.target.files.length) addFiles(e.target.files); e.target.value = ""; };
  $("attList").onclick = function(e){
    var b = e.target.closest("[data-att-del]"); if(!b) return;
    state.modalAttachments.splice(+b.getAttribute("data-att-del"), 1); renderAttachments();
  };
  $("fStatus").onchange = function(e){ updateDateMode(e.target.value); };
  bindDateField("fStart"); bindDateField("fDue");
  Array.prototype.forEach.call(document.querySelectorAll(".date-pick"), function(b){
    b.onclick = function(){ openPicker(b.getAttribute("data-pick")); };
  });
  bindBackdropClose($("overlay"), requestCloseModal);
}
