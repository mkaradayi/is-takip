/* İş Takip — demo veri yükleyici.
   Kullanım (sunucu çalışırken):
     node tools/demo-veri.js          → demo projeleri, işleri ve arşiv kayıtlarını ekler (mevcut verinize dokunmaz)
     node tools/demo-veri.js --sil    → yalnızca demo kayıtlarını (id'si "demo-" ile başlayanlar) kaldırır
   Seçenekler: PORT (varsayılan 3000), DATA_DIR (sunucuyla aynı veri klasörü; yedeğin yazılacağı yer).
   Yazmadan önce sunucudan veritabanı yedeği alınır: data/backup/demo-oncesi-<zaman>.db (eski sunucuda JSON klasörü).
   Tarihler bugüne göre hesaplanır; böylece her zaman gecikmiş / bugün / yaklaşan işler bulunur. */
"use strict";
const fs = require("fs");
const path = require("path");

const BASE = "http://localhost:" + (process.env.PORT || 3000);
const REMOVE = process.argv.includes("--sil");
const pad = n => String(n).padStart(2, "0");
const iso = off => { const d = new Date(); d.setDate(d.getDate() + off); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); };
const stamp = (() => { const d = new Date(); return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + "-" + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds()); })();
const isDemo = x => typeof x.id === "string" && x.id.startsWith("demo-");

const PROJECTS = [
  { id: "demo-p-dwh",  name: "Veri Ambarı Modernizasyonu", color: "#0E7C86" },
  { id: "demo-p-kvkk", name: "KVKK Uyum Programı",         color: "#E4572E" },
  { id: "demo-p-bi",   name: "Yönetim Raporları (BI)",     color: "#7C4DFF" },
  { id: "demo-p-mdm",  name: "Ana Veri Yönetimi (MDM)",    color: "#B0812F" }
];

/* Demo çalışanlar (ekip sırası → adlar); id'leri "demo-m" ile başlar, --sil ile kaldırılır */
const MEMBERS = [[0, ["Selin Aydın"]], [1, ["Ayşe Demir", "Can Yılmaz"]], [2, ["Elif Şahin", "Burak Öz", "Zeynep Ak"]], [3, ["Deniz Kaya", "İpek Aras"]]];
const DEFAULT_UNITS = [
  { id: "oz", name: "Kendi İşlerim", color: "#7C4DFF", order: 0 }, { id: "mimari", name: "Veri Mimarisi", color: "#0E7C86", order: 1 },
  { id: "yonetim", name: "Veri Yönetimi", color: "#3E5C76", order: 2 }, { id: "hazirlama", name: "Veri Hazırlama ve İş Zekası", color: "#B0812F", order: 3 },
  { id: "diger", name: "Diğer", color: "#6B7280", order: 4 }
];

/* [başlık, birim sırası, öncelik, durum, proje, başlangıç, bitiş (gün farkı; null = yok), açıklama, notlar] */
const TASKS = [
  ["Kaynak sistem envanterinin çıkarılması", 1, "yuksek", "devam", "demo-p-dwh", -20, -5, "Tüm operasyonel kaynak sistemler, sahipleri ve veri hacimleri listelenecek.", ["CRM ve ERP tamamlandı, çağrı merkezi sistemi bekleniyor."]],
  ["Staging katmanı için ETL tasarımı", 1, "kritik", "devam", "demo-p-dwh", -15, -2, "Artımlı yükleme (CDC) stratejisi ve hata yönetimi dokümante edilecek.", ["Mimari kurulda sunuldu, iki revizyon istendi."]],
  ["Boyutsal model taslağı (müşteri & ürün)", 1, "yuksek", "beklemede", "demo-p-dwh", -10, 0, "Yıldız şema taslağı; SCD tip 2 boyutlar netleştirilecek.", []],
  ["Eski raporların yeni ambara taşınma planı", 3, "orta", "beklemede", "demo-p-dwh", -3, 2, "Kullanımda olan 47 raporun önceliklendirilmesi.", ["Kullanım istatistikleri BT'den istendi."]],
  ["Veri ambarı sunucu kapasite planlaması", 4, "orta", "backlog", "demo-p-dwh", null, null, "3 yıllık büyüme öngörüsüyle depolama ve işlem kapasitesi.", []],
  ["Kişisel veri envanteri güncellemesi", 2, "kritik", "devam", "demo-p-kvkk", -25, -8, "VERBİS kayıtlarıyla uyumlu güncel envanter hazırlanacak.", ["Hukuk birimiyle ilk toplantı yapıldı.", "İK verileri için ayrı oturum planlandı."]],
  ["Maskeleme kurallarının test ortamına uygulanması", 2, "yuksek", "devam", "demo-p-kvkk", -7, 1, "TCKN, telefon ve e-posta alanları için dinamik maskeleme.", []],
  ["Saklama ve imha politikası taslağı", 2, "orta", "beklemede", "demo-p-kvkk", -5, 3, "Veri türlerine göre saklama süreleri tablosu.", []],
  ["Erişim yetki matrisi gözden geçirmesi", 2, "yuksek", "devam", "demo-p-kvkk", -12, -1, "Hassas tablolara erişimi olan kullanıcı ve servis hesapları.", ["32 hesaptan 9'unun yetkisi fazla görünüyor."]],
  ["KVKK farkındalık eğitimi içeriği", 0, "dusuk", "backlog", "demo-p-kvkk", null, null, "Veri ekipleri için 30 dakikalık kısa eğitim.", []],
  ["Aylık yönetim özeti panosu", 3, "kritik", "devam", "demo-p-bi", -6, 0, "Gelir, maliyet ve müşteri KPI'ları tek sayfada.", ["Finans onayı bekleniyor."]],
  ["Satış hunisi raporunun yenilenmesi", 3, "yuksek", "beklemede", "demo-p-bi", -4, -3, "Aşama dönüşüm oranları ve bölge kırılımı eklenecek.", []],
  ["KPI sözlüğünün yayınlanması", 2, "orta", "devam", "demo-p-bi", -9, 6, "Her KPI için tanım, formül, sahip ve kaynak tablo.", ["18 KPI'dan 11'i tamamlandı."]],
  ["Rapor yenileme sürelerinin optimizasyonu", 3, "orta", "backlog", "demo-p-bi", null, null, "Sabah 08:00'den önce tüm raporların hazır olması hedefi.", []],
  ["Self-servis BI pilot ekibinin belirlenmesi", 0, "dusuk", "backlog", "demo-p-bi", null, null, "", []],
  ["Müşteri ana verisi eşleştirme kuralları", 2, "kritik", "beklemede", "demo-p-mdm", -14, -6, "Mükerrer müşteri kayıtları için bulanık eşleştirme eşikleri.", ["Örneklem üzerinde %4 mükerrer bulundu."]],
  ["Ürün hiyerarşisinin standartlaştırılması", 2, "yuksek", "devam", "demo-p-mdm", -8, 2, "Üç farklı sistemdeki ürün kategorilerinin tek hiyerarşide birleşmesi.", []],
  ["Veri sahipliği (data owner) atamaları", 0, "orta", "beklemede", "demo-p-mdm", -2, 10, "Her ana veri alanı için iş birimi sahibi.", []],
  ["Veri kalitesi skor kartı", 2, "yuksek", "devam", "", -10, 1, "Tamlık, tutarlılık ve güncellik metrikleri haftalık izlenecek.", ["İlk sürüm ekip içinde paylaşıldı."]],
  ["Haftalık birim toplantısı sunumu", 0, "orta", "beklemede", "", -1, 0, "Proje durumları ve riskler.", []],
  ["Yeni ekip üyesi oryantasyon planı", 0, "dusuk", "beklemede", "", -2, 5, "", []],
  ["Bütçe 2027 veri altyapısı kalemleri", 0, "kritik", "beklemede", "", -5, -4, "Lisans, donanım ve danışmanlık kalemleri.", ["Satın alma ile ön görüşme yapıldı."]],
  ["Veri kataloğu aracı karşılaştırması", 1, "orta", "backlog", "", null, null, "Açık kaynak ve ticari üç seçeneğin kısa listesi.", []],
  ["Log tablolarının arşivleme işi", 4, "dusuk", "beklemede", "", -3, 14, "", []],
  ["Bulut maliyet raporu (Ekim)", 3, "orta", "tamamlandi", "demo-p-bi", -20, -6, "", ["Yönetime iletildi."]],
  ["Test ortamı veri yenilemesi", 4, "orta", "tamamlandi", "", -12, -9, "", []],
  ["Mükerrer tedarikçi kayıtlarının temizliği", 2, "yuksek", "tamamlandi", "demo-p-mdm", -30, -15, "", ["1.240 kayıt birleştirildi."]],
  ["Eski FTP aktarımlarının kapatılması", 4, "dusuk", "iptal", "", -40, -20, "", ["Yerine SFTP projesi açıldı."]]
];
const ARCHIVE = [
  ["2026 1. çeyrek veri stratejisi sunumu", 1, "yuksek", "tamamlandi", "", -120, -95],
  ["Eski rapor sunucusunun kapatılması", 4, "orta", "tamamlandi", "demo-p-dwh", -90, -60],
  ["Lisans yenileme (ETL aracı)", 0, "orta", "tamamlandi", "", -70, -55]
];

async function api(p, opts){
  const r = await fetch(BASE + p, opts);
  const j = await r.json().catch(() => ({}));
  if(!r.ok) throw new Error((j.error || ("HTTP " + r.status)) + " (" + p + ")");
  return j;
}
async function put(kind, items, base){
  return api("/api/" + kind, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items, baseUpdatedAt: base }) });
}

(async () => {
  let state;
  try{ state = await api("/api/state"); }
  catch(e){ console.error("Sunucuya ulaşılamadı (" + BASE + "). Önce sunucuyu açın (servis\\servis-kur.bat ya da node server.js).\n  " + e.message); process.exit(1); }

  /* Önce sunucudan veritabanı yedeği iste (data/backup/demo-oncesi-<zaman>.db); eski (JSON) sunucuda bu rota yoksa
     API'den okunan veriyi JSON olarak yedekle. */
  try{
    const b = await api("/api/backup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label: "demo-oncesi" }) });
    console.log("Yedek alındı: data/" + b.file.replace(/\\/g, "/"));
  }catch(e){
    const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, "..", "data");
    const dir = path.join(dataDir, "backup", "demo-oncesi-" + stamp);
    fs.mkdirSync(dir, { recursive: true });
    for(const k of ["tasks", "projects", "archive", "units"]) fs.writeFileSync(path.join(dir, k + ".json"), JSON.stringify({ items: state[k] || [] }, null, 2));
    console.log("Yedek alındı (JSON): " + dir);
  }

  const keep = k => (state[k] || []).filter(x => !isDemo(x));
  let tasks = keep("tasks"), projects = keep("projects"), archive = keep("archive");
  /* Ekipler: demo çalışanları çıkar (--sil) ya da ekle; sunucuda ekip yoksa varsayılanlar yazılır */
  let units = (state.units && state.units.length ? state.units : DEFAULT_UNITS).map(u => Object.assign({}, u, { members: (u.members || []).filter(m => !isDemo(m)) }));

  if(!REMOVE){
    /* Demo mail adresleri (@example.com). Her ekibin son çalışanı (birden fazlaysa) adressiz: eksik adres örneği.
       Ekip adresleri yalnızca sunucuda ekip yokken (varsayılan ekipler yazılırken) eklenir; kullanıcının ekiplerine dokunulmaz. */
    const slug = n => n.toLocaleLowerCase("tr").replace(/ı/g, "i").replace(/ş/g, "s").replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ö/g, "o").replace(/ç/g, "c").replace(/[^a-z0-9]+/g, ".").replace(/^\.|\.$/g, "");
    if(!(state.units && state.units.length)) units.forEach(u => { if(u.id !== "oz" && u.id !== "diger") u.email = slug(u.name) + "@example.com"; });
    MEMBERS.forEach(([ui, names]) => { const u = units[ui % units.length]; names.forEach((n, k) => u.members.push({ id: "demo-m" + ui + k, name: n, email: names.length > 1 && k === names.length - 1 ? "" : slug(n) + "@example.com", active: true })); });
    const unit = i => units[i % units.length].id;
    /* her 3. işe ekibinden bir çalışan, her 5. işe ikinci bir ekip atanır (çoklu sorumlu örneği) */
    const assign = (u, i) => {
      const us = [unit(u)], ms = [];
      const own = units[u % units.length].members.filter(m => isDemo(m));
      if(own.length && i % 3 === 0) ms.push(own[i % own.length].id);
      if(i % 5 === 4){ const other = units[(u + 1) % units.length]; us.push(other.id); const om = other.members.filter(m => isDemo(m)); if(om.length) ms.push(om[0].id); }
      return { units: us, members: ms };
    };
    const created = new Date().toISOString();
    const mk = (row, i, pre) => {
      const [title, u, priority, status, projectId, s, d, desc, notes] = row;
      return {
        id: pre + pad(i + 1), title, units: assign(u, i).units, members: assign(u, i).members, priority, status, projectId,
        startDate: s == null ? "" : iso(s), dueDate: d == null ? "" : iso(d),
        createdAt: iso(s == null ? -3 : Math.min(s, -1)), updatedAt: iso(0),
        description: desc || "", notes: (notes || []).map((t, k) => ({ id: pre + "n" + pad(i + 1) + k, text: t, date: iso(-(notes.length - k)), createdAt: created })),
        attachments: []
      };
    };
    projects = projects.concat(PROJECTS.map(p => Object.assign({ status: "aktif" }, p)));
    tasks = tasks.concat(TASKS.map((r, i) => mk(r, i, "demo-t")));
    archive = archive.concat(ARCHIVE.map((r, i) => Object.assign(mk(r, i, "demo-a"), { archivedAt: iso(r[6] + 2) })));
  }

  /* Önce ekipler ve projeler (işler onlara başvurur), sonra arşiv ve işler */
  await put("units", units, state.meta.units);
  await put("projects", projects, state.meta.projects);
  await put("archive", archive, state.meta.archive);
  await put("tasks", tasks, state.meta.tasks);

  if(REMOVE) console.log("Demo kayıtları kaldırıldı. Kalan: " + tasks.length + " iş, " + projects.length + " proje, " + archive.length + " arşiv kaydı.");
  else console.log("Eklendi: " + TASKS.length + " iş, " + PROJECTS.length + " proje, " + ARCHIVE.length + " arşiv kaydı. Toplam " + tasks.length + " aktif iş.");
  console.log("Tarayıcıda sayfayı yenileyin (F5).");
})().catch(e => {
  console.error("Hata: " + e.message);
  if(/değişti/.test(e.message)) console.error("Uygulama o sırada başka bir değişiklik kaydetti; komutu tekrar çalıştırın.");
  process.exit(1);
});
