/* Proje asistanı (notlar + ekler üzerinden LLM soru-cevap) */
import { AiChat } from "../components/ai-chat.js";
import { AiModels } from "../components/ai-models.js";
import { RichEditor } from "../components/editor.js";
import { ICON } from "../core/config.js";
import { getProject, normalizeProjectNote, notesOfProject, state } from "../core/state.js";
import { commit } from "../core/storage.js";
import { toast } from "../core/ui.js";
import { $, esc, uid } from "../core/utils.js";
import { memoTime } from "./memos.js";
import { attTextBadge, attTextCache, projectFiles } from "./projects.js";

export var PA_QUICK = {
  ozet:    "Bu projenin kaynaklarına göre kısa bir yönetici özeti çıkar: amaç, mevcut durum, son önemli gelişmeler ve sıradaki adımlar.",
  riskler: "Kaynaklara göre açık konuları, riskleri ve engelleri listele; her biri için varsa sorumlu kişiyi ve tarihi belirt.",
  kararlar: "Kaynaklarda alınmış kararları ve aksiyon maddelerini listele (kim, ne, ne zaman). Tarihi olmayanları ayrıca belirt."
};
export var pa = { projectId: null, items: [], history: [], busy: false, ctrl: null, exclNotes: {}, exclFiles: {}, tasks: false, srcOpen: false };
export function paReset(projectId){
  if(pa.ctrl) try{ pa.ctrl.abort(); }catch(e){}
  pa = { projectId: projectId, items: [], history: [], busy: false, ctrl: null, exclNotes: {}, exclFiles: {}, tasks: false, srcOpen: false };
}
export function paBudget(){ var m = AiModels ? AiModels.selected() : null; return m && !m.builtin ? 40000 : 150000; }
/* Seçili kaynaklar: varsayılan olarak tüm notlar ve okunabilir dosyalar (yeni eklenenler de otomatik dahil) */
export function paSources(p){
  var notes = notesOfProject(p.id).sort(function(a, b){ return b.updatedAt.localeCompare(a.updatedAt); });
  var files = projectFiles(p).map(function(f){
    var st = attTextCache[f.att.id], readable = !!st && (st.status === "ok" || st.status === "partial");
    return { att: f.att, note: f.note, st: st, readable: readable, on: readable && !pa.exclFiles[f.att.id] };
  });
  return {
    notes: notes.map(function(n){ return { note: n, on: !pa.exclNotes[n.id] }; }),
    files: files,
    chars: notes.filter(function(n){ return !pa.exclNotes[n.id]; }).reduce(function(s, n){ return s + n.text.length; }, 0) +
      files.filter(function(f){ return f.on; }).reduce(function(s, f){ return s + f.st.chars; }, 0) +
      (pa.tasks ? state.tasks.concat(state.archive).filter(function(t){ return t.projectId === p.id; }).length * 300 : 0)
  };
}
export function kChars(n){ return n >= 1000 ? Math.round(n / 1000).toLocaleString("tr-TR") + " bin" : String(n); }
export function renderPaSources(){
  var p = getProject(state.projectView); if(!p) return;
  var s = paSources(p), budget = paBudget();
  var nOn = s.notes.filter(function(x){ return x.on; }).length, fOn = s.files.filter(function(x){ return x.on; }).length;
  var fRead = s.files.filter(function(x){ return x.readable; }).length, pending = s.files.some(function(x){ return !x.st; });
  $("paSrcSummary").innerHTML = '<b>Kaynaklar:</b> ' + nOn + '/' + s.notes.length + ' not · ' + fOn + '/' + s.files.length + ' dosya' +
    (s.files.length > fRead && !pending ? ' <span class="proj-muted">(' + (s.files.length - fRead) + ' dosya okunamıyor)</span>' : "") +
    (pa.tasks ? ' · işler dahil' : "") + ' · ≈ ' + kChars(s.chars) + ' karakter' +
    (s.chars > budget ? ' <span class="pa-warn" title="Gönderilirken büyük kaynaklar kısaltılır">— sınır ' + kChars(budget) + ', kısaltılacak</span>' : "");
  $("paSrcToggle").textContent = pa.srcOpen ? "Seçimi kapat" : "Kaynakları seç";
  $("paSrcList").style.display = pa.srcOpen ? "" : "none";
  if(pa.srcOpen){
    $("paSrcList").innerHTML =
      '<label class="pa-chk pa-chk-all"><input type="checkbox" data-pa-tasks="1"' + (pa.tasks ? " checked" : "") + '> Projenin işlerini de ekle <span class="proj-muted">(başlık, durum, tarihler, son notlar)</span></label>' +
      (s.notes.length ? '<div class="pa-src-head">Notlar</div>' + s.notes.map(function(x){
        return '<label class="pa-chk"><input type="checkbox" data-pa-note="' + x.note.id + '"' + (x.on ? " checked" : "") + '> ' + esc(x.note.title || "Adsız not") +
          ' <span class="proj-muted">' + kChars(x.note.text.length) + ' kr.</span></label>';
      }).join("") : "") +
      (s.files.length ? '<div class="pa-src-head">Dosyalar</div>' + s.files.map(function(x){
        return '<label class="pa-chk' + (x.readable ? "" : " off") + '"><input type="checkbox" data-pa-file="' + x.att.id + '"' + (x.on ? " checked" : "") + (x.readable ? "" : " disabled") + '> ' +
          esc(x.att.name) + ' ' + attTextBadge(x.att.id) + '</label>';
      }).join("") : "");
  }
}
export function paModelOptions(list){
  var sel = $("paModel"), cur = AiModels.selected();
  sel.innerHTML = list.map(function(m){ return '<option value="' + esc(m.id) + '"' + (m.available ? "" : " disabled") + '>' + esc(m.name) + (m.available ? "" : " (anahtar yok)") + '</option>'; }).join("");
  sel.value = cur.id;
  $("paFoot").textContent = "Seçilen notlar ve dosya içerikleri " + (cur.builtin ? "OpenRouter'a (internet)" : cur.baseUrl + " adresine") + " gönderilir. Sohbet kaydedilmez.";
  if(state.view === "projects" && state.projectView) renderPaSources();   // bütçe modele bağlı
}
export function paRenderLog(){
  $("paLog").innerHTML = pa.items.map(function(it, i){
    if(it.kind === "user") return '<div class="pa-msg user">' + esc(it.text) + '</div>';
    if(it.kind === "error") return '<div class="pa-msg err">' + esc(it.text) + '</div>';
    var u = it.used || [], nN = u.filter(function(x){ return x.kind === "note"; }).length, nF = u.filter(function(x){ return x.kind === "file"; }).length;
    var cut = u.filter(function(x){ return x.truncated; }).map(function(x){ return x.name; });
    return '<div class="pa-msg bot">' + AiChat.format(it.text) +
      '<div class="pa-meta">' + esc(it.modelName || "") + ' · ' + nN + ' not, ' + nF + ' dosya' + (u.some(function(x){ return x.kind === "tasks"; }) ? ", işler" : "") + ' kullanıldı' +
        (cut.length ? '<br><span class="pa-warn">Kısaltılan: ' + esc(cut.join(", ")) + '</span>' : "") +
        (it.unreadable && it.unreadable.length ? '<br>Okunamayan: ' + esc(it.unreadable.join(", ")) : "") + '</div>' +
      '<div class="pa-actions"><button type="button" class="btn btn-sm" data-pa-save="' + i + '"' + (it.saved ? " disabled" : "") + '>' + ICON.note + (it.saved ? "Nota kaydedildi" : "Yanıtı nota kaydet") + '</button>' +
        '<button type="button" class="btn btn-sm btn-ghost" data-pa-copy="' + i + '">Kopyala</button></div></div>';
  }).join("") + (pa.busy ? '<div class="pa-msg bot pa-thinking"><span class="pa-dots"><i></i><i></i><i></i></span> Kaynaklar okunuyor ve yanıt hazırlanıyor… <button type="button" class="btn btn-sm btn-ghost" data-pa-stop="1">Durdur</button></div>' : "");
  $("paLog").style.display = pa.items.length || pa.busy ? "" : "none";
  $("paSend").disabled = pa.busy;
  Array.prototype.forEach.call(document.querySelectorAll("[data-pa-q]"), function(b){ b.disabled = pa.busy; });
  var log = $("paLog"); log.scrollTop = log.scrollHeight;
}
export function paAsk(question){
  question = String(question || "").trim();
  var p = getProject(state.projectView);
  if(!question || !p || pa.busy) return;
  var s = paSources(p);
  if(!s.notes.some(function(x){ return x.on; }) && !s.files.some(function(x){ return x.on; }) && !pa.tasks){
    toast("En az bir not, okunabilir dosya ya da 'işler' seçin", true); return;
  }
  pa.items.push({ kind: "user", text: question });
  pa.busy = true; pa.ctrl = window.AbortController ? new AbortController() : null;
  paRenderLog();
  var pid = p.id, ctrl = pa.ctrl;
  fetch("/api/ai/project", {
    method: "POST", headers: { "Content-Type": "application/json" }, signal: ctrl ? ctrl.signal : undefined,
    body: JSON.stringify({ projectId: pid, question: question, history: pa.history,
      noteIds: s.notes.filter(function(x){ return x.on; }).map(function(x){ return x.note.id; }),
      /* Okunamayan dosyalar da gönderilir: sunucu onları içerik yerine yalnızca adıyla bildirir */
      attIds: s.files.filter(function(x){ return x.on || (x.st && !x.readable); }).map(function(x){ return x.att.id; }),
      includeTasks: pa.tasks, modelId: AiModels.selected().id })
  }).then(function(r){
    return r.json().catch(function(){ return {}; }).then(function(j){ if(!r.ok) throw new Error(j.error || ("HTTP " + r.status)); return j; });
  }).then(function(j){
    if(pa.projectId !== pid || pa.ctrl !== ctrl) return;   // bu arada proje değişti / yeni sohbet
    pa.items.push({ kind: "bot", text: j.answer, question: question, used: j.used, unreadable: j.unreadable, modelName: j.modelName });
    pa.history.push({ role: "user", content: question }, { role: "assistant", content: j.answer });
  }, function(e){
    if(pa.projectId !== pid || pa.ctrl !== ctrl) return;
    pa.items.push({ kind: "error", text: e.name === "AbortError" ? "Durduruldu." : "Yanıt alınamadı: " + e.message });
  }).then(function(){
    if(pa.projectId !== pid || pa.ctrl !== ctrl) return;
    pa.busy = false; pa.ctrl = null; paRenderLog();
  });
}
export function paSaveAnswer(i){
  var it = pa.items[i], p = getProject(state.projectView);
  if(!it || it.kind !== "bot" || it.saved || !p) return;
  var now = new Date().toISOString();
  var html = RichEditor.sanitize('<p><b>Soru:</b> ' + esc(it.question) + '</p>' + AiChat.format(it.text) +
    '<p><i>' + esc((it.modelName || "AI") + " yanıtı · " + memoTime(now)) + '</i></p>');
  state.projectNotes.push(normalizeProjectNote({ id: uid(), projectId: p.id, title: ("Asistan: " + it.question).slice(0, 120), html: html, createdAt: now, updatedAt: now }));
  it.saved = true;
  commit(["projectNotes"], "Yanıt proje notu olarak kaydedildi");
}
export function renderPa(p){
  if(pa.projectId !== p.id) paReset(p.id);
  renderPaSources(); paRenderLog();
}

/* Olay bağlama (main.js → bind) */
export function bindProjectAssistant(){
  /* Proje asistanı */
  AiModels.onChange(paModelOptions);
  $("paModel").onchange = function(e){ AiModels.select(e.target.value); };
  $("paNew").onclick = function(){ paReset(state.projectView); renderPaSources(); paRenderLog(); $("paInput").focus(); };
  $("paSrcToggle").onclick = function(){ pa.srcOpen = !pa.srcOpen; renderPaSources(); };
  $("paSrcList").onchange = function(e){
    var c = e.target; if(!c || c.type !== "checkbox") return;
    if(c.hasAttribute("data-pa-note")){ var n = c.getAttribute("data-pa-note"); if(c.checked) delete pa.exclNotes[n]; else pa.exclNotes[n] = true; }
    else if(c.hasAttribute("data-pa-file")){ var f = c.getAttribute("data-pa-file"); if(c.checked) delete pa.exclFiles[f]; else pa.exclFiles[f] = true; }
    else if(c.hasAttribute("data-pa-tasks")) pa.tasks = c.checked;
    renderPaSources();
  };
  $("paQuick").onclick = function(e){ var b = e.target.closest("[data-pa-q]"); if(b && !b.disabled) paAsk(PA_QUICK[b.getAttribute("data-pa-q")]); };
  $("paSend").onclick = function(){ var v = $("paInput").value; if(v.trim() && !pa.busy){ $("paInput").value = ""; paAsk(v); } };
  $("paInput").onkeydown = function(e){ if(e.key === "Enter" && !e.shiftKey){ e.preventDefault(); $("paSend").click(); } };
  $("paLog").onclick = function(e){
    var sv = e.target.closest("[data-pa-save]"), cp = e.target.closest("[data-pa-copy]");
    if(e.target.closest("[data-pa-stop]")){ if(pa.ctrl) pa.ctrl.abort(); return; }
    if(sv) paSaveAnswer(+sv.getAttribute("data-pa-save"));
    else if(cp){
      var it = pa.items[+cp.getAttribute("data-pa-copy")];
      if(it && navigator.clipboard) navigator.clipboard.writeText(it.text).then(function(){ toast("Yanıt panoya kopyalandı"); }, function(){ toast("Kopyalanamadı", true); });
    }
  };
}
