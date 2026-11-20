/* Giriş noktası: olay bağlama (bind) ve açılış (boot) */
import { AiChat } from "./components/ai-chat.js";
import { anyOverlayOpen, topOverlayClose } from "./core/overlays.js";
import { renderAll, switchView } from "./core/render.js";
import { applyServerState, state } from "./core/state.js";
import { Storage } from "./core/storage.js";
import { bindUi, showInfo } from "./core/ui.js";
import { $, esc } from "./core/utils.js";
import { bindAiBridge } from "./features/ai-bridge.js";
import { bindBackup } from "./features/backup.js";
import { startReminderTimer } from "./features/reminder-notify.js";
import { bindProjectNoteModal } from "./modals/project-note-modal.js";
import { bindTaskModal, openModal } from "./modals/task-modal.js";
import { bindAlerts } from "./views/alerts.js";
import { bindArchive, renderArchive } from "./views/archive.js";
import { bindBoard, renderBoard, renderPipeline } from "./views/board.js";
import { bindMemos } from "./views/memos.js";
import { bindProjectAssistant } from "./views/project-assistant.js";
import { bindProjects } from "./views/projects.js";
import { bindReminders } from "./views/reminders.js";
import { bindSettings, closeColorPops } from "./views/settings.js";
import { bindSidebar } from "./views/sidebar.js";

function bind(){
  bindTaskModal();
  bindReminders();
  bindProjects();
  bindProjectNoteModal();
  bindMemos();
  bindSidebar();
  bindBoard();
  bindAlerts();
  bindArchive();
  bindSettings();
  bindUi();
  bindBackup();
  bindAiBridge();
  bindProjectAssistant();

  /* Üst çubuk */
  $("btnNewTask").onclick = function(){ openModal(null); };
  $("btnEmptyNew").onclick = function(){ openModal(null); };
  $("searchInput").oninput = function(e){ state.search = e.target.value; renderPipeline(); renderBoard(); };
  $("archiveSearchInput").oninput = function(e){ state.archiveSearch = e.target.value; renderArchive(); };
  $("tabBoard").onclick = function(){ switchView("board"); };
  $("tabArchive").onclick = function(){ switchView("archive"); };
  $("tabSettings").onclick = function(){ switchView("settings"); };
  $("tabReminders").onclick = function(){ switchView("reminders"); };

  /* Esc: önce açık renk paleti, sonra en üstteki pencere (açılır seçiciler Esc'yi kendileri yakalar) */
  document.onkeydown = function(e){
    if(e.key !== "Escape") return;
    if(document.querySelector(".color-pop.open")) return closeColorPops();
    topOverlayClose();
  };

  /* Kayıt bitmeden sekme kapanırsa uyar */
  window.addEventListener("beforeunload", function(e){
    if(!skipUnloadWarning && Storage.hasUnsaved()){ e.preventDefault(); e.returnValue = ""; }
  });

  /* Sekmeye/pencereye dönüldüğünde, kaydedilmemiş değişiklik yoksa dosyadaki güncel veriyi yeniden oku
     (dosya elle düzenlendiyse ya da başka sekmede değişiklik yapıldıysa ekran güncellenir). */
  var reloadFromServer = function(){
    if(document.visibilityState !== "visible" || Storage.hasUnsaved() || anyOverlayOpen()) return;
    if(AiChat && AiChat.isBusy()) return;   // AI turu sürerken veri altından değişmesin
    if(document.activeElement && document.activeElement.matches && document.activeElement.matches("[data-rename],[data-urename]")) return;
    if(state.remEditing || state.memoEditing) return;   // hatırlatma/not düzenlenirken veri altından değişmesin
    Storage.load().then(function(data){
      if(Storage.hasUnsaved() || anyOverlayOpen()) return;
      applyServerState(data); setFatal(false); renderAll();
    }).catch(function(){});
  };
  document.addEventListener("visibilitychange", reloadFromServer);
  window.addEventListener("focus", reloadFromServer);

}

var skipUnloadWarning = false;
/* Kaydedilmemiş değişiklik uyarısı göstermeden sayfayı yeniler */
export function reloadPage(){ skipUnloadWarning = true; location.reload(); }

export function setFatal(on){
  $("fatalOverlay").classList.toggle("show", on);
  document.querySelector(".app").inert = on;   // kilitliyken klavyeyle arkadaki düğmelere ulaşılamasın
}

export function boot(){
  setFatal(false);
  Storage.load().then(function(data){
    applyServerState(data);
    renderAll();
    /* Sunucu yanıtında yeni türler yoksa sunucu eski koddadır: kayıtlar başarısız olacağı için baştan uyar */
    if(!data.meta || ["reminders", "memos", "projectNotes"].some(function(k){ return typeof data.meta[k] !== "string"; })){
      showInfo("Sunucuyu yeniden başlatın",
        "Uygulama güncellendi ama sunucu hâlâ eski sürümle çalışıyor; hatırlatmalar ve notlar gibi yeni özellikler kaydedilemez. " +
        "Proje klasöründeki servis\\servis-kur.bat dosyasını çalıştırın (elle açtıysanız node server.js penceresinde Ctrl+C'ye basıp yeniden çalıştırın), ardından bu sayfayı yenileyin.");
    }
    startReminderTimer();
  }).catch(function(e){
    setFatal(true);
    var p = $("fatalOverlay").querySelector("p");
    if(e && e.message && e.message.indexOf("okunamadı") !== -1){
      p.innerHTML = "Sunucu çalışıyor ama veriler okunamadı:<br><b>" + esc(e.message) + "</b><br><br>" +
        "Sunucuyu kapatıp data/backup/ içindeki son .db yedeğini data/is-takip.db adıyla geri koyun ve tekrar deneyin. Uygulama, bozuk veriyi ezmemek için kilitli tutuluyor.";
    }
  });
}

bind();
$("fatalRetry").onclick = boot;
boot();

