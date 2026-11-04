/* İş Takip — AI model kaydı (Ayarlar → AI Modelleri) ve seçili model.
   Liste sunucuda (data/ai-models.json) tutulur; API anahtarları tarayıcıya hiç gelmez, yalnızca "hasKey" bilgisi gelir.
   Hangi modelin seçili olduğu bu tarayıcıda (localStorage) hatırlanır.
   window.AiModels.init({ confirm, toast }) · list() · selected() · select(id) · onChange(fn) */
(function(){
"use strict";

var PREF = "isTakip.aiModel";
var models = [], listeners = [], editing = null, B = null, loaded = false;

function $(id){ return document.getElementById(id); }
function esc(s){
  return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){
    return { "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c];
  });
}
function api(url, opts){
  return fetch(url, opts).then(function(r){
    return r.json().catch(function(){ return {}; }).then(function(j){
      if(!r.ok) throw new Error(j.error || ("HTTP " + r.status));
      return j;
    });
  });
}
function postJSON(url, body, method){
  return api(url, { method: method || "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
function pref(v){
  try{ if(v === undefined) return localStorage.getItem(PREF); localStorage.setItem(PREF, v); }catch(e){ return null; }
}

/* ---------- Seçim ---------- */
function list(){ return models.slice(); }
function selected(){
  var id = pref(), m = models.filter(function(x){ return x.id === id; })[0];
  if(m) return m;
  return models.filter(function(x){ return x.available; })[0] || models[0] || { id: "openrouter", name: "OpenRouter · gpt-oss-120b", builtin: true };
}
function select(id){ pref(id); emit(); render(); }
function onChange(fn){ listeners.push(fn); if(loaded) fn(models); }
function emit(){ listeners.forEach(function(f){ f(models); }); }

function load(){
  return api("/api/ai/models").then(function(j){ models = j.items || []; loaded = true; emit(); render(); })
    .catch(function(e){ setStatus("Model listesi alınamadı: " + e.message, "err"); });
}
function custom(){ return models.filter(function(m){ return !m.builtin; }); }
function persist(items){
  return postJSON("/api/ai/models", { items: items }, "PUT").then(function(j){ models = j.items || []; emit(); render(); });
}

/* ---------- Ayarlar görünümü ---------- */
function render(){
  var el = $("modelList"); if(!el) return;
  var sel = selected().id;
  el.innerHTML = models.map(function(m){
    var keyPill = m.builtin
      ? (m.hasKey ? '<span class="model-pill ok">Anahtar .env\'de</span>' : '<span class="model-pill warn">.env\'de anahtar yok</span>')
      : (m.hasKey ? '<span class="model-pill">Anahtar kayıtlı</span>' : '<span class="model-pill">Anahtarsız</span>');
    return '<div class="model-row' + (m.id === sel ? " selected" : "") + '" data-mid="' + esc(m.id) + '">' +
      '<div class="model-main"><div class="model-name">' + esc(m.name) + (m.builtin ? ' <span class="model-tag">yerleşik</span>' : "") +
        (m.id === sel ? ' <span class="model-tag sel">asistanda seçili</span>' : "") + '</div>' +
      '<div class="model-sub">' + esc(m.model) + ' · ' + esc(m.baseUrl) + '</div>' +
      '<div class="model-row-status" data-mstatus="' + esc(m.id) + '"></div></div>' +
      keyPill +
      '<div class="model-actions">' +
        (m.id !== sel && m.available ? '<button type="button" class="btn btn-sm" data-msel="' + esc(m.id) + '">Seç</button>' : "") +
        '<button type="button" class="btn btn-sm" data-mtest="' + esc(m.id) + '">Test et</button>' +
        (m.builtin ? "" : '<button type="button" class="btn btn-sm" data-medit="' + esc(m.id) + '">Düzenle</button>' +
          '<button type="button" class="btn btn-sm btn-danger-soft" data-mdel="' + esc(m.id) + '">Sil</button>') +
      '</div></div>';
  }).join("");
}
function setStatus(text, kind){
  var el = $("mStatus"); if(!el) return;
  el.className = "model-form-status" + (kind ? " " + kind : "");
  el.textContent = text || "";
}
function resetForm(){
  editing = null;
  $("modelForm").reset();
  $("modelFormTitle").textContent = "Yeni model ekle";
  $("mCancel").style.display = "none";
  $("mKey").placeholder = "Yerel sunucularda genelde gerekmez";
  $("mModelList").innerHTML = "";
  setStatus("");
}
function startEdit(id){
  var m = models.filter(function(x){ return x.id === id; })[0]; if(!m) return;
  editing = m;
  $("mName").value = m.name; $("mBase").value = m.baseUrl; $("mModel").value = m.model; $("mKey").value = "";
  $("mKey").placeholder = m.hasKey ? "Kayıtlı anahtar korunur — değiştirmek için yenisini yazın, silmek için - yazın" : "Yerel sunucularda genelde gerekmez";
  $("modelFormTitle").textContent = '"' + m.name + '" modelini düzenle';
  $("mCancel").style.display = "inline-flex";
  setStatus("");
  $("aiModelsSection").scrollIntoView({ block: "nearest" });
  $("mName").focus();
}
function formValues(){
  return { name: $("mName").value.trim(), baseUrl: $("mBase").value.trim(), model: $("mModel").value.trim(), key: $("mKey").value.trim() };
}

/* Bağlantı testi: sunucunun /models listesini getirir; model adı listede yoksa uyarır */
function testForm(fillOnly){
  var v = formValues();
  if(!v.baseUrl){ setStatus("Önce adresi girin", "err"); $("mBase").focus(); return; }
  setStatus("Bağlanılıyor…", "busy");
  var body = { baseUrl: v.baseUrl };
  if(v.key && v.key !== "-") body.apiKey = v.key;
  else if(editing && v.key !== "-") body.id = editing.id;
  postJSON("/api/ai/models/test", body).then(function(r){
    $("mModelList").innerHTML = r.models.map(function(x){ return '<option value="' + esc(x) + '">'; }).join("");
    if(!v.model && r.models.length) $("mModel").value = r.models[0];
    var name = $("mModel").value.trim();
    var found = !name || r.models.indexOf(name) !== -1;
    if(!r.models.length) setStatus("✓ Bağlantı başarılı, ancak sunucu model listesi döndürmedi. Model adını elle yazın.", "ok");
    else if(found) setStatus("✓ Bağlantı başarılı — " + r.models.length + " model bulundu" + (fillOnly ? ". Model adı alanından seçebilirsiniz." : "."), "ok");
    else setStatus("Bağlantı başarılı ama \"" + name + "\" bu sunucuda yok. Mevcut modeller: " + r.models.slice(0, 8).join(", ") + (r.models.length > 8 ? "…" : ""), "warn");
  }, function(e){ setStatus(e.message, "err"); });
}
function testRow(id){
  var m = models.filter(function(x){ return x.id === id; })[0]; if(!m) return;
  var el = document.querySelector('[data-mstatus="' + id + '"]');
  el.className = "model-row-status busy"; el.textContent = "Bağlanılıyor…";
  postJSON("/api/ai/models/test", { id: m.id, baseUrl: m.baseUrl }).then(function(r){
    var found = !r.models.length || r.models.indexOf(m.model) !== -1;
    el.className = "model-row-status " + (found ? "ok" : "warn");
    el.textContent = found ? "✓ Bağlantı başarılı" + (r.models.length ? " (" + r.models.length + " model)" : "") : 'Bağlantı var ama "' + m.model + '" bu sunucuda bulunamadı';
  }, function(e){ el.className = "model-row-status err"; el.textContent = e.message; });
}

function submit(e){
  e.preventDefault();
  var v = formValues();
  if(!v.name){ setStatus("Görünen ad boş olamaz", "err"); $("mName").focus(); return; }
  if(!/^https?:\/\/\S+$/i.test(v.baseUrl)){ setStatus("Adres http:// veya https:// ile başlamalı", "err"); $("mBase").focus(); return; }
  if(!v.model){ setStatus("Model adı boş olamaz (\"Modelleri getir\" ile seçebilirsiniz)", "err"); $("mModel").focus(); return; }
  var before = custom().map(function(m){ return m.id; });
  var items = custom().map(function(m){ return { id: m.id, name: m.name, baseUrl: m.baseUrl, model: m.model }; });
  var entry = { name: v.name, baseUrl: v.baseUrl, model: v.model };
  if(v.key === "-") entry.apiKey = "";
  else if(v.key) entry.apiKey = v.key;
  else if(!editing) entry.apiKey = "";
  var wasEditing = editing;
  if(editing){
    entry.id = editing.id;
    items = items.map(function(m){ return m.id === editing.id ? entry : m; });
  } else items.push(entry);
  setStatus("Kaydediliyor…", "busy");
  persist(items).then(function(){
    var added = custom().filter(function(m){ return before.indexOf(m.id) === -1; })[0];
    resetForm();
    if(added){ select(added.id); B.toast('"' + added.name + '" eklendi ve AI asistanında seçildi'); }
    else B.toast('"' + (wasEditing ? v.name : "") + '" güncellendi');
  }, function(err){ setStatus(err.message, "err"); });
}
function remove(id){
  var m = models.filter(function(x){ return x.id === id; })[0]; if(!m) return;
  B.confirm({
    title: "Modeli sil", message: '"' + m.name + '" model listesinden kaldırılacak (kayıtlı anahtarı da silinir).', confirmLabel: "Sil", danger: true,
    onConfirm: function(){
      persist(custom().filter(function(x){ return x.id !== id; }).map(function(x){ return { id: x.id, name: x.name, baseUrl: x.baseUrl, model: x.model }; }))
        .then(function(){ if(editing && editing.id === id) resetForm(); B.toast('"' + m.name + '" silindi'); }, function(e){ B.toast("Silinemedi: " + e.message, true); });
    }
  });
}

function init(bridge){
  B = bridge;
  $("modelForm").addEventListener("submit", submit);
  $("mCancel").onclick = resetForm;
  $("mTest").onclick = function(){ testForm(false); };
  $("mFetch").onclick = function(){ testForm(true); };
  document.querySelector(".model-presets").addEventListener("click", function(e){
    var b = e.target.closest("[data-preset]"); if(!b) return;
    $("mBase").value = b.getAttribute("data-preset");
    if(!$("mName").value.trim()) $("mName").value = b.getAttribute("data-pname");
    $("mModel").focus();
  });
  $("modelList").addEventListener("click", function(e){
    var s = e.target.closest("[data-msel]"), t = e.target.closest("[data-mtest]"), ed = e.target.closest("[data-medit]"), d = e.target.closest("[data-mdel]");
    if(s){ select(s.getAttribute("data-msel")); B.toast("AI asistanı artık bu modeli kullanacak"); }
    else if(t) testRow(t.getAttribute("data-mtest"));
    else if(ed) startEdit(ed.getAttribute("data-medit"));
    else if(d) remove(d.getAttribute("data-mdel"));
  });
  load();
}

window.AiModels = { init: init, list: list, selected: selected, select: select, onChange: onChange, reload: load };
})();
