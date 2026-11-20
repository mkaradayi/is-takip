/* Pano AI asistanı köprüsü: pano özeti, araçların uygulanması, geri alma */
import { AiChat } from "../components/ai-chat.js";
import { AiModels } from "../components/ai-models.js";
import { RichEditor } from "../components/editor.js";
import { PRIORITIES, PRIO_MAP, STATUSES, STATUS_MAP } from "../core/config.js";
import { latestNotes, needsDates, searchKey, urgency, urgencyGroup } from "../core/domain.js";
import { anyOverlayOpen } from "../core/overlays.js";
import { switchView } from "../core/render.js";
import { MEMBER_MAP, TIME_RE, UNIT_MAP, assigneeText, findArchived, findMemo, findReminder, findTask, fixAssignees, getMember, getProject, getUnit, normalizeMemo, normalizeNote, normalizeReminder, normalizeTask, state, str } from "../core/state.js";
import { commit } from "../core/storage.js";
import { showConfirm, toast } from "../core/ui.js";
import { $, daysBetween, fmtDate, todayISO, trToISO, uid } from "../core/utils.js";
import { openModal } from "../modals/task-modal.js";
import { remGroup, remSort, remWhen } from "../views/reminders.js";

/* components/ai-chat.js araç çağrılarını buradan uygular.
   Her değişiklik elle yapılanla aynı yoldan geçer: doğrula → state → commit (çakışma kontrolü dahil). */
export var aiUndoLog = {};

export function aiBoardSnapshot(){
  return {
    units: state.units.map(function(u){ return { id: u.id, name: u.name, members: u.members.filter(function(m){ return m.active; }).map(function(m){ return { id: m.id, name: m.name }; }) }; }),
    projects: state.projects.map(function(p){ return { id: p.id, name: p.name, status: p.status }; }),
    statuses: STATUSES.map(function(x){ return { id: x.id, name: x.name }; }),
    priorities: PRIORITIES.map(function(x){ return { id: x.id, name: x.name }; }),
    /* açık hatırlatmalar (en yakın 20) ve not sayısı; notların metni gönderilmez (gerekirse list_memos) */
    reminderCount: state.reminders.filter(function(r){ return !r.done; }).length,
    reminders: state.reminders.filter(function(r){ return !r.done; }).sort(remSort).slice(0, 20).map(function(r){
      return { id: r.id, text: r.text.slice(0, 120), date: r.date, time: r.time, taskId: r.taskId, when: remWhen(r) };
    }),
    memoCount: state.memos.length,
    tasks: state.tasks.map(function(t){
      var n = latestNotes(t, 1)[0];
      return { id: t.id, title: t.title, status: t.status, units: t.units, members: t.members, priority: t.priority, projectId: t.projectId,
        startDate: t.startDate, dueDate: t.dueDate, due: aiDueText(t), description: t.description.slice(0, 300), lastNote: n ? n.text.slice(0, 200) : "" };
    })
  };
}
/* Modelin tarih hesabı yapmasına gerek kalmasın diye termin durumu hazır metin olarak verilir */
export function aiDueText(t){
  var u = urgency(t);
  if(u === "done" || u === "cancelled" || !t.dueDate) return "";
  var d = daysBetween(todayISO(), t.dueDate);
  if(u === "over") return Math.abs(d) + " gün gecikti";
  if(d === 0) return "bugün bitiyor";
  if(u === "soon") return "yakında (" + d + " gün kaldı)";
  return d + " gün kaldı";
}
export var AI_URGENCY = { overdue: ["over"], today: ["today"], soon: ["soon"], attention: ["over", "today", "soon"] };
export function aiListTasks(a){
  var q = str(a.query).toLocaleLowerCase("tr"), groups = AI_URGENCY[a.urgency];
  var due = aiDate(a.due_before);
  var list = state.tasks.filter(function(t){
    if(groups && groups.indexOf(urgencyGroup(t)) === -1) return false;
    if(a.status && t.status !== a.status) return false;
    if(a.unit && t.units.indexOf(resolveUnit(a.unit)) === -1) return false;
    if(a.member && t.members.indexOf(resolveMember(a.member)) === -1) return false;
    if(a.priority && t.priority !== a.priority) return false;
    if(a.projectId === "none" && t.projectId) return false;
    if(a.projectId && a.projectId !== "none" && t.projectId !== a.projectId) return false;
    if(due && (!t.dueDate || t.dueDate > due)) return false;
    if(q && (t.title + " " + t.description).toLocaleLowerCase("tr").indexOf(q) === -1) return false;
    return true;
  }).sort(function(x, y){ return (x.dueDate || "9999").localeCompare(y.dueDate || "9999"); });
  return { count: list.length, tasks: list.slice(0, 100).map(function(t){
    var p = getProject(t.projectId);
    return { id: t.id, title: t.title, status: STATUS_MAP[t.status].name, assignees: assigneeText(t), priority: PRIO_MAP[t.priority].name,
      project: p ? p.name : "", dueDate: t.dueDate, due: aiDueText(t) };
  }) };
}
/* Ekip / çalışan: id ya da ad (Türkçe harf duyarsız) kabul edilir; bulunamazsa "" */
export function resolveUnit(v){
  v = str(v).trim(); if(UNIT_MAP[v]) return v;
  var k = searchKey(v), u = state.units.filter(function(x){ return searchKey(x.name) === k; })[0];
  return u ? u.id : "";
}
export function resolveMember(v){
  v = str(v).trim(); if(MEMBER_MAP[v]) return v;
  var k = searchKey(v), all = Object.keys(MEMBER_MAP).map(function(id){ return MEMBER_MAP[id]; });
  var m = all.filter(function(x){ return searchKey(x.name) === k; });
  if(!m.length) m = all.filter(function(x){ return searchKey(x.name).split(/\s+/)[0] === k; });   // yalnızca ad: "Ayşe"
  return m.length === 1 ? m[0].id : "";
}
/* Araç argümanındaki units / members (eski "unit" de kabul) → { units, members, changed } ya da { error }.
   t verilirse güncellemedir: gönderilmeyen alan korunur; ekip listesi değişirse dışarıda kalan ekiplerin çalışanları çıkarılır. */
export function aiAssignees(a, t){
  var uIn = a.units !== undefined ? a.units : a.unit !== undefined ? [a.unit] : undefined, mIn = a.members;
  if(uIn !== undefined && !Array.isArray(uIn)) uIn = [uIn];
  if(mIn !== undefined && !Array.isArray(mIn)) mIn = [mIn];
  if(t && uIn === undefined && mIn === undefined) return { changed: false };
  var units = [], members = [], bad = [];
  (uIn || []).forEach(function(v){ var id = resolveUnit(v); if(id) units.push(id); else bad.push("ekip bulunamadı (" + str(v) + ")"); });
  (mIn || []).forEach(function(v){ var id = resolveMember(v); if(id) members.push(id); else bad.push("çalışan bulunamadı ya da birden fazla eşleşme var (" + str(v) + ")"); });
  if(bad.length) return { error: bad.join("; ") };
  if(t){
    if(uIn === undefined) units = t.units.slice();
    if(mIn === undefined) members = t.members.filter(function(m){ return units.indexOf(getMember(m).unitId) !== -1; });
  }
  var f = fixAssignees(units, members);
  return { units: f.units, members: f.members, changed: true };
}
export function clone(o){ return JSON.parse(JSON.stringify(o)); }
/* undefined: alan gönderilmedi · "": temizle · ISO: geçerli · null: geçersiz */
export function aiDate(v){
  if(v === undefined || v === null) return undefined;
  v = String(v).trim();
  if(!v) return "";
  if(/^\d{4}-\d{2}-\d{2}$/.test(v)) return trToISO(fmtDate(v)) === v ? v : null;
  return trToISO(v) || null;
}
export function aiNote(text){ return normalizeNote({ id: uid(), text: str(text).trim(), date: todayISO(), createdAt: new Date().toISOString() }); }
export function aiSetDesc(t, text){ t.descriptionHtml = RichEditor.fromPlain(str(text)); t.description = RichEditor.toPlain(t.descriptionHtml); }
/* Tarih kuralı: Backlog dışında başlangıç + bitiş zorunlu, bitiş başlangıçtan önce olamaz. Hata metni ya da "" döner. */
export function aiDateRule(status, start, due){
  if(needsDates(status) && (!start || !due)) return STATUS_MAP[status].name + " durumu için başlangıç ve bitiş tarihi gerekli";
  if(start && due && due < start) return "bitiş tarihi başlangıçtan önce olamaz";
  return "";
}

export function aiApply(calls){
  var res = { results: [], summary: { created: [], updated: [], moved: [], skipped: [], reminders: [], memos: [] }, token: null };
  /* geri alma kaydı tür başına: değişmeden önceki kopya + oluşturulanların id'leri */
  var before = { tasks: {}, reminders: {}, memos: {} }, created = { tasks: [], reminders: [], memos: [] };
  var locked = anyOverlayOpen();
  var remember = function(t, kind){ kind = kind || "tasks"; if(!(t.id in before[kind]) && created[kind].indexOf(t.id) === -1) before[kind][t.id] = clone(t); };
  var label = function(t){ return '"' + t.title + '"'; };

  (calls || []).forEach(function(call){
    var name = call && call.function && call.function.name, args, ok = [], skipped = [];
    var skip = function(who, why){ skipped.push(who + ": " + why); res.summary.skipped.push(who + ": " + why); };
    try{ args = JSON.parse((call.function && call.function.arguments) || "{}") || {}; }
    catch(e){ res.results.push({ tool_call_id: call.id, content: JSON.stringify({ error: "Argümanlar geçerli JSON değil" }) }); return; }

    if(name === "list_tasks"){
      res.results.push({ tool_call_id: call.id, content: JSON.stringify(aiListTasks(args)) });
      return;
    }
    if(name === "list_reminders" || name === "list_memos"){
      res.results.push({ tool_call_id: call.id, content: JSON.stringify(name === "list_reminders" ? aiListReminders(args) : aiListMemos(args)) });
      return;
    }
    if(name === "get_task"){
      var g = findTask(str(args.id));
      res.results.push({ tool_call_id: call.id, content: JSON.stringify(g ? {
        id: g.id, title: g.title, status: g.status, units: g.units, members: g.members, assignees: assigneeText(g), priority: g.priority, projectId: g.projectId,
        startDate: g.startDate, dueDate: g.dueDate, createdAt: g.createdAt, description: g.description,
        notes: g.notes.map(function(n){ return { date: n.date, text: n.text }; }), attachments: g.attachments.map(function(a){ return a.name; })
      } : { error: "Bu id ile aktif iş yok" }) });
      return;
    }
    if((/reminders$/.test(name) && state.remEditing) || (/memos$/.test(name) && state.memoEditing)){
      res.results.push({ tool_call_id: call.id, content: JSON.stringify({ error: "Kullanıcı şu anda bir " + (/memos$/.test(name) ? "notu" : "hatırlatmayı") + " düzenliyor. Değişiklik yapılmadı; düzenlemeyi bitirmesini isteyip sonra tekrar dene." }) });
      return;
    }
    if(locked){
      res.results.push({ tool_call_id: call.id, content: JSON.stringify({ error: "Kullanıcının ekranında açık bir pencere var (iş düzenleme veya onay). Değişiklik yapılmadı; kullanıcıdan pencereyi kapatıp isteği tekrarlamasını iste." }) });
      return;
    }

    if(name === "create_tasks"){
      (Array.isArray(args.tasks) ? args.tasks : []).forEach(function(it, i){
        it = it || {};
        var who = "yeni iş #" + (i + 1), title = str(it.title).trim().slice(0, 300);
        if(!title) return skip(who, "başlık boş");
        who = '"' + title + '"';
        var asg = aiAssignees(it, null);
        if(asg.error) return skip(who, asg.error);
        var prio = it.priority ? str(it.priority) : "orta";
        if(!PRIO_MAP[prio]) return skip(who, "geçersiz öncelik (" + prio + ")");
        var status = it.status ? str(it.status) : "backlog";
        if(!STATUS_MAP[status]) return skip(who, "geçersiz durum (" + status + ")");
        var pid = it.projectId ? str(it.projectId) : "";
        if(pid && !getProject(pid)) return skip(who, "proje bulunamadı (" + pid + ")");
        var start = aiDate(it.startDate), due = aiDate(it.dueDate);
        if(start === null || due === null) return skip(who, "tarih geçersiz (YYYY-AA-GG olmalı)");
        var rule = aiDateRule(status, start || "", due || "");
        if(rule) return skip(who, rule);
        var t = normalizeTask({ id: uid(), title: title, units: asg.units, members: asg.members, priority: prio, status: status, projectId: pid,
          startDate: start || "", dueDate: due || "", createdAt: todayISO(), updatedAt: todayISO(),
          descriptionHtml: RichEditor.fromPlain(str(it.description)), notes: it.note && str(it.note).trim() ? [aiNote(it.note)] : [] });
        state.tasks.push(t); created.tasks.push(t.id);
        ok.push({ id: t.id, title: t.title }); res.summary.created.push({ id: t.id, title: t.title });
      });
    }
    else if(name === "update_tasks"){
      (Array.isArray(args.updates) ? args.updates : []).forEach(function(u){
        u = u || {};
        var t = findTask(str(u.id));
        if(!t) return skip(str(u.id) || "(id yok)", "aktif iş bulunamadı (arşivde ya da silinmiş olabilir)");
        var who = label(t);
        if(u.title !== undefined && !str(u.title).trim()) return skip(who, "başlık boş olamaz");
        var asg = aiAssignees(u, t);
        if(asg.error) return skip(who, asg.error);
        if(u.priority !== undefined && !PRIO_MAP[str(u.priority)]) return skip(who, "geçersiz öncelik (" + u.priority + ")");
        if(u.projectId !== undefined && str(u.projectId) && !getProject(str(u.projectId))) return skip(who, "proje bulunamadı (" + u.projectId + ")");
        var start = aiDate(u.startDate), due = aiDate(u.dueDate);
        if(start === null || due === null) return skip(who, "tarih geçersiz (YYYY-AA-GG olmalı)");
        var rule = aiDateRule(t.status, start === undefined ? t.startDate : start, due === undefined ? t.dueDate : due);
        if(rule) return skip(who, rule);
        remember(t);
        if(u.title !== undefined) t.title = str(u.title).trim().slice(0, 300);
        if(u.description !== undefined) aiSetDesc(t, u.description);
        if(asg.changed){ t.units = asg.units; t.members = asg.members; }
        if(u.priority !== undefined) t.priority = str(u.priority);
        if(u.projectId !== undefined) t.projectId = str(u.projectId);
        if(start !== undefined) t.startDate = start;
        if(due !== undefined) t.dueDate = due;
        if(u.add_note && str(u.add_note).trim()) t.notes.push(aiNote(u.add_note));
        t.updatedAt = todayISO();
        ok.push({ id: t.id, title: t.title }); res.summary.updated.push({ id: t.id, title: t.title });
      });
    }
    else if(name === "move_tasks"){
      (Array.isArray(args.moves) ? args.moves : []).forEach(function(m){
        m = m || {};
        var t = findTask(str(m.id)), st = str(m.status);
        if(!t) return skip(str(m.id) || "(id yok)", "aktif iş bulunamadı");
        var who = label(t);
        if(!STATUS_MAP[st]) return skip(who, "geçersiz durum (" + st + ")");
        if(t.status === st) return skip(who, "zaten " + STATUS_MAP[st].name + " durumunda");
        var rule = aiDateRule(st, t.startDate, t.dueDate);
        if(rule) return skip(who, rule + " (önce işe tarih eklenmeli)");
        remember(t);
        t.status = st; t.updatedAt = todayISO();
        ok.push({ id: t.id, title: t.title, status: STATUS_MAP[st].name }); res.summary.moved.push({ id: t.id, title: t.title, status: STATUS_MAP[st].name });
      });
    }
    else if(name === "create_reminders" || name === "update_reminders" || name === "create_memos" || name === "update_memos"){
      aiApplyPersonal(name, args, { ok: ok, skip: skip, remember: remember, created: created, summary: res.summary });
    }
    else {
      res.results.push({ tool_call_id: call.id, content: JSON.stringify({ error: "Bilinmeyen araç: " + name }) });
      return;
    }
    var out = { applied: ok.length, ok: ok, skipped: skipped };
    if(!ok.length) out.warning = "HİÇBİR DEĞİŞİKLİK YAPILMADI. Kullanıcıya yapılamadığını ve nedenini açıkça söyle; 'yaptım' deme. Eksik bilgi (ör. tarih) uydurma, kullanıcıya sor.";
    else if(skipped.length) out.warning = "Yalnızca 'ok' listesindekiler uygulandı; 'skipped' listesindekiler UYGULANMADI, kullanıcıya söyle.";
    res.results.push({ tool_call_id: call.id, content: JSON.stringify(out) });
  });

  var s = res.summary, parts = [];
  var count = function(list, action){ return list.filter(function(x){ return x.action === action; }).length; };
  if(s.created.length) parts.push(s.created.length + " iş oluşturuldu");
  if(s.updated.length) parts.push(s.updated.length + " iş güncellendi");
  if(s.moved.length) parts.push(s.moved.length + " iş taşındı");
  if(count(s.reminders, "created")) parts.push(count(s.reminders, "created") + " hatırlatma eklendi");
  if(count(s.reminders, "updated")) parts.push(count(s.reminders, "updated") + " hatırlatma güncellendi");
  if(count(s.memos, "created")) parts.push(count(s.memos, "created") + " not eklendi");
  if(count(s.memos, "updated")) parts.push(count(s.memos, "updated") + " not güncellendi");
  if(parts.length){
    var kinds = ["tasks", "reminders", "memos"].filter(function(k){ return created[k].length || Object.keys(before[k]).length; });
    res.token = "u" + uid();
    aiUndoLog[res.token] = { before: before, created: created, kinds: kinds };
    commit(kinds, "AI: " + parts.join(", "));
  }
  s.text = parts.join(" · ");
  return res;
}

/* ---------- Hatırlatmalar ve Notlarım (silme yok) ---------- */
/* undefined: gönderilmedi · "": temizle · "HH:MM": geçerli · null: geçersiz */
export function aiTime(v){
  if(v === undefined || v === null) return undefined;
  v = str(v).trim();
  if(!v) return "";
  if(/^\d:\d\d$/.test(v)) v = "0" + v;
  return TIME_RE.test(v) ? v : null;
}
/* İş bağlantısı: "" bağlantıyı kaldırır; yalnızca panodaki aktif işlere bağlanır. null: geçersiz */
export function aiTaskRef(v){
  if(v === undefined || v === null) return undefined;
  v = str(v).trim();
  if(!v) return "";
  return findTask(v) ? v : null;
}
function remInfo(r){
  var t = r.taskId ? findTask(r.taskId) || findArchived(r.taskId) : null;
  return { id: r.id, text: r.text.slice(0, 300), date: r.date, time: r.time, when: remWhen(r), done: r.done, task: t ? t.title : "" };
}
export function aiListReminders(a){
  var st = str(a.status) || "open", q = searchKey(str(a.query).trim()), g = str(a.group), tid = str(a.taskId);
  var list = state.reminders.filter(function(r){
    if(st === "open" && r.done) return false;
    if(st === "done" && !r.done) return false;
    if(g && remGroup(r) !== g) return false;
    if(tid && r.taskId !== tid) return false;
    if(q && searchKey(r.text).indexOf(q) === -1) return false;
    return true;
  }).sort(remSort);
  return { count: list.length, reminders: list.slice(0, 100).map(remInfo) };
}
export function aiListMemos(a){
  var q = searchKey(str(a.query).trim()), tid = str(a.taskId), lim = Math.max(1, Math.min(50, +a.limit || 20));
  var list = state.memos.filter(function(m){
    if(tid && m.taskId !== tid) return false;
    if(q && searchKey(m.text).indexOf(q) === -1) return false;
    return true;
  }).sort(function(x, y){ return y.updatedAt.localeCompare(x.updatedAt); });
  return { count: list.length, memos: list.slice(0, lim).map(function(m){
    var t = m.taskId ? findTask(m.taskId) || findArchived(m.taskId) : null;
    return { id: m.id, text: m.text.slice(0, 500) + (m.text.length > 500 ? "…" : ""), task: t ? t.title : "", updated: m.updatedAt.slice(0, 10) };
  }) };
}
/* create/update_reminders, create/update_memos: öğe öğe doğrular; geçerliler state'e yazılır (commit aiApply'da, tek seferde) */
function aiApplyPersonal(name, args, x){
  var now = new Date().toISOString();
  var short = function(t){ t = str(t).trim().split("\n")[0]; return '"' + (t.length > 60 ? t.slice(0, 60) + "…" : t) + '"'; };
  if(name === "create_reminders"){
    (Array.isArray(args.reminders) ? args.reminders : []).forEach(function(it, i){
      it = it || {};
      var text = str(it.text).trim().slice(0, 2000), who = text ? short(text) : "hatırlatma #" + (i + 1);
      if(!text) return x.skip(who, "metin boş");
      var date = aiDate(it.date);
      if(date === null) return x.skip(who, "tarih geçersiz (YYYY-AA-GG olmalı)");
      if(!date) return x.skip(who, "tarih gerekli; kullanıcıya sor, uydurma");
      var time = aiTime(it.time);
      if(time === null) return x.skip(who, "saat geçersiz (SS:DD olmalı)");
      var tid = aiTaskRef(it.taskId);
      if(tid === null) return x.skip(who, "bağlanacak aktif iş bulunamadı (" + str(it.taskId) + ")");
      var r = normalizeReminder({ id: uid(), text: text, date: date, time: time || "", taskId: tid || "", done: false, doneAt: "", createdAt: now });
      state.reminders.push(r); x.created.reminders.push(r.id);
      /* ok listesinde id yok: model yanıtında kimlik tekrarlamasın (gerekirse list_reminders / list_memos ile bulur) */
      x.ok.push({ text: r.text.slice(0, 80), when: remWhen(r) });
      x.summary.reminders.push({ id: r.id, text: r.text, when: remWhen(r), action: "created" });
    });
  }
  else if(name === "update_reminders"){
    (Array.isArray(args.updates) ? args.updates : []).forEach(function(u){
      u = u || {};
      var r = findReminder(str(u.id));
      if(!r) return x.skip(str(u.id) || "(id yok)", "hatırlatma bulunamadı");
      var who = short(r.text);
      if(u.text !== undefined && !str(u.text).trim()) return x.skip(who, "metin boş olamaz");
      var date = aiDate(u.date);
      if(date === null) return x.skip(who, "tarih geçersiz (YYYY-AA-GG olmalı)");
      if(date === "") return x.skip(who, "hatırlatmanın tarihi silinemez");
      var time = aiTime(u.time);
      if(time === null) return x.skip(who, "saat geçersiz (SS:DD olmalı)");
      var tid = aiTaskRef(u.taskId);
      if(tid === null) return x.skip(who, "bağlanacak aktif iş bulunamadı (" + str(u.taskId) + ")");
      var done = u.done === undefined ? undefined : (u.done === true || u.done === "true");
      x.remember(r, "reminders");
      if(u.text !== undefined) r.text = str(u.text).trim().slice(0, 2000);
      if(date !== undefined) r.date = date;
      if(time !== undefined) r.time = time;
      if(tid !== undefined) r.taskId = tid;
      if(done !== undefined && done !== r.done){ r.done = done; r.doneAt = done ? now : ""; }
      x.ok.push({ text: r.text.slice(0, 80), when: remWhen(r), done: r.done });
      x.summary.reminders.push({ id: r.id, text: r.text, when: remWhen(r) + (r.done ? " · tamamlandı" : ""), action: "updated" });
    });
  }
  else if(name === "create_memos"){
    (Array.isArray(args.memos) ? args.memos : []).forEach(function(it, i){
      it = it || {};
      var text = str(it.text).trim().slice(0, 5000), who = text ? short(text) : "not #" + (i + 1);
      if(!text) return x.skip(who, "metin boş");
      var tid = aiTaskRef(it.taskId);
      if(tid === null) return x.skip(who, "bağlanacak aktif iş bulunamadı (" + str(it.taskId) + ")");
      var m = normalizeMemo({ id: uid(), text: text, taskId: tid || "", createdAt: now, updatedAt: now });
      state.memos.push(m); x.created.memos.push(m.id);
      x.ok.push({ text: m.text.slice(0, 80) });
      x.summary.memos.push({ id: m.id, text: m.text, action: "created" });
    });
  }
  else if(name === "update_memos"){
    (Array.isArray(args.updates) ? args.updates : []).forEach(function(u){
      u = u || {};
      var m = findMemo(str(u.id));
      if(!m) return x.skip(str(u.id) || "(id yok)", "not bulunamadı");
      var who = short(m.text);
      if(u.text !== undefined && !str(u.text).trim()) return x.skip(who, "metin boş olamaz");
      var tid = aiTaskRef(u.taskId);
      if(tid === null) return x.skip(who, "bağlanacak aktif iş bulunamadı (" + str(u.taskId) + ")");
      var text = u.text !== undefined ? str(u.text).trim().slice(0, 5000) : m.text;
      if(text === m.text && (tid === undefined || tid === m.taskId)) return x.skip(who, "değişiklik yok");
      x.remember(m, "memos");
      m.text = text; if(tid !== undefined) m.taskId = tid; m.updatedAt = now;
      x.ok.push({ text: m.text.slice(0, 80) });
      x.summary.memos.push({ id: m.id, text: m.text, action: "updated" });
    });
  }
}

/* Bir AI adımını geri alır: oluşturulanları kaldırır, değişenleri önceki haline döndürür (iş, hatırlatma, not) */
var UNDO_FIND = { tasks: findTask, reminders: findReminder, memos: findMemo };
export function aiUndo(token){
  var u = aiUndoLog[token];
  if(!u) return { ok: false, error: "Bu adım zaten geri alınmış" };
  if(anyOverlayOpen()) return { ok: false, error: "Önce açık pencereyi kapatın" };
  if((u.kinds.indexOf("reminders") !== -1 && state.remEditing) || (u.kinds.indexOf("memos") !== -1 && state.memoEditing)) return { ok: false, error: "Önce açık düzenlemeyi bitirin" };
  var missing = 0;
  u.kinds.forEach(function(k){
    var find = UNDO_FIND[k];
    u.created[k].forEach(function(id){ if(!find(id)) missing++; });
    state[k] = state[k].filter(function(x){ return u.created[k].indexOf(x.id) === -1; });
    Object.keys(u.before[k]).forEach(function(id){
      var x = find(id);
      if(!x){ missing++; return; }
      Object.keys(x).forEach(function(key){ delete x[key]; });
      Object.assign(x, clone(u.before[k][id]));
    });
  });
  delete aiUndoLog[token];
  commit(u.kinds, "AI değişikliği geri alındı");
  return { ok: true, missing: missing };
}

/* Olay bağlama (main.js → bind) */
export function bindAiBridge(){
  /* AI asistan paneli + model ayarları */
  AiModels.init({ confirm: showConfirm, toast: toast });
  AiChat.init({
    getBoard: aiBoardSnapshot,
    applyTools: aiApply,
    undo: aiUndo,
    openView: function(v){ switchView(v); },
    openTask: function(id){
      if(!findTask(id)) return toast("Bu iş artık panoda değil", true);
      if(state.view !== "board") switchView("board");
      openModal(id);
    }
  });
}
