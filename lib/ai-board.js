/* Pano asistanı: pano özeti temizliği, araç şemaları, sistem mesajı, /api/ai/chat */
"use strict";
const crypto = require("crypto");
const { AI_MAX_BOARD, AI_MAX_MESSAGES, DAYS_TR, aiHeaders, netError, resolveModel, stripThink } = require("./ai-common");
const { SAFE_ID } = require("./config");
const { s } = require("./util");

function ids(list){ return (Array.isArray(list) ? list : []).map(x => s(x && x.id, 64)).filter(id => SAFE_ID.test(id)); }

/* İstemciden gelen pano özetini güvenli ve sınırlı bir biçime indirger */
function idStrings(list){ return (Array.isArray(list) ? list : []).slice(0, 50).map(x => s(x, 64)).filter(id => SAFE_ID.test(id)); }

function cleanBoard(b){
  b = b && typeof b === "object" ? b : {};
  const pick = (list, f) => (Array.isArray(list) ? list : []).slice(0, 200).map(f).filter(x => SAFE_ID.test(x.id));
  const out = {
    units: pick(b.units, u => ({ id: s(u && u.id, 64), name: s(u && u.name, 80),
      members: pick(u && u.members, m => ({ id: s(m && m.id, 64), name: s(m && m.name, 80) })) })),
    projects: pick(b.projects, p => ({ id: s(p && p.id, 64), name: s(p && p.name, 80), status: s(p && p.status, 20) })),
    statuses: pick(b.statuses, x => ({ id: s(x && x.id, 64), name: s(x && x.name, 40) })),
    priorities: pick(b.priorities, x => ({ id: s(x && x.id, 64), name: s(x && x.name, 40) })),
    tasks: (Array.isArray(b.tasks) ? b.tasks : []).slice(0, 500).map(t => ({
      id: s(t && t.id, 64), title: s(t && t.title, 200), status: s(t && t.status, 20), units: idStrings(t && t.units), members: idStrings(t && t.members),
      priority: s(t && t.priority, 20), projectId: s(t && t.projectId, 64), startDate: s(t && t.startDate, 10), dueDate: s(t && t.dueDate, 10),
      description: s(t && t.description, 300), lastNote: s(t && t.lastNote, 200), due: s(t && t.due, 40)
    })).filter(t => SAFE_ID.test(t.id))
  };
  /* çok büyükse önce açıklamaları, sonra notları kısalt */
  for(const lim of [120, 40, 0]){
    if(JSON.stringify(out.tasks).length <= AI_MAX_BOARD) break;
    out.tasks.forEach(t => { t.description = t.description.slice(0, lim); t.lastNote = t.lastNote.slice(0, lim); });
  }
  return out;
}

function aiTools(board){
  const unitEnum = board.units.map(u => u.id), memberEnum = [].concat(...board.units.map(u => u.members.map(m => m.id))), statusEnum = board.statuses.map(x => x.id), prioEnum = board.priorities.map(x => x.id);
  const en = (list) => list.length ? { enum: list } : {};
  const date = { type: "string", description: "ISO tarih YYYY-AA-GG. Boş bırakmak için \"\"" };
  const fields = {
    title: { type: "string" },
    description: { type: "string", description: "Düz metin açıklama (satır sonları korunur)" },
    units: { type: "array", items: Object.assign({ type: "string" }, en(unitEnum)), description: "Sorumlu ekip id'leri (bir veya birden fazla). Güncellemede listenin tamamını gönder; çıkarılan ekiplerin çalışanları da işten çıkar." },
    members: { type: "array", items: Object.assign({ type: "string" }, en(memberEnum)), description: "Sorumlu çalışan id'leri (isteğe bağlı). Çalışanın ekibi otomatik eklenir. Güncellemede listenin tamamını gönder; boş dizi tüm çalışanları kaldırır." },
    priority: Object.assign({ type: "string" }, en(prioEnum)),
    projectId: { type: "string", description: "Proje id; projesiz için \"\"" },
    startDate: date, dueDate: date
  };
  return [
    { type: "function", function: { name: "create_tasks", description: "Bir veya birden fazla yeni iş kartı oluşturur.",
      parameters: { type: "object", required: ["tasks"], properties: { tasks: { type: "array", minItems: 1, items: { type: "object", required: ["title"],
        properties: Object.assign({}, fields, { status: Object.assign({ type: "string" }, en(statusEnum)), note: { type: "string", description: "İlk durum notu (isteğe bağlı)" } }) } } } } } },
    { type: "function", function: { name: "update_tasks", description: "Mevcut işlerin alanlarını günceller. Yalnızca değişecek alanları gönder.",
      parameters: { type: "object", required: ["updates"], properties: { updates: { type: "array", minItems: 1, items: { type: "object", required: ["id"],
        properties: Object.assign({ id: { type: "string" } }, fields, { add_note: { type: "string", description: "İşe yeni bir durum notu ekler" } }) } } } } } },
    { type: "function", function: { name: "move_tasks", description: "İşleri başka bir durum sütununa taşır.",
      parameters: { type: "object", required: ["moves"], properties: { moves: { type: "array", minItems: 1, items: { type: "object", required: ["id", "status"],
        properties: { id: { type: "string" }, status: Object.assign({ type: "string" }, en(statusEnum)) } } } } } } },
    { type: "function", function: { name: "list_tasks",
      description: "Panodaki aktif işleri filtreleyerek listeler (değişiklik yapmaz). 'Gecikmiş işler', 'bu hafta bitecekler', 'X projesindeki işler' gibi sorular için kullan. Filtre vermezsen tüm aktif işleri döner.",
      parameters: { type: "object", properties: {
        urgency: { type: "string", enum: ["overdue", "today", "soon", "attention"], description: "overdue: termini geçmiş; today: bugün bitiyor; soon: 1-3 gün içinde bitiyor; attention: üçü birden" },
        status: Object.assign({ type: "string" }, en(statusEnum)),
        unit: Object.assign({ type: "string", description: "Sorumlu ekip id" }, en(unitEnum)),
        member: Object.assign({ type: "string", description: "Sorumlu çalışan id" }, en(memberEnum)),
        projectId: { type: "string", description: "Proje id; projesiz işler için \"none\"" },
        priority: Object.assign({ type: "string" }, en(prioEnum)),
        due_before: { type: "string", description: "Bu tarihte (YYYY-AA-GG) veya öncesinde bitenler" },
        query: { type: "string", description: "Başlık/açıklamada geçen metin" }
      } } } },
    { type: "function", function: { name: "get_task", description: "Bir işin tam açıklamasını ve tüm notlarını okur (değişiklik yapmaz).",
      parameters: { type: "object", required: ["id"], properties: { id: { type: "string" } } } } }
  ];
}

/* "yarın = Perşembe 2026-11-05, Cuma 2026-11-06, …" — model gün adlarını takvimden okusun */
function upcomingDays(from){
  const pad = n => String(n).padStart(2, "0"), out = [];
  for(let i = 1; i <= 14; i++){
    const x = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i);
    out.push((i === 1 ? "yarın " : i <= 7 ? "" : "gelecek hafta ") + DAYS_TR[x.getDay()] + " " + x.getFullYear() + "-" + pad(x.getMonth() + 1) + "-" + pad(x.getDate()));
  }
  return out.join(", ");
}

function aiSystem(board){
  const d = new Date(), pad = n => String(n).padStart(2, "0");
  const iso = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  const list = (arr, f) => arr.map(f).join("\n") || "(yok)";
  const count = re => board.tasks.filter(t => re.test(t.due)).length;
  return [
    "Sen 'İş Takip' kanban panosunun asistanısın. Kullanıcının işlerini (kartlarını) listeler, oluşturur, düzenler ve taşırsın.",
    "Panodaki TÜM aktif işler bu mesajın sonundaki listede yer alıyor; ayrıca list_tasks aracıyla filtreleyerek sorgulayabilirsin.",
    "Kullanıcı iş listelemek, saymak veya özetlemek isterse list_tasks'ı kullan ya da listeden yanıtla. Asla 'listeleyemiyorum' deme. Eşleşen iş yoksa bunu açıkça söyle.",
    "Her işteki 'due' alanı termin durumunu hazır olarak verir: 'N gün gecikti' (gecikmiş), 'bugün bitiyor', 'yakında (N gün kaldı)', 'N gün kaldı'; boşsa termin yok ya da iş tamamlanmış/iptal. Gecikmeyi kendin hesaplama, bu alanı kullan.",
    "Kurallar:",
    "- Kullanıcının dilinde, kısa ve net yanıt ver. Markdown olarak yalnızca **kalın** ve '- ' ile başlayan listeler kullan.",
    "- Panoda değişiklik yapmak için YALNIZCA araçları kullan; araç çağırmadan bir değişikliği yaptığını söyleme.",
    "- İş id'lerini asla uydurma; aşağıdaki listedeki id'leri kullan. Kullanıcı bir işi adıyla anarsa listeden eşleştir; birden fazla aday varsa sor.",
    "- Beklemede, Devam Ediyor ve Tamamlandı durumları için başlangıç (startDate) ve bitiş (dueDate) tarihi zorunludur; Backlog ve İptal Edildi için gerekmez.",
    "- Kullanıcı vermediği bir tarihi ASLA uydurma (bugünü başlangıç/bitiş yapma dahil). Tarih gerekiyorsa kullanıcıya sor; isterken gg.aa.yyyy biçimini kullan, ISO biçimini ya da araç adlarını kullanıcıya söyleme.",
    "- Araç sonucundaki 'applied' 0 ise hiçbir değişiklik yapılmamıştır: kullanıcıya bunu ve nedenini söyle, 'yaptım' deme.",
    "- Araçlarda tarihleri ISO (YYYY-AA-GG) yaz; kullanıcıya tarihleri gg.aa.yyyy biçiminde söyle. 'Yarın', 'cuma' gibi ifadeleri bugünün tarihine göre hesapla.",
    "- İş silme ve arşivleme yapamazsın; istenirse kullanıcının bunu kartın üzerindeki butonlarla yapması gerektiğini söyle.",
    "- Araç sonucu bazı öğelerin atlandığını söylerse nedenini kullanıcıya açıkla veya düzeltip yeniden dene.",
    "- Değişiklikten sonraki özetinde YALNIZCA araç sonucundaki 'ok' listesinde dönen başlıkları say; listede olmayan işi değiştirdim deme.",
    "- Toplu isteklerde (ör. 'bugün bitecek işler') önce list_tasks ile doğru işleri bul, sonra o id'lerle değişiklik yap.",
    "- Bir istek belirsizse değişiklik yapmadan önce kısa bir soru sor. Ama kullanıcı sorumlu belirtmediyse sorma: ilk ekibi (" + (board.units[0] ? board.units[0].name : "varsayılan") + ") kullan; öncelik belirtilmediyse 'orta' kullan.",
    "- Bir işin birden fazla sorumlu ekibi ve çalışanı olabilir (units, members). Kullanıcı bir kişiyi adıyla anarsa onu members'a ekle (ekibi otomatik eklenir). Aynı adda birden fazla çalışan varsa hangisi olduğunu sor.",
    "- Kullanıcıya iş, proje, ekip veya çalışan id'lerini (ör. demo-t12, p1, oz) gösterme; adlarını kullan.",
    "- 'Cuma', 'gelecek pazartesi', 'yarın' gibi ifadeleri aşağıdaki takvimden oku; tarih hesabı yapma.",
    "",
    "Bugün: " + iso + " (" + DAYS_TR[d.getDay()] + ")",
    "Takvim (önümüzdeki 14 gün): " + upcomingDays(d),
    "Özet: " + board.tasks.length + " aktif iş; " + count(/gecikti/) + " gecikmiş, " + count(/^bugün/) + " bugün bitiyor, " + count(/^yakında/) + " yakında bitiyor (1-3 gün).",
    "",
    "Sorumlu ekipler ve çalışanları (id: ad):", list(board.units, u => "- " + u.id + ": " + u.name + (u.members.length ? " — çalışanlar: " + u.members.map(m => m.id + ": " + m.name).join(", ") : "")),
    "Projeler (id: ad):", list(board.projects, p => "- " + p.id + ": " + p.name + (p.status === "arsivlenmis" ? " (arşivlenmiş)" : "")),
    "Durumlar (id: ad):", list(board.statuses, x => "- " + x.id + ": " + x.name),
    "Öncelikler (id: ad):", list(board.priorities, x => "- " + x.id + ": " + x.name),
    "",
    "Panodaki aktif işler (JSON):",
    JSON.stringify(board.tasks)
  ].join("\n");
}

/* Yalnızca beklenen biçimdeki mesajlar modele gider */
function cleanMessages(list){
  if(!Array.isArray(list) || !list.length) throw Object.assign(new Error("Mesaj yok"), { status: 400 });
  return list.slice(-AI_MAX_MESSAGES).map(m => {
    if(!m || typeof m !== "object") throw Object.assign(new Error("Geçersiz mesaj"), { status: 400 });
    if(m.role === "user") return { role: "user", content: s(m.content, 8000) };
    if(m.role === "tool") return { role: "tool", tool_call_id: s(m.tool_call_id, 200), content: s(m.content, 20000) };
    if(m.role === "assistant"){
      const out = { role: "assistant", content: m.content == null ? "" : s(m.content, 8000) };
      if(Array.isArray(m.tool_calls) && m.tool_calls.length){
        out.tool_calls = m.tool_calls.slice(0, 20).map(c => ({
          id: s(c && c.id, 200), type: "function",
          function: { name: s(c && c.function && c.function.name, 64), arguments: s(c && c.function && c.function.arguments, 20000) }
        }));
      }
      return out;
    }
    throw Object.assign(new Error("Geçersiz mesaj rolü"), { status: 400 });
  });
}


async function aiChat(body){
  const cfg = resolveModel(body && s(body.modelId, 64));
  const board = cleanBoard(body && body.board);
  const messages = [{ role: "system", content: aiSystem(board) }].concat(cleanMessages(body && body.messages));
  const req = { model: cfg.model, messages, tools: aiTools(board), tool_choice: "auto", temperature: 0.2, max_tokens: 2000 };
  if(cfg.builtin) req.provider = { require_parameters: true };   // yalnızca araç çağırmayı destekleyen sağlayıcılar
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), cfg.timeout);
  let r, j;
  try{
    r = await fetch(cfg.url, { method: "POST", signal: ctrl.signal, headers: aiHeaders(cfg), body: JSON.stringify(req) });
    j = await r.json().catch(() => ({}));
  }catch(e){
    throw Object.assign(new Error(netError(e, cfg)), { status: 502 });
  }finally{ clearTimeout(timer); }
  const detail = j && j.error ? ": " + s(typeof j.error === "string" ? j.error : j.error.message, 300) : "";
  if(!r.ok){
    const map = cfg.builtin
      ? { 400: "İstek reddedildi", 401: "OpenRouter anahtarı geçersiz (.env)", 402: "OpenRouter bakiyesi yetersiz", 403: "OpenRouter isteği engelledi",
          404: "Model ya da araç desteği olan sağlayıcı bulunamadı", 408: "OpenRouter zaman aşımı", 429: "Çok fazla istek; biraz bekleyip tekrar deneyin" }
      : { 400: '"' + cfg.name + '" isteği reddetti (model araç çağırmayı — tools — desteklemiyor olabilir)', 401: '"' + cfg.name + '" anahtarı reddetti',
          403: '"' + cfg.name + '" anahtarı reddetti', 404: '"' + cfg.model + '" modeli bu sunucuda bulunamadı (model adını kontrol edin)', 429: "Çok fazla istek; biraz bekleyip tekrar deneyin" };
    throw Object.assign(new Error((map[r.status] || ('"' + cfg.name + '" hatası (HTTP ' + r.status + ")")) + detail), { status: 502 });
  }
  const msg = j && j.choices && j.choices[0] && j.choices[0].message;
  if(!msg) throw Object.assign(new Error('"' + cfg.name + '" boş yanıt döndü' + detail), { status: 502 });
  const out = { role: "assistant", content: stripThink(typeof msg.content === "string" ? msg.content : "") };
  if(Array.isArray(msg.tool_calls) && msg.tool_calls.length){
    out.tool_calls = msg.tool_calls.map(c => {
      const a = c.function && c.function.arguments;   // bazı yerel sunucular argümanı nesne olarak döndürür
      return { id: s(c.id, 200) || "call_" + crypto.randomBytes(6).toString("hex"), type: "function",
        function: { name: s(c.function && c.function.name, 64), arguments: (typeof a === "string" ? s(a, 20000) : a ? JSON.stringify(a).slice(0, 20000) : "") || "{}" } };
    });
  }
  return { message: out, modelName: cfg.builtin ? "OpenRouter · gpt-oss-120b" : cfg.name };
}

module.exports = { aiChat };
