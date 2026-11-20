/* Saati gelen hatırlatmalar için bildirim */
import { renderAll, switchView } from "../core/render.js";
import { state } from "../core/state.js";
import { toast } from "../core/ui.js";
import { pad, todayISO } from "../core/utils.js";

/* Saati gelen hatırlatmalar: sayfa açıkken 30 sn'de bir bakılır; her biri oturumda bir kez bildirilir */
var remNotified = {}, remLastDay = todayISO(), remTimer = null;
export function startReminderTimer(){
  checkReminderTimes();
  if(!remTimer) remTimer = setInterval(checkReminderTimes, 30000);
}
export function checkReminderTimes(){
  var now = new Date(), today = todayISO(), hm = pad(now.getHours()) + ":" + pad(now.getMinutes());
  if(today !== remLastDay){ remLastDay = today; renderAll(); }   // gün döndü: gruplar ve rozetler güncellensin
  var fired = state.reminders.filter(function(r){
    var key = r.id + "|" + r.date + "|" + r.time;
    if(r.done || !r.time || r.date !== today || r.time > hm || remNotified[key]) return false;
    remNotified[key] = true; return true;
  });
  if(!fired.length) return;
  toast(fired.length === 1 ? "🔔 " + fired[0].time + " · " + fired[0].text.slice(0, 140) : "🔔 " + fired.length + " hatırlatmanın saati geldi");
  if(window.Notification && Notification.permission === "granted"){
    fired.forEach(function(r){
      try{
        var n = new Notification("İş Takip — hatırlatma", { body: r.time + " · " + r.text.slice(0, 200), tag: "rem-" + r.id });
        n.onclick = function(){ window.focus(); switchView("reminders"); n.close(); };
      }catch(e){}
    });
  }
}

