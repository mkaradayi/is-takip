/* Proje notu penceresi */
import { RichEditor } from "../components/editor.js";
import { ICON, MAX_UPLOAD } from "../core/config.js";
import { findProjectNote, normalizeAttachment, normalizeProjectNote, safeId, state } from "../core/state.js";
import { Storage, commit } from "../core/storage.js";
import { bindBackdropClose, showConfirm, toast } from "../core/ui.js";
import { $, esc, fmtSize, uid } from "../core/utils.js";
import { uploadImage } from "./task-modal.js";
import { memoTime } from "../views/memos.js";

export var pnEditor = null;

/* Proje notu penceresi */
export function pnSnapshot(){
  return JSON.stringify([$("pnTitle").value, pnEditor.getHtml(), $("pnProject").value, state.pnAttachments.map(function(a){ return a.id || a.name; })]);
}
export function openProjectNote(id, projectId){
  var n = id ? findProjectNote(id) : null;
  state.pnEditingId = n ? n.id : null;
  state.pnProjectId = n ? n.projectId : projectId;
  $("pnModalTitle").textContent = n ? "Notu düzenle" : "Yeni proje notu";
  $("pnModalSub").textContent = n ? "Oluşturuldu: " + memoTime(n.createdAt) + (n.updatedAt !== n.createdAt ? " · Güncellendi: " + memoTime(n.updatedAt) : "") : "";
  $("pnTitle").value = n ? n.title : "";
  pnEditor.setHtml(n ? n.html : "");
  var cur = state.pnProjectId;
  $("pnProject").innerHTML = state.projects.filter(function(p){ return p.status === "aktif" || p.id === cur; })
    .sort(function(a, b){ return a.name.localeCompare(b.name, "tr"); })
    .map(function(p){ return '<option value="' + p.id + '">' + esc(p.name) + '</option>'; }).join("");
  $("pnProject").value = cur;
  state.pnAttachments = n ? n.attachments.slice() : [];
  renderPnAttachments();
  $("btnPnDelete").style.display = n ? "" : "none";
  $("pnOverlay").classList.add("show");
  state.pnBase = pnSnapshot();
  $("pnTitle").focus();
}
export function closeProjectNote(){ $("pnOverlay").classList.remove("show"); state.pnEditingId = null; state.pnBase = null; }
export function requestCloseProjectNote(){
  if(!state.pnBase || pnSnapshot() === state.pnBase) return closeProjectNote();
  showConfirm({ title: "Kaydedilmemiş değişiklikler", message: "Bu notta kaydetmediğiniz değişiklikler var. Kaydetmeden kapatırsanız kaybolacak.",
    confirmLabel: "Kaydetmeden kapat", cancelLabel: "Düzenlemeye dön", danger: true, onConfirm: closeProjectNote });
}
export function renderPnAttachments(){
  $("pnAttList").innerHTML = state.pnAttachments.map(function(a, i){
    var name = esc(a.name);
    return '<div class="att-item' + (a.uploading ? " uploading" : "") + '">' + ICON.file +
      (a.uploading ? '<span class="att-name">' + name + '</span><span class="att-size">yükleniyor…</span>'
        : '<a class="att-name" href="/api/attachments/' + a.id + '" target="_blank" rel="noopener" title="Aç / indir">' + name + '</a><span class="att-size">' + fmtSize(a.size) + '</span>' +
          '<button type="button" class="att-del" data-pnatt-del="' + i + '" title="Eki kaldır" aria-label="Eki kaldır">' + ICON.x + '</button>') + '</div>';
  }).join("");
}
export function pnAddFiles(files){
  Array.prototype.forEach.call(files, function(f){
    if(f.size > MAX_UPLOAD){ toast('"' + f.name + '" çok büyük (en fazla 25 MB)', true); return; }
    var ph = { uploading: true, name: f.name, size: f.size };
    state.pnAttachments.push(ph); state.uploading++; renderPnAttachments();
    Storage.upload(f).then(function(meta){
      var i = state.pnAttachments.indexOf(ph);
      if(i !== -1) state.pnAttachments[i] = normalizeAttachment(meta);
    }, function(e){
      state.pnAttachments = state.pnAttachments.filter(function(x){ return x !== ph; });
      toast('"' + f.name + '" yüklenemedi: ' + e.message, true);
    }).then(function(){ state.uploading--; renderPnAttachments(); });
  });
}
export function saveProjectNote(){
  if(state.uploading > 0){ toast("Ekler yükleniyor, lütfen bitmesini bekleyin", true); return; }
  var html = pnEditor.getHtml(), text = RichEditor.toPlain(html), title = $("pnTitle").value.trim();
  var atts = state.pnAttachments.filter(function(a){ return a && !a.uploading; });
  if(!title && !text.trim() && !atts.length){ toast("Not boş — başlık, metin ya da dosya ekleyin", true); $("pnTitle").focus(); return; }
  if(!title) title = (text.trim().split("\n")[0] || (atts[0] && atts[0].name) || "Adsız not").slice(0, 80);
  var projectId = safeId($("pnProject").value) || state.pnProjectId;
  var now = new Date().toISOString(), n = state.pnEditingId ? findProjectNote(state.pnEditingId) : null, isNew = !n;
  if(isNew){ n = normalizeProjectNote({ id: uid(), createdAt: now }); state.projectNotes.push(n); }
  Object.assign(n, { projectId: projectId, title: title.slice(0, 200), html: html, text: text, attachments: atts, updatedAt: now });
  if(projectId !== state.projectView && state.view === "projects") state.projectView = projectId;   // başka projeye taşındıysa onu göster
  closeProjectNote();
  commit(["projectNotes"], isNew ? "Proje notu eklendi" : "Proje notu güncellendi");
}
export function deleteProjectNote(){
  var n = state.pnEditingId ? findProjectNote(state.pnEditingId) : null; if(!n) return;
  showConfirm({ title: "Notu sil", message: '"' + (n.title || "Adsız not") + '" ve ' + (n.attachments.length ? n.attachments.length + " eki " : "") + "kalıcı olarak silinecek.",
    confirmLabel: "Sil", danger: true,
    onConfirm: function(){
      state.projectNotes = state.projectNotes.filter(function(x){ return x.id !== n.id; });
      closeProjectNote();
      commit(["projectNotes"], "Proje notu silindi");
    }
  });
}

/* ---------- Ayarlar ---------- */

/* Olay bağlama (main.js → bind) */
export function bindProjectNoteModal(){
  /* Proje notu penceresi */
  pnEditor = RichEditor.create($("pnEditor"), {
    placeholder: "Toplantı notu, karar, yazışma özeti… (resim yapıştırabilirsiniz)",
    onImage: uploadImage,
    onAttach: function(){ $("pnAttInput").click(); },
    onFiles: pnAddFiles
  });
  $("pnAttInput").onchange = function(e){ pnAddFiles(e.target.files); e.target.value = ""; };
  $("pnAttList").onclick = function(e){
    var b = e.target.closest("[data-pnatt-del]"); if(!b) return;
    state.pnAttachments.splice(+b.getAttribute("data-pnatt-del"), 1); renderPnAttachments();
  };
  $("btnPnSave").onclick = saveProjectNote;
  $("btnPnCancel").onclick = requestCloseProjectNote;
  $("pnClose").onclick = requestCloseProjectNote;
  $("btnPnDelete").onclick = deleteProjectNote;
  bindBackdropClose($("pnOverlay"), requestCloseProjectNote);
}
