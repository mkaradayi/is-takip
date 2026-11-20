/* Genel yardımcılar: DOM kısayolu, tarih biçimleri, kaçış, kimlik, indirme, tercihler */

export function $(id){ return document.getElementById(id); }
export function pad(n){ return n < 10 ? "0" + n : "" + n; }
export function isoOf(d){ return d.getFullYear() + "-" + pad(d.getMonth()+1) + "-" + pad(d.getDate()); }
export function todayISO(){ return isoOf(new Date()); }
export function parseISO(s){ var p = String(s || "").slice(0, 10).split("-"); return new Date(+p[0], +p[1]-1, +p[2]); }
export function daysBetween(a, b){ return Math.round((parseISO(b) - parseISO(a)) / 86400000); }
/* Ekranda her tarih gg.aa.yyyy; dosyada ISO (yyyy-aa-gg) */
export function fmtDate(iso){
  if(!iso) return "—";
  var d = parseISO(iso);
  if(isNaN(d)) return "—";
  return pad(d.getDate()) + "." + pad(d.getMonth()+1) + "." + d.getFullYear();
}
export function isoToTR(iso){ return iso ? fmtDate(iso) : ""; }
export function trToISO(s){
  var m = /^\s*(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})\s*$/.exec(s || "");
  if(!m) return "";
  var d = new Date(+m[3], +m[2]-1, +m[1]);
  if(d.getFullYear() !== +m[3] || d.getMonth() !== +m[2]-1 || d.getDate() !== +m[1]) return "";  // 31.02 gibi
  return isoOf(d);
}
export function maskDate(v){
  var d = String(v).replace(/\D/g, "").slice(0, 8);
  return d.length > 4 ? d.slice(0,2) + "." + d.slice(2,4) + "." + d.slice(4) : d.length > 2 ? d.slice(0,2) + "." + d.slice(2) : d;
}
export function relLabel(iso){
  if(!iso) return "—";
  var d = daysBetween(iso, todayISO());
  return d === 0 ? "Bugün" : d === 1 ? "Dün" : fmtDate(iso);
}
export function uid(){ return "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
/* "Ayşe Nur Kaya" → "AK" */
export function initials(name){
  var all = String(name || "").trim().split(/\s+/).filter(Boolean);
  var w = all.filter(function(x){ return /^\p{L}/u.test(x); });   // "Ali Kaya 2" → "AK" (sayılar atlanır)
  if(!w.length) w = all;
  if(!w.length) return "?";
  return (w[0].charAt(0) + (w.length > 1 ? w[w.length - 1].charAt(0) : "")).toLocaleUpperCase("tr");
}
export function esc(s){
  return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){
    return { "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c];
  });
}
export function timeLabel(){ var d = new Date(); return pad(d.getHours()) + ":" + pad(d.getMinutes()); }
export function fmtSize(n){
  n = +n || 0;
  return n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(0) + " KB" : (n / 1048576).toFixed(1).replace(".", ",") + " MB";
}
export function pref(key, val){
  try{
    if(val === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, val);
  }catch(e){ return null; }
}
export function download(name, blob){
  var a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(function(){ URL.revokeObjectURL(a.href); }, 1500);
}

