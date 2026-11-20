/* Yedek: JSON dışa / içe aktarma */
import { getProject, normalizeMemo, normalizeProject, normalizeProjectNote, normalizeReminder, normalizeTask, setUnits, state, unitsFrom } from "../core/state.js";
import { commit } from "../core/storage.js";
import { showConfirm, showInfo, toast } from "../core/ui.js";
import { $, download, todayISO } from "../core/utils.js";

export function exportBackup(){
  var data = JSON.stringify({ schemaVersion: 2, exportedAt: new Date().toISOString(),
    tasks: state.tasks, projects: state.projects, archive: state.archive, units: state.units, reminders: state.reminders, memos: state.memos, projectNotes: state.projectNotes }, null, 2);
  download("is-takip-yedek-" + todayISO().replace(/-/g, "") + ".json", new Blob([data], { type: "application/json" }));
  toast("Yedek dosyası indirildi (ek dosyaları dahil değildir)");
}
export function importBackup(file){
  var r = new FileReader();
  r.onload = function(){
    var parsed;
    try{ parsed = JSON.parse(r.result); }catch(e){ return showInfo("Dosya okunamadı", "Geçerli bir JSON dosyası seçin."); }
    var tasks, projects = null, archive = null, units = null, reminders = null, memos = null, pnotes = null;
    if(Array.isArray(parsed)) tasks = parsed;                       // en eski biçim: düz iş dizisi
    else if(parsed && Array.isArray(parsed.tasks)){ tasks = parsed.tasks; projects = parsed.projects; archive = parsed.archive; units = parsed.units; reminders = parsed.reminders; memos = parsed.memos; pnotes = parsed.projectNotes; }
    else if(parsed && Array.isArray(parsed.items)) tasks = parsed.items; // data/tasks.json biçimi
    else return showInfo("Dosya okunamadı", "Bu uygulamadan alınmış bir yedek dosyası olmalı.");
    if(!tasks.every(function(t){ return t && typeof t.title === "string"; })) return showInfo("Dosya okunamadı", "İş kayıtlarında başlık bulunamadı.");
    var hasUnits = Array.isArray(units) && units.length > 0;
    var go = function(){
      var kinds = ["tasks"];
      if(hasUnits){ setUnits(unitsFrom(units)); kinds.push("units"); }
      state.tasks = tasks.map(normalizeTask);
      if(Array.isArray(projects)){ state.projects = projects.map(normalizeProject); kinds.push("projects"); }
      if(Array.isArray(archive)){ state.archive = archive.map(normalizeTask); kinds.push("archive"); }
      if(Array.isArray(reminders)){ state.reminders = reminders.map(normalizeReminder); state.remEditing = null; kinds.push("reminders"); }
      if(Array.isArray(memos)){ state.memos = memos.map(normalizeMemo); state.memoEditing = null; kinds.push("memos"); }
      if(Array.isArray(pnotes)){ state.projectNotes = pnotes.map(normalizeProjectNote); kinds.push("projectNotes"); }
      if(state.projectView && !getProject(state.projectView)) state.projectView = null;
      state.selected = {};
      commit(kinds, tasks.length + " iş içe aktarıldı");
    };
    var willReplace = ["Mevcut " + state.tasks.length + " aktif iş → yedekteki " + tasks.length + " iş"];
    if(Array.isArray(projects)) willReplace.push(state.projects.length + " proje → " + projects.length + " proje");
    if(Array.isArray(archive)) willReplace.push(state.archive.length + " arşiv kaydı → " + archive.length + " arşiv kaydı");
    if(hasUnits) willReplace.push(state.units.length + " sorumlu → " + units.length + " sorumlu");
    if(Array.isArray(reminders)) willReplace.push(state.reminders.length + " hatırlatma → " + reminders.length + " hatırlatma");
    if(Array.isArray(memos)) willReplace.push(state.memos.length + " not → " + memos.length + " not");
    if(Array.isArray(pnotes)) willReplace.push(state.projectNotes.length + " proje notu → " + pnotes.length + " proje notu");
    var hasData = state.tasks.length || (Array.isArray(projects) && state.projects.length) || (Array.isArray(archive) && state.archive.length) || hasUnits ||
      (Array.isArray(reminders) && state.reminders.length) || (Array.isArray(memos) && state.memos.length) || (Array.isArray(pnotes) && state.projectNotes.length);
    if(hasData) showConfirm({
      title: "Yedekten geri yükle",
      message: "Şunlar değiştirilecek: " + willReplace.join("; ") + ". Devam edilsin mi?",
      confirmLabel: "İçe Aktar", danger: true, onConfirm: go
    });
    else go();
  };
  r.readAsText(file);
}

/* Olay bağlama (main.js → bind) */
export function bindBackup(){
  /* Yedek */
  $("btnExport").onclick = exportBackup;
  $("btnImport").onclick = function(){ $("fileInput").click(); };
  $("fileInput").onchange = function(e){ if(e.target.files[0]) importBackup(e.target.files[0]); e.target.value = ""; };
  $("btnClear").onclick = function(){
    if(!state.tasks.length) return;
    showConfirm({
      title: "Tüm aktif işleri sil",
      message: state.tasks.length + " aktif iş silinecek. Arşiv ve projeler korunur. Önce yedek almanız önerilir. Bu işlem geri alınamaz.",
      confirmLabel: "Hepsini Sil", danger: true,
      onConfirm: function(){ state.tasks = []; commit(["tasks"], "Tüm aktif işler silindi"); }
    });
  };
}
