/* Küçük metin yardımcıları */
"use strict";


function s(v, max){ return v == null ? "" : String(v).slice(0, max || 500); }

module.exports = { s };
