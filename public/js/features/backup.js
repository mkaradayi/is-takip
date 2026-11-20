/* Yedek: tam yedek (.zip: veritabanı + ekler) indirme ve geri yükleme; tüm aktif işleri silme (Ayarlar → Veri ve yedek) */
import { reloadPage } from "../main.js";
import { state } from "../core/state.js";
import { Storage, commit } from "../core/storage.js";
import { showConfirm, showInfo, toast } from "../core/ui.js";
import { $, download, fmtSize, pad } from "../core/utils.js";

/* Kaydedilmemiş değişiklik varken yedek alınmaz/geri yüklenmez (yedek eksik olur ya da değişiklik kaybolur) */
function unsavedBlock(){
  if(!Storage.hasUnsaved()) return false;
  showInfo("Bekleyen kayıt var", "Son değişiklikler henüz sunucuya kaydedilmedi. Sol alttaki kayıt durumu \"Kaydedildi\" olunca tekrar deneyin.");
  return true;
}

export function downloadBackup(){
  var btn = $("btnBackupDownload");
  if(btn.disabled || unsavedBlock()) return;
  btn.disabled = true;
  toast("Yedek hazırlanıyor…");
  fetch("/api/backup/download", { cache: "no-store" }).then(function(r){
    if(!r.ok) return r.json().catch(function(){ return {}; }).then(function(j){ throw new Error(j.error || ("HTTP " + r.status)); });
    var m = /filename="([\w.-]+)"/.exec(r.headers.get("content-disposition") || "");
    return r.blob().then(function(b){
      download(m ? m[1] : "is-takip-yedek.zip", b);
      toast("Yedek indirildi (" + fmtSize(b.size) + "). Güvenli bir yerde saklayın.");
    });
  }).catch(function(e){ toast("Yedek indirilemedi: " + e.message, true); })
    .then(function(){ btn.disabled = false; });
}

/* Yedekteki manifest.json'u dosyayı açmadan okur: sunucu onu ZIP'e sıkıştırmadan (store) yazar.
   EOCD → merkezi dizin → manifest girdisi → yerel başlık → veri. Okunamazsa null. */
export function readManifest(file){
  return file.arrayBuffer().then(function(ab){
    var dv = new DataView(ab), n = ab.byteLength, eocd = -1;
    for(var i = n - 22; i >= Math.max(0, n - 22 - 0xFFFF); i--){ if(dv.getUint32(i, true) === 0x06054b50){ eocd = i; break; } }
    if(eocd < 0) return null;
    var count = dv.getUint16(eocd + 10, true), p = dv.getUint32(eocd + 16, true);
    for(var k = 0; k < count && p + 46 <= n; k++){
      if(dv.getUint32(p, true) !== 0x02014b50) return null;
      var method = dv.getUint16(p + 10, true), size = dv.getUint32(p + 20, true);
      var nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lho = dv.getUint32(p + 42, true);
      var name = new TextDecoder().decode(new Uint8Array(ab, p + 46, nl));
      if(name === "manifest.json"){
        if(method !== 0 || size > 65536 || lho + 30 > n) return null;
        var start = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true);
        if(start + size > n) return null;
        var m = JSON.parse(new TextDecoder().decode(new Uint8Array(ab, start, size)));
        return m && typeof m === "object" ? m : null;
      }
      p += 46 + nl + xl + cl;
    }
    return null;
  }).catch(function(){ return null; });
}
function stampText(iso){
  var d = new Date(iso);
  if(isNaN(d)) return "bilinmiyor";
  return pad(d.getDate()) + "." + pad(d.getMonth() + 1) + "." + d.getFullYear() + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
}
function num(v){ return typeof v === "number" && v >= 0 ? v : 0; }

export function pickRestore(file){
  readManifest(file).then(function(man){
    if(!man || man.app !== "is-takip"){
      return showInfo("Yedek okunamadı", "Seçilen dosya bir İş Takip yedeği değil. Ayarlar → Veri ve yedek → \"Yedek indir\" ile alınmış bir .zip dosyası seçin.");
    }
    var c = man.counts || {};
    showConfirm({
      title: "Yedekten geri yükle",
      message: "Yedek tarihi: " + stampText(man.createdAt) + ". İçerik: " + num(c.tasks) + " aktif iş, " + num(c.archive) + " arşiv kaydı, " +
        num(c.projects) + " proje, " + num(c.projectNotes) + " proje notu, " + num(c.reminders) + " hatırlatma, " + num(c.memos) + " not, " +
        num(c.units) + " ekip, " + num(man.attachments) + " ek dosyası (" + fmtSize(file.size) + "). " +
        "Mevcut TÜM veri ve ek dosyaları bu yedekle değiştirilecek. Geri yüklemeden önce mevcut durum otomatik olarak data/backup/ klasörüne yedeklenir (sunucu bir sonraki açılışta yeni yedek alana kadar saklanır).",
      confirmLabel: "Geri yükle", danger: true,
      onConfirm: function(){ doRestore(file); }
    });
  });
}
function doRestore(file){
  if(unsavedBlock()) return;
  var btn = $("btnBackupRestore");
  btn.disabled = true;
  toast("Yedek geri yükleniyor…");
  fetch("/api/backup/restore", { method: "POST", headers: { "Content-Type": "application/zip" }, body: file }).then(function(r){
    return r.json().catch(function(){ return {}; }).then(function(j){ if(!r.ok) throw new Error(j.error || ("HTTP " + r.status)); return j; });
  }).then(function(j){
    showConfirm({
      title: "Yedek geri yüklendi",
      message: (j.counts ? j.counts.tasks : 0) + " aktif iş ve " + (j.attachments || 0) + " ek dosyası geri yüklendi. Önceki durumun yedeği: data/" + (j.preRestore || "backup/") +
        ". Sayfa yeni veriyle yeniden yüklenecek. Başka açık sekmeler varsa onları da yenileyin.",
      confirmLabel: "Sayfayı yenile", danger: false, hideCancel: true,
      onConfirm: reloadPage, onCancel: reloadPage
    });
  }).catch(function(e){
    btn.disabled = false;
    showInfo("Geri yükleme yapılamadı", e.message);
  });
}

export function clearActiveTasks(){
  if(!state.tasks.length) return showInfo("Silinecek iş yok", "Aktif iş bulunmuyor.");
  showConfirm({
    title: "Tüm aktif işleri sil",
    message: state.tasks.length + " aktif iş silinecek. Arşiv, projeler ve notlar korunur. Bu işlem geri alınamaz; önce \"Yedek indir\" ile yedek almanız önerilir.",
    confirmLabel: "Hepsini Sil", danger: true,
    onConfirm: function(){ state.tasks = []; state.selected = {}; commit(["tasks"], "Tüm aktif işler silindi"); }
  });
}

/* Olay bağlama (main.js → bind) */
export function bindBackup(){
  $("btnBackupDownload").onclick = downloadBackup;
  $("btnBackupRestore").onclick = function(){ $("restoreInput").click(); };
  $("restoreInput").onchange = function(e){ var f = e.target.files[0]; e.target.value = ""; if(f) pickRestore(f); };
  $("btnClear").onclick = clearActiveTasks;
}
