/* Seçili işlerden .eml mail taslağı */
import { Eml } from "../components/eml.js";
import { MAIL_ATT_WARN, PRIO_MAP, STATUS_MAP } from "../core/config.js";
import { dueText, latestNotes, urgencyGroup } from "../core/domain.js";
import { assigneeText, getProject, getUnit } from "../core/state.js";
import { showConfirm, showInfo, toast } from "../core/ui.js";
import { download, esc, fmtDate, fmtSize, pad, todayISO } from "../core/utils.js";

export var CID_DOMAIN = "@istakip";

export function fetchBytes(url){
  return fetch(url, { cache: "no-store" }).then(function(r){
    if(!r.ok) throw new Error("HTTP " + r.status);
    return r.arrayBuffer().then(function(b){ return { bytes: new Uint8Array(b), type: (r.headers.get("content-type") || "").split(";")[0] }; });
  });
}
export function inlineIds(html){
  var ids = [];
  String(html || "").replace(/\/api\/attachments\/([\w-]+)/g, function(_, id){ if(ids.indexOf(id) === -1) ids.push(id); return ""; });
  return ids;
}

export function mailRow(label, value){
  return '<tr><td style="padding:3px 12px 3px 0;color:#5B6472;font-size:12.5px;white-space:nowrap;vertical-align:top;width:110px">' + label + '</td>' +
    '<td style="padding:3px 0;font-size:13.5px;vertical-align:top">' + value + '</td></tr>';
}
export function mailTaskHtml(t, withAtt){
  var u = getUnit(t.units[0]), p = getProject(t.projectId), pr = PRIO_MAP[t.priority], st = STATUS_MAP[t.status];
  var g = urgencyGroup(t);
  var due = t.dueDate ? fmtDate(t.dueDate) + (g ? ' <span style="color:' + (g === "over" ? "#C2410C" : "#B45309") + ';font-weight:600">(' + dueText(t) + ')</span>' : "") : "";
  var rows = mailRow("Durum", esc(st.name)) +
    mailRow("Öncelik", '<span style="color:' + pr.hex + ';font-weight:600">' + esc(pr.name) + '</span>') +
    mailRow("Sorumlu", esc(assigneeText(t))) +
    (p ? mailRow("Proje", esc(p.name)) : "") +
    (t.startDate ? mailRow("Başlangıç", fmtDate(t.startDate)) : "") +
    (due ? mailRow("Termin", due) : "");
  var desc = t.descriptionHtml
    ? '<div style="margin-top:12px;padding-top:10px;border-top:1px solid #EAEDF2;font-size:13.5px">' +
        t.descriptionHtml   /* temizlenmiş HTML'de öznitelik yok; Outlook için satır içi stil eklenir */
          .replace(/<img src="\/api\/attachments\/([\w-]+)"/g, '<img style="max-width:100%;height:auto" src="cid:$1' + CID_DOMAIN + '"')
          .replace(/<table>/g, '<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:6px 0">')
          .replace(/<(td|th)>/g, '<$1 style="border:1px solid #D5DAE1;padding:4px 8px;font-size:13px;vertical-align:top">') + '</div>' : "";
  var notes = latestNotes(t, t.notes.length);
  var notesHtml = notes.length
    ? '<div style="margin-top:12px;padding-top:10px;border-top:1px solid #EAEDF2;font-size:12.5px;color:#5B6472;font-weight:600">Durum notları (' + notes.length + ')</div><ul style="margin:4px 0 0;padding-left:18px;font-size:13px">' +
      notes.map(function(n){ return '<li style="margin:3px 0"><span style="color:#8A93A3">' + fmtDate(n.date) + '</span> — ' + esc(n.text).replace(/\r?\n/g, "<br>") + '</li>'; }).join("") + '</ul>' : "";
  var atts = t.attachments.length
    ? '<div style="margin-top:12px;font-size:12.5px;color:#5B6472">Ekler' + (withAtt ? "" : " (bu maile eklenmedi)") + ': ' +
      t.attachments.map(function(a){ return esc(a.name); }).join(", ") + '</div>' : "";
  return '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;max-width:680px;border:1px solid #E1E6ED;border-left:4px solid ' + u.color + ';margin:0 0 16px;border-collapse:separate">' +
    '<tr><td style="padding:14px 16px">' +
    '<div style="font-size:16px;font-weight:700;margin:0 0 8px;color:#1A2233">' + esc(t.title) + '</div>' +
    '<table role="presentation" cellpadding="0" cellspacing="0">' + rows + '</table>' + desc + notesHtml + atts +
    '</td></tr></table>';
}
export function mailTaskText(t, withAtt){
  var p = getProject(t.projectId);
  var lines = [t.title, "Durum: " + STATUS_MAP[t.status].name, "Öncelik: " + PRIO_MAP[t.priority].name, "Sorumlu: " + assigneeText(t)];
  if(p) lines.push("Proje: " + p.name);
  if(t.startDate) lines.push("Başlangıç: " + fmtDate(t.startDate));
  if(t.dueDate) lines.push("Termin: " + fmtDate(t.dueDate) + (urgencyGroup(t) ? " (" + dueText(t) + ")" : ""));
  if(t.description) lines.push("", t.description);
  var notes = latestNotes(t, t.notes.length);
  if(notes.length){ lines.push("", "Durum notları (" + notes.length + "):"); notes.forEach(function(n){ lines.push("- " + fmtDate(n.date) + " — " + n.text.replace(/\r?\n/g, "\n  ")); }); }
  if(t.attachments.length) lines.push("", "Ekler" + (withAtt ? "" : " (eklenmedi)") + ": " + t.attachments.map(function(a){ return a.name; }).join(", "));
  return lines.join("\n");
}

export function mailTasks(tasks){
  if(!tasks.length) return;
  var total = 0;
  tasks.forEach(function(t){ t.attachments.forEach(function(a){ total += a.size; }); });
  if(total > MAIL_ATT_WARN){
    return showConfirm({
      title: "Ekler çok büyük",
      message: "Seçilen işlerin ekleri toplam " + fmtSize(total) + ". Outlook ve mail sunucuları genellikle 20–25 MB üstünü kabul etmez. Ekler olmadan da oluşturabilirsiniz (ek adları mailde listelenir).",
      confirmLabel: "Eklerle oluştur", cancelLabel: "Eksiz oluştur", danger: false,
      onConfirm: function(){ buildMail(tasks, true); },
      onCancel: function(){ buildMail(tasks, false); }
    });
  }
  buildMail(tasks, true);
}
export function buildMail(tasks, withAtt){
  toast("Mail taslağı hazırlanıyor…");
  var failed = [];
  var inlineJobs = [], attJobs = [];
  tasks.forEach(function(t){
    inlineIds(t.descriptionHtml).forEach(function(id){
      inlineJobs.push(fetchBytes("/api/attachments/" + id).then(function(r){
        return { cid: id + CID_DOMAIN, name: id + "." + ((r.type.split("/")[1] || "bin").replace(/\W/g, "")), type: r.type, bytes: r.bytes };
      }, function(){ failed.push("satır içi resim"); return null; }));
    });
    if(withAtt) t.attachments.forEach(function(a){
      attJobs.push(fetchBytes("/api/attachments/" + a.id).then(function(r){
        return { name: a.name, type: a.type || r.type, bytes: r.bytes };
      }, function(){ failed.push(a.name); return null; }));
    });
  });
  Promise.all([Promise.all(inlineJobs), Promise.all(attJobs)]).then(function(res){
    var single = tasks.length === 1;
    var subject = single ? "İş: " + tasks[0].title : "İş durumu – " + tasks.length + " iş (" + fmtDate(todayISO()) + ")";
    var intro = single ? "Aşağıdaki işin güncel durumu bilginize sunulur." : "Aşağıda " + tasks.length + " işin güncel durumu yer almaktadır.";
    var html = '<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#1A2233;line-height:1.5">' +
      '<p style="margin:0 0 6px">Merhaba,</p><p style="margin:0 0 16px">' + intro + '</p>' +
      tasks.map(function(t){ return mailTaskHtml(t, withAtt); }).join("") + '</div>';
    var text = "Merhaba,\n\n" + intro + "\n\n" + tasks.map(function(t){ return mailTaskText(t, withAtt); }).join("\n\n----------------------------------------\n\n");
    var eml = Eml.build({ subject: subject, html: html, text: text,
      inline: res[0].filter(Boolean), attachments: res[1].filter(Boolean) });
    var d = new Date();
    download("is-takip-mail-" + todayISO().replace(/-/g, "") + "-" + pad(d.getHours()) + pad(d.getMinutes()) + ".eml",
      new Blob([eml], { type: "message/rfc822" }));
    showInfo("Mail taslağı indirildi",
      "İndirilen .eml dosyasını açın; Outlook taslak olarak açacak. Alıcıları ekleyip gönderebilirsiniz." +
      (failed.length ? " Uyarı: şu dosyalar okunamadığı için eklenmedi: " + failed.join(", ") + "." : ""));
  }).catch(function(e){ toast("Mail taslağı oluşturulamadı: " + e.message, true); });
}

