/* Sabitler: durumlar, öncelikler, varsayılan sorumlular, sınırlar, tercih anahtarları, ikonlar */

/* units.json yoksa ya da boşsa kullanılan başlangıç sorumluları */
export var DEFAULT_UNITS = [
  { id:"oz",        name:"Kendi İşlerim",               color:"#7C4DFF", order:0 },
  { id:"mimari",    name:"Veri Mimarisi",               color:"#0E7C86", order:1 },
  { id:"yonetim",   name:"Veri Yönetimi",               color:"#3E5C76", order:2 },
  { id:"hazirlama", name:"Veri Hazırlama ve İş Zekası", color:"#B0812F", order:3 },
  { id:"diger",     name:"Diğer",                       color:"#6B7280", order:4 }
];

export var PRIORITIES = [
  { id:"kritik", name:"Kritik", color:"var(--danger)",     soft:"var(--danger-soft)",  hex:"#E4572E", order:0 },
  { id:"yuksek", name:"Yüksek", color:"var(--warn)",       soft:"var(--warn-soft)",    hex:"#C9860B", order:1 },
  { id:"orta",   name:"Orta",   color:"var(--accent)",     soft:"var(--accent-soft)",  hex:"#0E7C86", order:2 },
  { id:"dusuk",  name:"Düşük",  color:"var(--text-faint)", soft:"var(--neutral-soft)", hex:"#8A93A3", order:3 }
];
export var PRIO_MAP = {}; PRIORITIES.forEach(function(p){ PRIO_MAP[p.id] = p; });

export var STATUSES = [
  { id:"backlog",    name:"Backlog",      color:"#A0A7B4" },
  { id:"beklemede",  name:"Beklemede",    color:"#8B93A7" },
  { id:"devam",      name:"Devam Ediyor", color:"#3E92CC" },
  { id:"tamamlandi", name:"Tamamlandı",   color:"#2E9E6D" },
  { id:"iptal",      name:"İptal Edildi", color:"#A6ADB9" }
];
export var STATUS_MAP = {}; STATUSES.forEach(function(s){ STATUS_MAP[s.id] = s; });

export var PROJECT_COLORS = ["#0E7C86","#7C4DFF","#3E5C76","#B0812F","#2E9E6D","#E4572E","#3E92CC","#C9860B","#A64AC9","#1F7A52","#6B7280"];
export var DUE_SOON_DAYS = 3;
export var ALERT_GROUPS = [
  { id:"over",  name:"Gecikmiş" },
  { id:"today", name:"Bugün" },
  { id:"soon",  name:"Yaklaşan" }
];
export var ALERT_ROWS = 6;                       // her grupta "+N daha" öncesi gösterilen satır
export var MAX_UPLOAD = 25 * 1024 * 1024;        // sunucudaki sınırla aynı
export var MAIL_ATT_WARN = 20 * 1024 * 1024;     // bunun üstündeki ekler için uyarı
export var PREF_ALERTS_OPEN = "isTakip.alertsOpen";
export var PREF_STATUS_TAB = "isTakip.statusTab";   // panoda son seçilen durum sekmesi

export var SV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">';
export var ICON = {
  clock:   SV + '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>',
  check:   SV + '<path d="M20 6 9 17l-5-5"/></svg>',
  note:    SV + '<path d="M4 4h13l3 3v13H4z"/><path d="M8 9h9M8 13h9M8 17h5"/></svg>',
  trash:   SV + '<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>',
  archive: SV + '<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8"/><path d="M10 13h4"/></svg>',
  restore: SV + '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
  folder:  SV + '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/></svg>',
  x:       SV + '<path d="M18 6 6 18M6 6l12 12"/></svg>',
  clip:    SV + '<path d="m21 11-8.5 8.5a5 5 0 0 1-7-7L14 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 7"/></svg>',
  up:      SV + '<path d="m18 15-6-6-6 6"/></svg>',
  down:    SV + '<path d="m6 9 6 6 6-6"/></svg>',
  file:    SV + '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/></svg>',
  bell:    SV + '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>',
  edit:    SV + '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  link:    SV + '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>',
  calendar: SV + '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></svg>'
};

