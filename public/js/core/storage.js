/* Sunucu API'sine tek geçit (Storage) ve tek yazma akışı (commit) */
import { renderAll } from "./render.js";
import { state } from "./state.js";
import { toast } from "./ui.js";
import { timeLabel } from "./utils.js";
import { renderSaveStatus } from "../views/sidebar.js";

export var Storage = (function(){
  var KINDS = ["tasks", "projects", "archive", "units", "reminders", "memos", "projectNotes"];
  var dirty = {}, version = {}, base = {};   // base: türün en son bilinen updatedAt değeri (çakışma kontrolü)
  KINDS.forEach(function(k){ dirty[k] = false; version[k] = 0; base[k] = ""; });
  var chain = Promise.resolve();
  var pending = 0;
  var status = "idle";          // idle | saving | saved | error
  var lastError = "";
  var lastSavedAt = "";
  var loaded = false;           // sunucudan başarıyla okunmadan hiçbir şey yazılmaz (boş state dosyayı ezmesin)
  var conflict = false;         // veri başka pencerede değişti; yenilemeden yazılmaz

  function api(url, opts){
    return fetch(url, opts).then(function(r){
      return r.json().catch(function(){ return {}; }).then(function(j){
        if(!r.ok) throw Object.assign(new Error(j.error || ("HTTP " + r.status)), { status: r.status });
        return j;
      });
    });
  }
  function load(){ return api("/api/state", { cache: "no-store" }); }
  /* Yüklenen veri ekrana uygulandığında çağrılır */
  function adopt(meta){
    meta = meta || {};
    KINDS.forEach(function(k){ base[k] = typeof meta[k] === "string" ? meta[k] : ""; });
    loaded = true; conflict = false;
  }

  function putKind(kind){
    var v = version[kind];
    return api("/api/" + kind, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: state[kind], baseUpdatedAt: base[kind] })
    }).then(function(j){
      if(typeof j.updatedAt === "string") base[kind] = j.updatedAt;
      if(version[kind] === v) dirty[kind] = false;
    }, function(e){
      if(e.status === 409){ conflict = true; e.message = "Veri başka bir pencerede/sekmede değişti. Sayfayı yenileyin"; }
      /* Arayüz güncellendi ama sunucu eski kodla çalışıyor (yeni veri türünü tanımıyor) */
      if(e.status === 404) e.message = "Sunucu eski sürümle çalışıyor. servis\\servis-kur.bat ile (ya da node server.js penceresini kapatıp yeniden açarak) sunucuyu yeniden başlatın";
      throw e;
    });
  }

  /* kinds sırayla yazılır (örn. arşivle: önce arşiv, sonra aktif işler — yarıda kesilirse iş kaybolmaz, en kötü iki yerde görünür) */
  function save(kinds){
    if(!loaded){
      lastError = "Veriler sunucudan yüklenmeden kayıt yapılamaz"; status = "error"; renderSaveStatus();
      return Promise.resolve(false);
    }
    kinds.forEach(function(k){ dirty[k] = true; version[k]++; });
    pending++; status = "saving"; renderSaveStatus();
    var job = chain.then(function(){
      return kinds.reduce(function(acc, k){ return acc.then(function(){ return putKind(k); }); }, Promise.resolve());
    });
    chain = job.catch(function(){});
    return job.then(function(){
      pending--; settle(); return true;
    }, function(e){
      pending--; lastError = (e && e.message) || "bilinmeyen hata"; settle(); return false;
    });
  }
  function settle(){
    if(pending > 0) return;
    if(hasUnsaved()){ status = "error"; }
    else { status = "saved"; lastSavedAt = timeLabel(); lastError = ""; }
    renderSaveStatus();
  }
  function flush(){
    var k = KINDS.filter(function(x){ return dirty[x]; });
    return k.length ? save(k) : Promise.resolve(true);
  }
  function hasUnsaved(){ return pending > 0 || KINDS.some(function(k){ return dirty[k]; }); }

  /* Ek yükleme: { id, name, size, type, uploadedAt } döner */
  function upload(file){
    return api("/api/attachments", {
      method: "POST",
      headers: { "Content-Type": file.type || "application/octet-stream", "X-File-Name": encodeURIComponent(file.name || "dosya") },
      body: file
    });
  }

  return {
    load: load, adopt: adopt, save: save, flush: flush, hasUnsaved: hasUnsaved, upload: upload,
    hasConflict: function(){ return conflict; },
    getStatus: function(){ return status; },
    getError: function(){ return lastError; },
    getSavedAt: function(){ return lastSavedAt; }
  };
})();

/* Her değişikliğin ortak çıkışı */
export function commit(kinds, doneText){
  renderAll();
  Storage.save(kinds).then(function(ok){
    if(ok) toast(doneText + " ve kaydedildi");
    else toast(doneText + " ama DOSYAYA YAZILAMADI: " + Storage.getError() + " — sunucunun çalıştığını kontrol edin", true);
  });
}

