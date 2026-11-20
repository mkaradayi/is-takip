/* Ortak arayüz parçaları: bildirim (toast), onay/bilgi penceresi, arka plan kapatma, tarih alanı */
import { $, esc, isoToTR, maskDate, trToISO } from "./utils.js";

export var toastTimer = null;
export function toast(msg, isError){
  var t = $("toast");
  $("toastMsg").textContent = msg;
  t.style.background = isError ? "#7A2E17" : "";
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function(){ t.classList.remove("show"); }, isError ? 5000 : 2400);
}

/* Tarayıcının yerleşik confirm()/alert() penceresi yerine kendi modal'ımız.
   o.select = { label, options:[{id,name}], value } verilirse seçilen değer onConfirm(value)'ya geçer. */
export var confirmCb = null, cancelCb = null;
export function showConfirm(o){
  $("confirmTitle").textContent = o.title || "Emin misiniz?";
  $("confirmMessage").textContent = o.message || "";
  var ok = $("confirmOkBtn"), cancel = $("confirmCancelBtn");
  ok.textContent = o.confirmLabel || "Onayla";
  cancel.textContent = o.cancelLabel || "Vazgeç";
  var col = o.danger === false ? "var(--accent)" : "var(--danger)";
  ok.style.background = col; ok.style.borderColor = col;
  cancel.style.display = o.hideCancel ? "none" : "inline-flex";
  var sw = $("confirmSelectWrap");
  if(o.select){
    $("confirmSelectLabel").textContent = o.select.label || "Seçin";
    $("confirmSelect").innerHTML = o.select.options.map(function(x){ return '<option value="' + esc(x.id) + '">' + esc(x.name) + '</option>'; }).join("");
    if(o.select.value != null) $("confirmSelect").value = o.select.value;
    sw.style.display = "flex";
  } else sw.style.display = "none";
  confirmCb = o.onConfirm || null; cancelCb = o.onCancel || null;
  $("confirmOverlay").classList.add("show");
}
export function closeConfirm(){ $("confirmOverlay").classList.remove("show"); confirmCb = null; cancelCb = null; }
export function showInfo(title, message){
  showConfirm({ title:title, message:message, confirmLabel:"Tamam", danger:false, hideCancel:true });
}

/* Yalnızca fare hem basılıp hem bırakıldığında arka plandaysa kapatır.
   (Modal içinde metin seçerken fare dışarı taşınca "click" arka plana düşüyordu.) */
export function bindBackdropClose(el, onClose){
  var downOnBackdrop = false;
  el.addEventListener("mousedown", function(e){ downOnBackdrop = e.target === el; });
  el.addEventListener("click", function(e){
    var ok = downOnBackdrop && e.target === el;
    downOnBackdrop = false;
    if(ok) onClose();
  });
}

export function bindDateField(id){
  var inp = $(id), picker = $(id + "Picker");
  inp.addEventListener("input", function(e){
    if(e.inputType && e.inputType.indexOf("delete") === 0) return;   // silerken noktayı geri ekleme
    inp.value = maskDate(inp.value);
  });
  inp.addEventListener("blur", function(){
    var iso = trToISO(inp.value);
    if(iso) inp.value = isoToTR(iso);                                 // 4.11.2026 → 04.11.2026
    inp.classList.toggle("invalid", !!inp.value.trim() && !iso);
  });
  picker.addEventListener("change", function(){
    if(picker.value){ inp.value = isoToTR(picker.value); inp.classList.remove("invalid"); }
  });
}
export function openPicker(id){
  var picker = $(id + "Picker");
  picker.value = trToISO($(id).value) || "";
  try{ if(picker.showPicker){ picker.showPicker(); return; } }catch(e){}
  picker.focus(); picker.click();
}

/* Olay bağlama (main.js → bind) */
export function bindUi(){
  /* Onay penceresi */
  $("confirmCancelBtn").onclick = function(){ var cb = cancelCb; closeConfirm(); if(cb) cb(); };
  $("confirmOkBtn").onclick = function(){
    var cb = confirmCb, val = $("confirmSelectWrap").style.display !== "none" ? $("confirmSelect").value : undefined;
    closeConfirm(); if(cb) cb(val);
  };
  bindBackdropClose($("confirmOverlay"), closeConfirm);
}
