/* İş Takip — AI asistan paneli.
   Sunucu (/api/ai/chat) yalnızca OpenRouter'a aracılık eder; modelin istediği araçları (kart oluştur/düzenle/taşı)
   features/ai-bridge.js köprüsü çalıştırır, sonuçlar "tool" mesajı olarak modele geri gönderilir.
   Sohbet yalnızca bellekte tutulur; sayfa yenilenince sıfırlanır.
   AiChat.init({ getBoard, applyTools, undo, openTask, openView }) */
import { AiModels } from "./ai-models.js";

export const AiChat = (function(){

var MAX_ROUNDS = 6;          // bir kullanıcı mesajı için en fazla model ↔ araç turu
var MAX_SEND = 30;           // modele gönderilen en fazla geçmiş mesaj
var PREF_OPEN = "isTakip.aiOpen";
var EXAMPLES = ["Gecikmiş işleri listele", "Yarın bitecek kritik bir iş ekle", "Yarın 10:00 için bir hatırlatma ekle", "Notlarımda bütçe geçenleri bul"];

var B = null;                // features/ai-bridge.js köprüsü (init ile verilir)
var history = [];            // modele giden mesajlar (user / assistant / tool)
var items = [];              // ekranda gösterilenler: { kind: user|assistant|action|error|info, ... }
var busy = false, ctrl = null;

function $(id){ return document.getElementById(id); }
function esc(s){
  return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){
    return { "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c];
  });
}
/* Model metni: önce tamamen kaçışlanır, sonra yalnızca **kalın**, `kod`, "- " listeleri ve satır sonları biçimlenir */
function fmt(text){
  var lines = esc(text).split(/\r?\n/), out = [], list = false;
  lines.forEach(function(l){
    l = l.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/`([^`]+)`/g, "<code>$1</code>");
    var m = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/.exec(l);
    if(m){ if(!list){ out.push("<ul>"); list = true; } out.push("<li>" + m[1] + "</li>"); return; }
    if(list){ out.push("</ul>"); list = false; }
    out.push(l.trim() ? "<p>" + l + "</p>" : "");
  });
  if(list) out.push("</ul>");
  return out.join("");
}

function setOpen(on){
  document.querySelector(".app").classList.toggle("ai-open", on);
  $("aiPanel").setAttribute("aria-hidden", on ? "false" : "true");
  $("btnAi").classList.toggle("active", on);
  try{ localStorage.setItem(PREF_OPEN, on ? "1" : "0"); }catch(e){}
  if(on) setTimeout(function(){ $("aiInput").focus(); }, 50);
}
function isOpen(){ return document.querySelector(".app").classList.contains("ai-open"); }

/* ---------- Görünüm ---------- */
function taskLinks(list, withStatus){
  return list.map(function(t){
    return '<button type="button" class="ai-task-link" data-ai-open="' + esc(t.id) + '">' + esc(t.title) +
      (withStatus && t.status ? ' <span>→ ' + esc(t.status) + '</span>' : "") + '</button>';
  }).join("");
}
var I_BELL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>';
var I_NOTE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h13l3 3v13H4z"/><path d="M8 9h9M8 13h9M8 17h5"/></svg>';
/* Hatırlatma / not satırları: tıklayınca ilgili sayfa açılır */
function personalLinks(list, view, icon){
  return list.map(function(x){
    var t = String(x.text || "").split("\n")[0];
    return '<button type="button" class="ai-task-link ai-personal" data-ai-goto="' + view + '">' + icon + '<span class="ai-personal-text">' + esc(t.length > 80 ? t.slice(0, 80) + "…" : t) + '</span>' +
      (x.when ? ' <span>' + esc(x.when) + '</span>' : "") + '</button>';
  }).join("");
}
function actionHtml(it){
  var s = it.summary, none = !s.text;
  var h = '<div class="ai-action' + (it.undone ? " undone" : "") + (none ? " failed" : "") + '">';
  h += none
    ? '<div class="ai-action-head"><span class="ai-action-icon">!</span>Değişiklik yapılamadı</div>'
    : '<div class="ai-action-head"><span class="ai-action-icon">✓</span>' + esc(s.text) + '</div>';
  if(s.created.length) h += '<div class="ai-action-group"><div class="ai-action-label">Oluşturulan</div>' + taskLinks(s.created) + '</div>';
  if(s.updated.length) h += '<div class="ai-action-group"><div class="ai-action-label">Güncellenen</div>' + taskLinks(s.updated) + '</div>';
  if(s.moved.length) h += '<div class="ai-action-group"><div class="ai-action-label">Taşınan</div>' + taskLinks(s.moved, true) + '</div>';
  ["created", "updated"].forEach(function(a){
    var r = (s.reminders || []).filter(function(x){ return x.action === a; }), m = (s.memos || []).filter(function(x){ return x.action === a; });
    var lbl = a === "created" ? "Eklenen" : "Güncellenen";
    if(r.length) h += '<div class="ai-action-group"><div class="ai-action-label">' + lbl + ' hatırlatma</div>' + personalLinks(r, "reminders", I_BELL) + '</div>';
    if(m.length) h += '<div class="ai-action-group"><div class="ai-action-label">' + lbl + ' not</div>' + personalLinks(m, "memos", I_NOTE) + '</div>';
  });
  if(s.skipped.length) h += '<div class="ai-action-skip"><b>Uygulanmayan:</b><ul>' + s.skipped.map(function(x){ return "<li>" + esc(x) + "</li>"; }).join("") + '</ul></div>';
  if(it.token){
    h += it.undone
      ? '<div class="ai-action-foot">Geri alındı</div>'
      : '<div class="ai-action-foot"><button type="button" class="ai-undo" data-ai-undo="' + esc(it.token) + '">Geri al</button></div>';
  }
  return h + '</div>';
}
function render(){
  var el = $("aiMessages");
  if(!items.length){
    el.innerHTML = '<div class="ai-empty"><div class="ai-empty-title">Panonuzla ilgili ne yapmak istersiniz?</div>' +
      '<p>İş oluşturabilir, düzenleyebilir ve sekmeler arasında taşıyabilirim; hatırlatma ve not ekleyip güncelleyebilirim. Yaptığım her adımı tek tıkla geri alabilirsiniz.</p>' +
      '<div class="ai-examples">' + EXAMPLES.map(function(x){ return '<button type="button" class="ai-example" data-ai-example="' + esc(x) + '">' + esc(x) + '</button>'; }).join("") + '</div></div>';
  } else {
    el.innerHTML = items.map(function(it, i){
      if(it.kind === "user") return '<div class="ai-msg ai-user">' + esc(it.text).replace(/\n/g, "<br>") + '</div>';
      if(it.kind === "assistant") return '<div class="ai-msg ai-bot">' + fmt(it.text) + '</div>';
      if(it.kind === "action") return actionHtml(it);
      if(it.kind === "error") return '<div class="ai-msg ai-error">' + esc(it.text) + '</div>';
      return '<div class="ai-info">' + esc(it.text) + '</div>';
    }).join("") + (busy ? '<div class="ai-msg ai-bot ai-typing"><span></span><span></span><span></span></div>' : "");
  }
  el.scrollTop = el.scrollHeight;
  $("aiSend").classList.toggle("stop", busy);
  $("aiSend").setAttribute("title", busy ? "Durdur" : "Gönder (Enter)");
  $("aiSend").setAttribute("aria-label", busy ? "Durdur" : "Gönder");
  $("aiInput").disabled = busy;
}

/* ---------- Model ile konuşma ---------- */
/* Son MAX_SEND mesaj; baştaki yetim tool/assistant mesajları atılır ki her parça bir kullanıcı mesajıyla başlasın */
function trimmed(){
  var h = history.slice(-MAX_SEND);
  while(h.length && h[0].role !== "user") h.shift();
  return h;
}
function post(){
  return fetch("/api/ai/chat", {
    method: "POST", signal: ctrl.signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: trimmed(), board: B.getBoard(), modelId: AiModels.selected().id })
  }).then(function(r){
    return r.json().catch(function(){ return {}; }).then(function(j){
      if(!r.ok) throw new Error(j.error || ("Sunucu hatası (HTTP " + r.status + ")"));
      return j.message;
    });
  });
}
function send(text){
  text = String(text || "").trim();
  if(!text || busy) return;
  history.push({ role: "user", content: text });
  items.push({ kind: "user", text: text });
  busy = true; ctrl = new AbortController(); render();
  var round = 0;
  var step = function(){
    round++;
    return post().then(function(msg){
      history.push(msg);
      if(msg.content && msg.content.trim()) items.push({ kind: "assistant", text: msg.content.trim() });
      if(!msg.tool_calls || !msg.tool_calls.length) return;
      var r = B.applyTools(msg.tool_calls);
      r.results.forEach(function(x){ history.push({ role: "tool", tool_call_id: x.tool_call_id, content: x.content }); });
      var s = r.summary;
      if(r.token || s.skipped.length) items.push({ kind: "action", summary: s, token: r.token, undone: false });
      render();
      if(round >= MAX_ROUNDS){ items.push({ kind: "error", text: "Çok fazla adım gerekti, durduruldu. İsteği daha küçük parçalara bölmeyi deneyin." }); return; }
      return step();
    });
  };
  step().catch(function(e){
    if(e && e.name === "AbortError") items.push({ kind: "info", text: "Durduruldu. O ana kadar yapılan değişiklikler duruyor; geri almak için eylem kartındaki butonu kullanın." });
    else items.push({ kind: "error", text: (e && e.message) || "Bilinmeyen hata" });
  }).then(function(){ busy = false; ctrl = null; render(); $("aiInput").focus(); });
}
function undo(token){
  var r = B.undo(token);
  if(!r.ok){ items.push({ kind: "error", text: r.error }); return render(); }
  items.forEach(function(it){ if(it.token === token) it.undone = true; });
  history.push({ role: "user", content: "(Bilgi: kullanıcı senin son yaptığın değişikliklerden birini Geri al ile geri aldı.)" });
  if(r.missing) items.push({ kind: "info", text: r.missing + " iş bu arada panodan kaldırıldığı için geri alınamadı." });
  render();
}
function reset(){
  if(busy && ctrl) ctrl.abort();
  history = []; items = []; render(); $("aiInput").focus();
}

/* Panel başlığındaki model seçici; liste Ayarlar → AI Modelleri'nden gelir */
function renderModels(list){
  var sel = $("aiModel"), cur = AiModels.selected();
  sel.innerHTML = "";
  list.forEach(function(m){
    var o = document.createElement("option");
    o.value = m.id;
    o.textContent = m.name + (m.available ? "" : " (anahtar yok)");
    o.disabled = !m.available;
    sel.appendChild(o);
  });
  sel.value = cur.id;
  $("aiFoot").textContent = (cur.builtin
    ? "Aktif işlerin ve yaklaşan hatırlatmaların özeti OpenRouter'a gönderilir"
    : "Aktif işlerin ve yaklaşan hatırlatmaların özeti " + cur.baseUrl + " adresine gönderilir") + "; notlarınız yalnızca asistan onları aradığında gönderilir. Sohbet kaydedilmez.";
}

function init(bridge){
  B = bridge;
  AiModels.onChange(renderModels);
  $("aiModel").addEventListener("change", function(e){
    AiModels.select(e.target.value);
    var m = AiModels.selected();
    if(items.length){ items.push({ kind: "info", text: "Model değiştirildi: " + m.name }); render(); }
  });
  $("btnAi").onclick = function(){ setOpen(!isOpen()); };
  $("aiClose").onclick = function(){ setOpen(false); };
  $("aiNew").onclick = reset;
  $("aiSend").onclick = function(){ if(busy){ if(ctrl) ctrl.abort(); } else { send($("aiInput").value); $("aiInput").value = ""; autosize(); } };
  var inp = $("aiInput");
  var autosize = function(){
    inp.style.height = "auto";
    inp.style.height = Math.max(40, Math.min(inp.scrollHeight + 2, 160)) + "px";
    inp.classList.toggle("scroll", inp.scrollHeight > 160);
  };
  inp.addEventListener("input", autosize);
  inp.addEventListener("keydown", function(e){
    if(e.key === "Enter" && !e.shiftKey && !e.isComposing){ e.preventDefault(); $("aiSend").click(); }
  });
  $("aiMessages").addEventListener("click", function(e){
    var ex = e.target.closest("[data-ai-example]"), op = e.target.closest("[data-ai-open]"), un = e.target.closest("[data-ai-undo]"), go = e.target.closest("[data-ai-goto]");
    if(ex){ inp.value = ex.getAttribute("data-ai-example"); autosize(); inp.focus(); }
    else if(op) B.openTask(op.getAttribute("data-ai-open"));
    else if(un) undo(un.getAttribute("data-ai-undo"));
    else if(go && B.openView) B.openView(go.getAttribute("data-ai-goto"));
  });
  var saved = null; try{ saved = localStorage.getItem(PREF_OPEN); }catch(e){}
  if(saved === "1") setOpen(true);
  render();
}

/* format: güvenli model metni biçimlendirici (proje asistanı da kullanır) */
return { init: init, isBusy: function(){ return busy; }, send: send, format: fmt };
})();
