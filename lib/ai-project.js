/* Proje asistanı: bağlamı DB'den kurar (notlar + ek metinleri + işler), bütçe, /api/ai/project */
"use strict";
const { DAYS_TR, aiHeaders, netError, resolveModel, stripThink } = require("./ai-common");
const { attText } = require("./attachments");
const { readKindFull } = require("./db");
const { s } = require("./util");

/* ---------- Proje asistanı: projenin notları + eklerin metni (+ isteğe bağlı işleri) üzerinden soru-cevap ----------
   Bağlamı istemci değil SUNUCU veritabanından kurar; istemci yalnızca hangi not/eklerin dahil olduğunu (kimlik) söyler. */
const PROJ_BUDGET_BUILTIN = 150000;   // karakter (gpt-oss-120b ~131k token bağlam; payı yanıta bırakır)
const PROJ_BUDGET_LOCAL = 40000;      // yerel modellerin bağlamı genelde küçük
const PROJ_TIMEOUT_MS = 180000;
function stripTags(h){ return String(h || "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|h\d|tr|blockquote)>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&"); }
/* Toplam bütçeyi aşan kaynakları adil kırpar: tek bir üst sınır c bulunur; c'den kısa kaynaklar olduğu gibi kalır,
   uzunlar c'ye kısaltılır (küçük notlar büyük bir PDF yüzünden kaybolmasın). */
function fitBudget(sources, budget){
  const total = sources.reduce((n, x) => n + x.text.length, 0);
  if(total <= budget) return false;
  let lo = 0, hi = Math.max(...sources.map(x => x.text.length));
  while(hi - lo > 1){ const c = (lo + hi) >> 1; if(sources.reduce((n, x) => n + Math.min(x.text.length, c), 0) <= budget) lo = c; else hi = c; }
  sources.forEach(x => { if(x.text.length > lo){ x.text = x.text.slice(0, lo) + "\n[… bütçe nedeniyle kısaltıldı]"; x.truncated = true; } });
  return true;
}
function projectContext(projectId, opt, budget){
  const project = readKindFull("projects").items.find(p => p && p.id === projectId);
  if(!project) throw Object.assign(new Error("Proje bulunamadı"), { status: 404 });
  const noteSet = Array.isArray(opt.noteIds) ? new Set(opt.noteIds.map(String)) : null;
  const attSet = Array.isArray(opt.attIds) ? new Set(opt.attIds.map(String)) : null;
  const notes = readKindFull("projectNotes").items.filter(n => n && n.projectId === projectId)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  const sources = [], unreadable = [];
  notes.forEach(n => {
    const title = s(n.title, 200) || "Adsız not";
    if(!noteSet || noteSet.has(n.id)){
      const text = (typeof n.text === "string" && n.text ? n.text : stripTags(n.html)).trim();
      if(text) sources.push({ kind: "note", id: n.id, name: title, meta: "güncellendi " + s(n.updatedAt, 10), text });
    }
    (Array.isArray(n.attachments) ? n.attachments : []).forEach(a => {
      if(!a || typeof a.id !== "string" || (attSet && !attSet.has(a.id))) return;
      const r = attText(a.id), name = s(a.name, 200) || "dosya";
      if((r.status === "ok" || r.status === "partial") && r.text) sources.push({ kind: "file", id: a.id, name, meta: "not: " + title + (r.status === "partial" ? ", kısmen okunabildi" : ""), text: r.text });
      else unreadable.push(name);
    });
  });
  if(opt.includeTasks){
    const fmt = (t, arch) => "- " + s(t.title, 200) + " | durum: " + s(t.status, 20) + (arch ? " (arşivde)" : "") + " | öncelik: " + s(t.priority, 20) +
      (t.startDate ? " | başlangıç: " + s(t.startDate, 10) : "") + (t.dueDate ? " | termin: " + s(t.dueDate, 10) : "") +
      (t.description ? "\n  açıklama: " + s(t.description, 400).replace(/\s+/g, " ") : "") +
      (Array.isArray(t.notes) && t.notes.length ? "\n  son notlar: " + t.notes.slice(-3).map(x => s(x && x.date, 10) + " " + s(x && x.text, 200).replace(/\s+/g, " ")).join(" / ") : "");
    const list = readKindFull("tasks").items.filter(t => t && t.projectId === projectId).map(t => fmt(t, false))
      .concat(readKindFull("archive").items.filter(t => t && t.projectId === projectId).map(t => fmt(t, true)));
    if(list.length) sources.push({ kind: "tasks", id: "tasks", name: "Projenin işleri", meta: list.length + " iş", text: list.join("\n") });
  }
  const truncated = fitBudget(sources, budget);
  const label = { note: "Not", file: "Dosya", tasks: "İşler" };
  const context = sources.map(x => "### [" + label[x.kind] + ": " + x.name + "] (" + x.meta + ")\n" + x.text).join("\n\n");
  return { project, context, truncated, unreadable,
    used: sources.map(x => ({ kind: x.kind, name: x.name, chars: x.text.length, truncated: !!x.truncated })) };
}
async function aiProject(body){
  body = body || {};
  const cfg = resolveModel(s(body.modelId, 64));
  cfg.timeout = Math.max(cfg.timeout, PROJ_TIMEOUT_MS);   // uzun bağlam: yanıt daha uzun sürebilir
  const question = s(body.question, 4000).trim();
  if(!question) throw Object.assign(new Error("Soru boş"), { status: 400 });
  const budget = cfg.builtin ? PROJ_BUDGET_BUILTIN : PROJ_BUDGET_LOCAL;
  const ctx = projectContext(s(body.projectId, 64), { noteIds: body.noteIds, attIds: body.attIds, includeTasks: body.includeTasks === true }, budget);
  if(!ctx.used.length) throw Object.assign(new Error("Seçili kaynaklarda okunabilir metin yok. En az bir not ya da okunabilir dosya seçin."), { status: 400 });
  const d = new Date(), p2 = n => String(n).padStart(2, "0");
  const today = p2(d.getDate()) + "." + p2(d.getMonth() + 1) + "." + d.getFullYear();   // yerel tarih (UTC değil)
  const system = "Sen İş Takip uygulamasında \"" + s(ctx.project.name, 200) + "\" projesinin asistanısın. Bugün " + today + " (" + DAYS_TR[d.getDay()] + ").\n" +
    "Kurallar:\n- Yalnızca aşağıdaki KAYNAKLAR'a dayanarak, kullanıcının dilinde (genelde Türkçe) yanıt ver.\n" +
    "- Kaynaklarda olmayan bilgiyi uydurma; yoksa açıkça \"kaynaklarda bulunmuyor\" de.\n" +
    "- Önemli bilgilerin sonunda kaynağını köşeli parantezle belirt: [Not: başlık] ya da [Dosya: ad].\n" +
    "- Biçim: kısa paragraflar ve \"- \" ile başlayan maddeler; **kalın** kullanabilirsin. Tablo ve başlık (#) kullanma.\n" +
    (ctx.truncated ? "- Bazı kaynaklar uzunluk sınırı nedeniyle kısaltıldı; bunu gerekirse belirt.\n" : "") +
    (ctx.unreadable.length ? "- Şu dosyaların içeriği okunamadı (yalnızca adları biliniyor): " + ctx.unreadable.join(", ") + "\n" : "") +
    "\nKAYNAKLAR:\n\n" + ctx.context;
  const hist = (Array.isArray(body.history) ? body.history : []).filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-12).map(m => ({ role: m.role, content: s(m.content, 12000) }));
  const req = { model: cfg.model, messages: [{ role: "system", content: system }].concat(hist, [{ role: "user", content: question }]), temperature: 0.2, max_tokens: 3000 };
  const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), cfg.timeout);
  let r, j;
  try{
    r = await fetch(cfg.url, { method: "POST", signal: ctrl.signal, headers: aiHeaders(cfg), body: JSON.stringify(req) });
    j = await r.json().catch(() => ({}));
  }catch(e){ throw Object.assign(new Error(netError(e, cfg)), { status: 502 }); }
  finally{ clearTimeout(timer); }
  const detail = j && j.error ? ": " + s(typeof j.error === "string" ? j.error : j.error.message, 300) : "";
  if(!r.ok){
    const map = { 400: '"' + cfg.name + '" isteği reddetti (bağlam modelin sınırını aşmış olabilir; daha az kaynak seçin)', 401: '"' + cfg.name + '" anahtarı reddetti',
      402: "OpenRouter bakiyesi yetersiz", 403: '"' + cfg.name + '" isteği engelledi', 404: '"' + cfg.model + '" modeli bulunamadı', 408: "Zaman aşımı",
      413: "Gönderilen metin çok büyük; daha az kaynak seçin", 429: "Çok fazla istek; biraz bekleyip tekrar deneyin" };
    throw Object.assign(new Error((map[r.status] || ('"' + cfg.name + '" hatası (HTTP ' + r.status + ")")) + detail), { status: 502 });
  }
  const msg = j && j.choices && j.choices[0] && j.choices[0].message;
  const answer = msg ? stripThink(typeof msg.content === "string" ? msg.content : "") : "";
  if(!answer) throw Object.assign(new Error('"' + cfg.name + '" boş yanıt döndü' + detail), { status: 502 });
  return { answer, modelName: cfg.builtin ? "OpenRouter · gpt-oss-120b" : cfg.name, used: ctx.used, unreadable: ctx.unreadable,
    truncated: ctx.truncated, budget, contextChars: ctx.context.length };
}

module.exports = { aiProject };
