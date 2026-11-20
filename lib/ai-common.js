/* AI ortak: sabitler, model kaydı (data/ai-models.json), model çözümleme, başlıklar, hata eşleme */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { DATA_DIR, SAFE_ID } = require("./config");
const { writeFileAtomic } = require("./fs-util");
const { s } = require("./util");

/* ---------- AI asistan (OpenRouter) ---------- */
const AI_URL = process.env.OPENROUTER_URL || "https://openrouter.ai/api/v1/chat/completions"; // OPENROUTER_URL yalnızca test içindir
const AI_MODEL = "openai/gpt-oss-120b";
const AI_TIMEOUT_MS = 60000;
const AI_MAX_MESSAGES = 60;
const AI_MAX_BOARD = 60000;
const DAYS_TR = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];


/* ---------- AI model kaydı (data/ai-models.json) ----------
   Yerleşik model: OpenRouter + gpt-oss-120b (anahtar .env'de). Kullanıcı OpenAI uyumlu başka uç noktalar ekleyebilir
   (Ollama, LM Studio, vLLM, llama.cpp…). API anahtarları yalnızca bu dosyada durur; tarayıcıya hiç gönderilmez. */
const MODELS_FILE = path.join(DATA_DIR, "ai-models.json");
const BUILTIN_ID = "openrouter";
const LOCAL_TIMEOUT_MS = 180000;   // yerel modeller (özellikle CPU'da) yavaş olabilir

function readModels(){
  try{
    const j = JSON.parse(fs.readFileSync(MODELS_FILE, "utf8").replace(/^﻿/, ""));
    return (Array.isArray(j.items) ? j.items : []).filter(m => m && SAFE_ID.test(m.id || ""));
  }catch(e){ return []; }
}
function writeModels(items){ writeFileAtomic(MODELS_FILE, JSON.stringify({ schemaVersion: 1, updatedAt: new Date().toISOString(), items }, null, 2)); }
function normBase(u){ return String(u || "").trim().replace(/\/+$/, "").replace(/\/chat\/completions$/, ""); }
function validBase(u){ try{ const x = new URL(u); return x.protocol === "http:" || x.protocol === "https:"; }catch(e){ return false; } }

/* Tarayıcıya giden liste: anahtar yok, yalnızca var/yok bilgisi */
function publicModels(){
  return [{ id: BUILTIN_ID, name: "OpenRouter · gpt-oss-120b", baseUrl: "https://openrouter.ai/api/v1", model: AI_MODEL,
            builtin: true, hasKey: !!process.env.OPENROUTER_API_KEY, available: !!process.env.OPENROUTER_API_KEY }]
    .concat(readModels().map(m => ({ id: m.id, name: m.name, baseUrl: m.baseUrl, model: m.model, builtin: false, hasKey: !!m.apiKey, available: true })));
}

/* PUT gövdesi: { items:[{ id?, name, baseUrl, model, apiKey? }] } — apiKey verilmezse mevcut anahtar korunur, "" ise silinir */
function saveModels(list){
  if(!Array.isArray(list) || list.length > 50) throw Object.assign(new Error("Geçersiz model listesi"), { status: 400 });
  const old = {}; readModels().forEach(m => { old[m.id] = m; });
  const seen = {};
  const items = list.map((m, i) => {
    m = m || {};
    const id = SAFE_ID.test(m.id || "") && m.id !== BUILTIN_ID ? m.id : "m" + crypto.randomBytes(5).toString("hex");
    const name = s(m.name, 80).trim(), baseUrl = normBase(m.baseUrl), model = s(m.model, 200).trim();
    const who = (name || ("#" + (i + 1)));
    if(!name) throw Object.assign(new Error(who + ": ad boş olamaz"), { status: 400 });
    if(!validBase(baseUrl)) throw Object.assign(new Error(who + ": adres http:// veya https:// ile başlamalı"), { status: 400 });
    if(!model) throw Object.assign(new Error(who + ": model adı boş olamaz"), { status: 400 });
    if(seen[name.toLocaleLowerCase("tr")]) throw Object.assign(new Error('"' + name + '" adı birden fazla kez kullanılmış'), { status: 400 });
    seen[name.toLocaleLowerCase("tr")] = 1;
    const apiKey = m.apiKey === undefined ? (old[id] ? old[id].apiKey || "" : "") : s(m.apiKey, 500).trim();
    return { id, name, baseUrl, model, apiKey };
  });
  writeModels(items);
  return publicModels();
}

function resolveModel(id){
  if(!id || id === BUILTIN_ID){
    const key = process.env.OPENROUTER_API_KEY;
    if(!key) throw Object.assign(new Error("OpenRouter anahtarı tanımlı değil. Proje klasöründeki .env dosyasına OPENROUTER_API_KEY=... satırını ekleyip sunucuyu yeniden başlatın ya da Ayarlar'dan yerel bir model seçin."), { status: 503 });
    return { builtin: true, name: "OpenRouter", url: AI_URL, key, model: AI_MODEL, timeout: AI_TIMEOUT_MS };
  }
  const m = readModels().find(x => x.id === id);
  if(!m) throw Object.assign(new Error("Seçilen model artık kayıtlı değil. AI panelinden başka bir model seçin."), { status: 400 });
  return { builtin: false, name: m.name, url: m.baseUrl + "/chat/completions", key: m.apiKey, model: m.model, timeout: LOCAL_TIMEOUT_MS, baseUrl: m.baseUrl };
}
function aiHeaders(cfg){
  const h = { "Content-Type": "application/json" };
  if(cfg.key) h.Authorization = "Bearer " + cfg.key;
  if(cfg.builtin){ h["HTTP-Referer"] = "http://localhost"; h["X-Title"] = "Is Takip"; }
  return h;
}
function netError(e, cfg){
  if(e.name === "AbortError") return "AI yanıtı zaman aşımına uğradı (" + Math.round(cfg.timeout / 1000) + " sn). Tekrar deneyin.";
  if(cfg.builtin) return "OpenRouter'a ulaşılamadı (internet bağlantısı veya kurum proxy'si?)";
  return '"' + cfg.name + '" sunucusuna ulaşılamadı (' + cfg.baseUrl + "). Model sunucusu (Ollama, LM Studio vb.) çalışıyor mu, adres doğru mu?";
}

/* Bağlantı testi: OpenAI uyumlu /models listesi. { id } verilirse kayıtlı anahtar kullanılır. */
async function testModel(body){
  body = body || {};
  let baseUrl = normBase(body.baseUrl), key = body.apiKey === undefined ? "" : s(body.apiKey, 500).trim();
  if(body.id === BUILTIN_ID){ baseUrl = "https://openrouter.ai/api/v1"; key = process.env.OPENROUTER_API_KEY || ""; }
  else if(body.id && body.apiKey === undefined){ const m = readModels().find(x => x.id === body.id); if(m) key = m.apiKey || ""; }
  if(!validBase(baseUrl)) throw Object.assign(new Error("Adres http:// veya https:// ile başlamalı"), { status: 400 });
  const cfg = { name: baseUrl, baseUrl, key, timeout: 10000 };
  const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), cfg.timeout);
  let r, j;
  try{ r = await fetch(baseUrl + "/models", { headers: aiHeaders(cfg), signal: ctrl.signal }); j = await r.json().catch(() => ({})); }
  catch(e){ throw Object.assign(new Error(netError(e, cfg)), { status: 502 }); }
  finally{ clearTimeout(timer); }
  if(r.status === 401 || r.status === 403) throw Object.assign(new Error("Sunucu anahtarı reddetti (HTTP " + r.status + ")"), { status: 502 });
  if(!r.ok) throw Object.assign(new Error("Sunucu /models isteğine HTTP " + r.status + " döndü"), { status: 502 });
  const list = Array.isArray(j.data) ? j.data : Array.isArray(j.models) ? j.models : [];
  return { ok: true, models: list.map(x => s(x && (x.id || x.name || x.model), 200)).filter(Boolean).slice(0, 500) };
}

/* Yerel modeller düşünce metnini <think>…</think> içinde döndürebilir; kullanıcıya gösterilmez */
function stripThink(t){ return String(t || "").replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/^[\s\S]*?<\/think>/i, "").trim(); }

module.exports = { AI_MODEL, readModels, AI_MAX_MESSAGES, AI_MAX_BOARD, DAYS_TR, publicModels, saveModels, resolveModel, aiHeaders, netError, testModel, stripThink };
