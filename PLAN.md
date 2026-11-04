# İş Takip — Yeni Özellikler Planı

## Context
Uygulama bağımlılıksız bir Node sunucusu ([server.js](server.js)) ve vanilla JS arayüzden ([public/app.js](public/app.js)) oluşuyor. Veriler `data/*.json` dosyalarında duruyor. Kullanıcı beş yeni özellik istiyor:
1. açıklamalar için ek eklenebilen zengin metin editörü,
2. gün.ay.yıl tarih biçimi,
3. bir veya birden fazla kartı seçip mail gönderme,
4. çok sayıda uyarı olduğunda düzgün görünen bir uyarı alanı,
5. Sorumlu ve Proje listelerinin bir Ayarlar sayfasından yönetilmesi.

**Alınan kararlar:** Mail, Outlook'un taslak olarak açtığı **.eml dosyası** olarak üretilecek. Tarih biçimi **04.11.2026**. Editör **bağımlılıksız** olacak (`contenteditable` + araç çubuğu). Mail için **çoklu seçim** olacak.

**Değişmeyecek ilkeler:** Uygulama bağımlılıksız kalacak. Atomik yazım, çakışma kontrolü (`baseUpdatedAt`), açılış yedeği ve "yüklenmeden yazma" kilidi aynen sürecek. Dosyadan gelen her değer `normalize*` fonksiyonlarından geçecek.

## Uygulama sırası
Önce tarih (küçük ve bağımsız). Ardından Ayarlar/Sorumlular (veri modelini değiştirir). Sonra uyarılar, editör ve ekler. Mail en sona kalıyor, çünkü editör çıktısına ve eklere ihtiyaç duyuyor.

---

## 2. Tarih biçimi: gg.aa.yyyy
- `fmtDate` ([app.js](public/app.js), UTILS bölümü) `04.11.2026` döndürecek. Bu fonksiyonu kullanan kart, arşiv, modal ve not etiketleri kendiliğinden değişir.
- Tarayıcının `<input type="date">` alanı biçimi işletim sistemi diline göre gösterdiği için `fStart`/`fDue` alanları şu yapıya dönecek: `gg.aa.yyyy` maskeli **metin alanı** + takvim butonu. Takvim butonu, gizli bir `<input type="date">` alanını `showPicker()` ile açıyor ve seçilen değer metin alanına yazılıyor.
- Yeni yardımcılar: `trToISO("04.11.2026") → "2026-11-04"` (geçersizse `""`), `isoToTR()`. Yazarken otomatik nokta ekleniyor. `saveTask` geçersiz tarihte uyarı veriyor.
- İç veri biçimi **ISO olarak kalıyor** (`YYYY-MM-DD`), dolayısıyla dosyalarda değişiklik yok.

## 5. Ayarlar sayfası: Sorumlular ve Projeler
**Veri modeli**
- Yeni veri türü `units`: sunucuda `KINDS`'a eklenecek, rota regex'i genişletilecek, `data/units.json` oluşacak. Açılış yedeğine ve çakışma kontrolüne kendiliğinden dahil oluyor.
- Birim alanları: `{ id, name, color (#hex), order }`. Açık renk, projelerde olduğu gibi `color + "22"` ile türetiliyor. Bugünkü sabit `UNITS` listesi `DEFAULT_UNITS` olarak kalıyor; renkleri [style.css](public/style.css) içindeki `--unit-*` değerlerinden hex'e çevrilecek. `units.json` boşsa ya da yoksa bu varsayılanlar kullanılıyor ve ilk değişiklikte dosyaya yazılıyor.
- `normalizeUnit` eklenecek (id/renk doğrulaması mevcut `safeId`/`HEX_COLOR` ile).
- `normalizeTask` artık bilinmeyen birimi `"diger"`e **çevirmeyecek**; id olduğu gibi kalacak. Görüntülemede `getUnit(id)` gri bir "(silinmiş sorumlu)" nesnesine düşecek. Bugün `UNIT_MAP[t.unit]` tanımsızsa `unitTag`/`renderAlerts` çöküyor; bu da düzeliyor.
- Yeni işin varsayılan sorumlusu, listedeki ilk birim olacak.
- `applyServerState` birimleri işlerden **önce** yükleyecek.

**Arayüz**
- Kenar çubuğundaki görünüm sekmelerine üçüncü sekme eklenecek: **Ayarlar** (`switchView("settings")`). "Projeleri Yönet" butonu da Ayarlar'ı açacak.
- Ayarlar sayfasında iki bölüm olacak:
  - **Sorumlular:** ekleme, ad değiştirme, renk seçme, yukarı/aşağı sıralama, silme.
  - **Projeler:** mevcut `renderProjectManage` / `addProject` / `renameProject` / `recolorProject` / `toggleProject` mantığı modal'dan buraya taşınacak; `projectsOverlay` kaldırılacak.
- **Silme:** Birim ya da proje işlere bağlıysa (aktif + arşiv) bugünkü gibi engellemek yerine bir diyalog açılacak: "N iş bu sorumluya bağlı. Hangi sorumluya aktarılsın?" Seçimden sonra tek `commit(["units","tasks","archive"])` ile aktarılıp silinecek. Projelerde "Projesiz" de seçilebilecek. Son kalan birim silinemeyecek.
- Yedek dışa/içe aktarmaya `units` eklenecek ([app.js](public/app.js) `exportBackup` / `importBackup`).

## 4. Uyarı alanının yeniden tasarımı
Şu anki sorun: `renderAlerts`, tüm acil işleri `flex-wrap` hap butonları olarak basıyor; iş sayısı arttıkça panonun üstünü kaplıyor.
- **Kapalı hal (varsayılan):** Tek satırlık ince bir özet şeridi: ⚠ simgesi + sayı rozetleri `3 Gecikmiş` (kırmızı), `1 Bugün` (turuncu), `4 Yaklaşan` (sarı) + "Ayrıntılar ▾" butonu.
- **Açık hal:** Şeridin altında yüksekliği sınırlı (~260px, kaydırmalı) bir panel. Üç sütun var (Gecikmiş / Bugün / Yaklaşan). Her satırda sorumlu rengi, başlık, proje adı ve sağa yaslı "5 gün gecikti" gibi bir etiket bulunuyor. Satıra tıklayınca iş açılıyor. Her grupta en fazla 6 satır görünüyor, fazlası için "+N daha" yazıyor; buna tıklayınca grubun tamamı açılıyor. Dar ekranda sütunlar alt alta diziliyor.
- **Rozete tıklama:** Panoyu o gruba filtreliyor (yeni `state.urgencyFilter`, `filteredTasks` içinde uygulanıyor). Etkin filtre sidebar filtreleri gibi vurgulanıyor ve tekrar tıklayınca kalkıyor.
- Açık/kapalı tercihi `localStorage`'da tutulacak (yalnızca arayüz tercihi, veri değil).
- `daysBetween` ve `urgency` mevcut fonksiyonları kullanılacak. "Bugün" grubu için `urgency`'ye `d === 0` ayrımı eklenecek.

## 1. Zengin metin editörü ve ekler
**Editör** (yeni dosya [public/editor.js](public/editor.js), `window.RichEditor`):
- `contenteditable` bir div + araç çubuğu: Kalın, İtalik, Altı çizili, Üstü çizili, Başlık, Madde listesi, Numaralı liste, Alıntı, Bağlantı, Biçimi temizle, Ek ekle. Komutlar `document.execCommand` ile çalışıyor (eski ama tüm tarayıcılarda çalışıyor). Ctrl+B/I/U kısayolları çalışmaya devam ediyor.
- **Sanitizer (güvenlik açısından kritik):** `DOMParser` ile beyaz liste uygulanıyor. İzinli etiketler: `p, div, br, b, strong, i, em, u, s, h3, h4, ul, ol, li, blockquote, a, img`. `a` için yalnızca `http(s):` ve `mailto:` `href` değerlerine izin var (`target=_blank rel=noopener` ekleniyor). `img` için yalnızca `/api/attachments/<id>` `src` değerine izin var. Diğer tüm öznitelikler siliniyor, izinsiz etiketler açılıp içerikleri korunuyor. Sanitizer üç yerde çalışıyor: **yapıştırmada**, **kaydetmede** ve **görüntülemede**.
- Yapıştırılan ya da sürüklenen resimler önce ek olarak yükleniyor, sonra satır içine `<img>` olarak ekleniyor.

**Veri modeli**
- `task.descriptionHtml` (temizlenmiş HTML) eklenecek. `task.description` düz metin olarak kalmaya devam edecek (HTML'den türetiliyor); arama, kart önizlemesi ve geriye dönük uyumluluk bunu kullanıyor.
- Geçiş: `descriptionHtml` yoksa `normalizeTask`, `esc(description)` + `\n → <br>` ile üretiyor.
- `task.attachments: [{ id, name, size, type, uploadedAt }]`. `normalizeTask` bunu doğrulayacak.

**Sunucu** ([server.js](server.js)):
- `POST /api/attachments`: ham gövde, `X-File-Name` (URL kodlu) başlığı, `Content-Type`. Ayrı bir `MAX_UPLOAD` sınırı (25 MB). Dosya `data/attachments/<id>` yoluna, `{name,type,size}` bilgisi `<id>.json` dosyasına atomik olarak yazılıyor. Yanıt: `{ id, name, size, type }`.
- `GET /api/attachments/<id>`: `Content-Disposition` başlığıyla dönüyor. Resimler satır içi, diğer dosyalar `attachment` olarak. `X-Content-Type-Options: nosniff` ve aynı Host kontrolü uygulanıyor. id, `SAFE_ID` ile doğrulanıyor (path traversal yok).
- **Sahipsiz ek temizliği:** Açılışta, hiçbir işin `attachments` alanında ya da `descriptionHtml` içindeki `<img>` etiketlerinde geçmeyen **ve 1 günden eski** ekler siliniyor. JSON dosyalarından biri okunamazsa temizlik atlanıyor (veri kaybı riski yok). Kalıcı silme bu yolla dosya sistemine yansıyor.

**Arayüz**
- Modal'daki `fDesc` textarea'sı editörle değiştirilecek. Editörün altına ek listesi gelecek: dosya adı, boyut, indir, kaldır. Yükleme sırasında ilerleme durumu gösterilecek.
- Kartta açıklamanın düz metin önizlemesi ve ataç simgesiyle ek sayısı gösterilecek.
- Arşiv kartlarındaki açıklama da düz metin önizleme olacak.

## 3. Kart seçme ve mail gönderme (.eml taslağı)
**Seçim**
- Her kartın sol üstünde bir seçim kutusu olacak; normalde fareyle üzerine gelince, seçim varken her zaman görünecek. `state.selected` (id kümesi) tutulacak.
- En az bir kart seçiliyken altta sabit bir eylem çubuğu çıkacak: "N iş seçildi · **Mail taslağı oluştur** · Tümünü seç (filtrelenen) · Seçimi temizle".
- Kart sürükleme ve kart tıklaması seçim kutusunu yok sayacak.
- Tek iş için bir kısayol da olacak: iş modal'ında "Mail gönder" butonu.

**.eml üretimi** (yeni dosya [public/eml.js](public/eml.js), istemci tarafında):
- MIME yapısı: `multipart/mixed` → [`multipart/related` → (`multipart/alternative`: text/plain + text/html) + satır içi resimler (`cid:`)] + ek dosyalar.
- Başlıklar: `X-Unsent: 1` (Outlook dosyayı gönderilmemiş, düzenlenebilir bir taslak olarak açar), `To:` boş, `Subject` UTF-8 B-kodlamalı. Gövde ve ekler base64 olarak 76 karakterlik satırlara bölünüyor.
- İçerik: Tek iş için konu `İş: <başlık>`. Çoklu seçimde konu `İş durumu – N iş (04.11.2026)`. Her iş satır içi stillerle yazılmış bir HTML bloğu olarak giriyor: başlık, durum, öncelik, sorumlu, proje, başlangıç/termin (yeni tarih biçimiyle), gecikme bilgisi, açıklama (HTML) ve son 3 durum notu. Düz metin sürümü de üretiliyor.
- Ekler `/api/attachments/<id>` üzerinden alınıp mail'e gömülüyor. Toplam boyut 20 MB'ı geçerse önce kullanıcıdan onay isteniyor (mevcut `showConfirm` kullanılıyor), "ekler olmadan oluştur" seçeneği de sunuluyor.
- Oluşan dosya `is-takip-<tarih>.eml` adıyla indiriliyor. Kullanıcıya şu bilgi gösteriliyor: "Dosyayı açın; Outlook taslak olarak açacak, alıcıyı seçip gönderin."

---

## Değişecek / eklenecek dosyalar
- [server.js](server.js): `units` türü, ek yükleme ve indirme uç noktaları, sahipsiz ek temizliği
- [public/app.js](public/app.js): tarih yardımcıları, birim modeli ve normalize, Ayarlar görünümü, uyarı paneli, modal'a editör ve ekler, seçim ve eylem çubuğu, mail tetikleme
- [public/editor.js](public/editor.js) (yeni): editör ve sanitizer
- [public/eml.js](public/eml.js) (yeni): MIME/.eml oluşturucu
- [public/index.html](public/index.html): Ayarlar sekmesi ve sayfası, `projectsOverlay` kaldırılıyor, tarih alanları, editör alanı, eylem çubuğu, yeni script etiketleri
- [public/style.css](public/style.css): Ayarlar, uyarı paneli, editör, seçim kutusu ve eylem çubuğu stilleri
- [README.md](README.md): `units.json`, `attachments/` klasörü, mail kullanımı. Not: açılış yedeği ve JSON dışa aktarma ekleri **içermiyor**.

Yeniden kullanılacak mevcut parçalar: `esc`, `uid`, `safeId`, `HEX_COLOR`, `normalize*`, `commit` ve `Storage.save` (çakışma kontrolü dahil), `showConfirm`/`showInfo`, `PROJECT_COLORS` renk seçici, `renderProjectManage` mantığı, `writeKind` kuyruğu ve `renameWithRetry`.

---

## Checklist

### Tarih biçimi (2)
- [x] `fmtDate` → `gg.aa.yyyy`; `trToISO` / `isoToTR` yardımcıları
- [x] `fStart`/`fDue` alanları maskeli metin + takvim butonu (gizli date input ve `showPicker`)
- [x] `saveTask` içinde geçersiz tarih doğrulaması
- [x] Kart, arşiv, uyarı ve not etiketlerinde yeni biçimin kontrolü

### Ayarlar: Sorumlular ve Projeler (5)
- [x] Sunucu: `units` türü (`KINDS` ve rota)
- [x] `DEFAULT_UNITS` (hex renkler), `normalizeUnit`, `getUnit` yedek nesnesi, `UNIT_MAP`'in dinamik hale gelmesi
- [x] `normalizeTask` bilinmeyen birimi değiştirmeden bırakıyor; yeni iş varsayılanı ilk birim
- [x] Görünüm sekmelerine "Ayarlar" ekleniyor, `switchView("settings")`
- [x] Sorumlu ekleme, ad değiştirme, renk seçme, sıralama
- [x] Proje yönetimi modal'dan Ayarlar sayfasına taşınıyor; `projectsOverlay` kaldırılıyor
- [x] Silmede "işleri şuraya aktar" diyaloğu (birim ve proje); son birim silinemiyor
- [x] Dışa ve içe aktarmaya `units` ekleniyor

### Uyarı alanı (4)
- [x] Kapalı hal: özet şeridi ve sayı rozetleri (Gecikmiş / Bugün / Yaklaşan)
- [x] Açık hal: üç sütunlu, yüksekliği sınırlı, kaydırmalı panel; her grupta 6 satır ve "+N daha"
- [x] Rozete tıklayınca `state.urgencyFilter` ile panoyu filtreleme
- [x] Açık/kapalı tercihi `localStorage`'da; dar ekran düzeni

### Zengin metin editörü ve ekler (1)
- [x] `editor.js`: araç çubuğu ve `contenteditable`
- [x] Beyaz listeli sanitizer (yapıştırma, kaydetme ve görüntülemede)
- [x] `descriptionHtml` alanı; eski düz metinden geçiş; `description` düz metinden türetiliyor
- [x] Sunucu: `POST` / `GET /api/attachments` (sınır, `SAFE_ID`, nosniff, Host kontrolü)
- [x] `task.attachments` normalizasyonu; modal'da ek listesi (yükle, indir, kaldır, ilerleme)
- [x] Resim yapıştırma ve sürüklemede satır içi resim
- [x] Kartta düz metin önizleme ve ek sayısı
- [x] Açılışta sahipsiz ek temizliği (1 günden eski; JSON okunamazsa atlanıyor)

### Seçim ve mail (3)
- [x] Kart seçim kutusu, `state.selected`, alttaki eylem çubuğu (tümünü seç, temizle)
- [x] İş modal'ında "Mail gönder" butonu
- [x] `eml.js`: MIME oluşturucu (`X-Unsent`, UTF-8 konu, base64, `cid:` resimler, ekler)
- [x] Mail HTML şablonu (tek iş ve çoklu iş) ve düz metin sürümü
- [x] 20 MB üstü ek için uyarı ve "eksiz oluştur" seçeneği

### Kapanış
- [x] README güncellemesi
- [x] Uçtan uca doğrulama (aşağıda)

---

## Doğrulama
Testler ayrı bir veri klasöründe yapılacak: `DATA_DIR=<scratchpad>/testdata PORT=3917 node server.js`. Gerçek `data/` klasörüne dokunulmayacak.
1. **Tarih:** Modal'da `31.02.2026` girince hata vermeli. `04.11.2026` girilince dosyaya `2026-11-04` yazılmalı. Kartlar `04.11.2026` göstermeli.
2. **Ayarlar:** Sorumlu ekle, yeniden adlandır, renk değiştir; `units.json` güncellenmeli. İşleri olan bir sorumluyu sil, başka bir sorumluya aktar; işler aktarılmış olmalı. Son kalan sorumlu silinememeli. `units.json` olmadan açılışta varsayılanlar gelmeli.
3. **Uyarılar:** Gecikmiş, bugün ve yaklaşan tarihli 30 iş oluştur. Şerit tek satır kalmalı, panel kaydırılabilmeli, rozete tıklayınca pano filtrelenmeli.
4. **Editör ve güvenlik:** Biçimli metin ve resim yapıştır, PDF ekle, kaydet, yeniden aç; içerik korunmalı. `<img src=x onerror=alert(1)>` ve `<a href="javascript:...">` yapıştır; temizlenmeli. `curl` ile `../` içeren bir ek id'si 400/404 dönmeli, yanlış Host 403 dönmeli. Eski düz metin açıklamalar bozulmadan görünmeli.
5. **Mail:** Ekli bir iş ve iki iş daha seç, taslak oluştur. `.eml` dosyası Outlook'ta taslak olarak açılmalı; Türkçe karakterli konu, HTML gövde, satır içi resim ve ek doğru görünmeli. Ayrıca eml.js çıktısını Node'da ayrıştırarak MIME yapısı kontrol edilecek.
6. **Gerileme:** Arşivleme, geri alma, sürükle-bırak, iki pencerede çakışma uyarısı ve içe/dışa aktarma çalışmaya devam etmeli. Bozuk veriyle sahte DOM testi tekrar çalıştırılacak.


---

# İş Takip — AI Sohbet Asistanı Planı

## Context
Kullanıcı, sağ tarafta açılıp kapanan bir **AI sohbet paneli** istiyor. Panelden doğal dille bir veya birden fazla kartı **oluşturmak, düzenlemek ve taşımak** mümkün olacak (ör. "Veri Ambarı projesine yarın bitecek 3 iş ekle", "gecikmiş işlerin hepsini Devam Ediyor'a al").
- **Servis:** OpenRouter (`https://openrouter.ai/api/v1/chat/completions`), model `openai/gpt-oss-120b`. Anahtar `.env` dosyasındaki `OPENROUTER_API_KEY`.
- **Alınan kararlar:** Değişiklikler **hemen uygulanacak**; her AI yanıtında o adımı tümüyle geri alan bir **"Geri al"** butonu olacak. Sohbet geçmişi **yalnızca açık oturumda** tutulacak, diske yazılmayacak.
- **Kurulum notu:** Proje klasöründe `.env` dosyası şu an **yok**. Kullanıcının `OPENROUTER_API_KEY=...` satırıyla bu dosyayı oluşturması gerekecek. Anahtar yoksa sunucu açık bir hata döndürecek, panel de bunu gösterecek.

**Korunan ilkeler:** Bağımlılık eklenmiyor (`.env` elle ayrıştırılıyor, Node'un yerleşik `fetch`'i kullanılıyor). API anahtarı **asla tarayıcıya gitmiyor**. AI'nin yaptığı her değişiklik kullanıcının elle yaptığı değişikliklerle aynı yoldan geçiyor (`normalizeTask` → `commit` → `Storage.save`); yani çakışma kontrolü, atomik yazım ve doğrulama aynen geçerli.

## Mimari: sunucu yalnızca aracı, araçları tarayıcı çalıştırıyor
1. Tarayıcı `POST /api/ai/chat` isteği gönderiyor: `{ messages, board }`. `messages` yalnızca `user`/`assistant`/`tool` rollerinden oluşuyor. `board`, panonun kompakt bir özeti.
2. Sunucu şu işleri yapıyor:
   - sistem mesajını kendisi kuruyor (kurallar, bugünün tarihi, panodaki sorumlular/projeler/durumlar/öncelikler, işlerin özeti),
   - model, araç tanımları ve sınırları **sunucuda sabit**; istemci bunları değiştiremiyor,
   - isteği OpenRouter'a iletip `{ message }` döndürüyor (`content` + `tool_calls`).
3. Yanıtta `tool_calls` varsa tarayıcı her aracı state üzerinde çalıştırıyor, sonucu (`ok` / hata) `tool` mesajı olarak ekleyip tekrar istek gönderiyor. Model düz bir metin cevabı verene kadar bu döngü sürüyor; en fazla **6 tur**.
4. Neden araçlar sunucuda değil de tarayıcıda çalışıyor? Sunucu `tasks.json`'a doğrudan yazarsa, açık sayfa bir sonraki kaydında çakışma (409) alır. Tarayıcıda çalıştırınca mevcut `commit`/`Storage` akışı aynen kullanılıyor, pano da anında güncelleniyor.

## Sunucu ([server.js](server.js))
- `loadEnv()`: açılışta proje kökündeki `.env` okunuyor (`KEY=VALUE`, `#` ile başlayan satırlar yorum, tırnaklar soyuluyor). Değerler ortamda zaten tanımlıysa onlar korunuyor. Açılış logunda yalnızca "AI: hazır" ya da "AI: OPENROUTER_API_KEY yok" yazıyor; anahtar loglanmıyor.
- `POST /api/ai/chat`:
  - `sameOriginOk` kontrolü; gövde sınırı 1 MB (`readBody` sınır parametresiyle).
  - **Mesaj doğrulama:** rol beyaz listesi; içerik string; `tool_calls` yalnızca `{id, type:"function", function:{name, arguments}}` biçiminde; en fazla 60 mesaj.
  - **Model isteği:** `model: "openai/gpt-oss-120b"`, `tools: AI_TOOLS`, `tool_choice: "auto"`, `temperature: 0.2`, `max_tokens: 2000`. `provider: { require_parameters: true }` ile istek yalnızca araç çağırmayı destekleyen sağlayıcılara gidiyor.
  - **Başlıklar:** `Authorization: Bearer <key>`, `HTTP-Referer: http://localhost`, `X-Title: Is Takip`.
  - `AbortController` ile 60 saniye zaman aşımı.
  - **Hata eşleme:** anahtar yok → 503 "AI anahtarı tanımlı değil (.env)". OpenRouter 401 → "Anahtar geçersiz". 402 → "OpenRouter bakiyesi yetersiz". 429 → "Çok fazla istek, biraz bekleyin". Ağ hatası → "OpenRouter'a ulaşılamadı (internet/proxy?)".
  - Yanıt olarak yalnızca `choices[0].message` içindeki `content` ve `tool_calls` döndürülüyor. `reasoning` alanı atılıyor.
- **Sistem mesajı (Türkçe):** "Sen İş Takip panosunun asistanısın…" Kurallar:
  - kullanıcının dilinde kısa yanıt ver,
  - değişiklik için **yalnızca araçları kullan**, id'leri uydurma, panodaki id'leri kullan,
  - Backlog dışındaki durumlar için başlangıç ve bitiş tarihi zorunlu,
  - tarihler araçlarda ISO biçiminde; kullanıcıya gg.aa.yyyy olarak söyle,
  - silme yok; kullanıcı silme isterse bunun elle yapılması gerektiğini söyle,
  - belirsiz isteklerde önce sor.
  Sistem mesajına bugünün tarihi ve haftanın günü, sorumlu/proje/durum/öncelik listeleri (id + ad) ve işlerin özeti ekleniyor.
- **Pano özeti** (istemciden gelen, sunucuda kırpılan): aktif iş başına `id, title, status, unit, priority, projectId, startDate, dueDate, description` (ilk 300 karakter), son notun ilk 200 karakteri. Uzunluk sınırı ~60 KB; aşılırsa açıklamalar kısaltılıyor. Arşivdeki işler gönderilmiyor.

### Araçlar (`AI_TOOLS`, JSON şema)
- `create_tasks({ tasks: [{ title, description?, unit?, priority?, status?, projectId?, startDate?, dueDate?, note? }] })`
- `update_tasks({ updates: [{ id, title?, description?, unit?, priority?, projectId?, startDate?, dueDate?, add_note? }] })`
- `move_tasks({ moves: [{ id, status }] })`
- `get_task({ id })`: tam açıklamayı ve tüm notları okumak için (yalnızca okuma).

Şemalarda `status`, `priority` ve sorumlu id'leri `enum` ile kısıtlanıyor. Sorumlu enum'u istekteki pano verisinden dinamik olarak kuruluyor.

## İstemci
**Yeni dosya [public/ai.js](public/ai.js)** (`window.AiChat`)
- Panel arayüzü, mesaj listesi ve araç döngüsü burada.
- `app.js`'e küçük bir köprü üzerinden bağlanıyor: `AiChat.init(bridge)`. `bridge` şunları içeriyor: `getBoard()`, `applyTools(calls) → results`, `undo(token)`, `openTask(id)`, `fmtDate`, `esc`.

**[public/app.js](public/app.js)** içindeki köprü fonksiyonları
- `aiBoardSnapshot()`: yukarıdaki özeti ve sorumlu/proje/durum/öncelik listelerini döndürüyor.
- `aiApply(calls)`: bir yanıttaki tüm araç çağrılarını **tek bir işlem** olarak uyguluyor.
  - Her çağrı için `JSON.parse(arguments)` ve öğe öğe doğrulama yapılıyor:
    - mevcut `trToISO`/`isoDay` mantığı,
    - sorumlu/proje/durum geçerliliği,
    - Backlog dışındaki durumlar için tarih zorunluluğu (`moveTask`'taki kuralla aynı),
    - bitiş tarihi başlangıçtan önce olamaz.
  - Geçerli öğeler uygulanıyor:
    - **create:** `normalizeTask` ile oluşturuluyor; açıklama `RichEditor.fromPlain` ile çevriliyor; not varsa `normalizeNote` ile ekleniyor.
    - **update:** alanlar yazılıyor; açıklama değişirse `descriptionHtml` ve `description` birlikte güncelleniyor; `add_note` yeni not olarak ekleniyor.
    - **move:** durum değiştiriliyor.
  - Geçersiz öğeler atlanıyor; tool sonucunda neden atlandığı yazılıyor (ör. `"t12: Devam Ediyor için başlangıç/bitiş tarihi gerekli"`). Böylece model düzeltip yeniden deneyebiliyor.
  - Tüm geçerli değişiklikler tek bir `commit(["tasks"], "AI: 2 iş oluşturuldu, 1 iş taşındı")` ile kaydediliyor.
  - **Geri alma kaydı:** etkilenen her işin önceki hali (derin kopya) ve oluşturulan id'ler saklanıyor; bir `undoToken` döndürülüyor.
- `aiUndo(token)`: oluşturulan işler kaldırılıyor, güncellenen ve taşınan işler önceki haline döndürülüyor. Yalnızca o işler değişiyor; kullanıcının arada yaptığı başka değişikliklere dokunulmuyor. Bir iş arada elle silinmiş ya da arşivlenmişse atlanıyor ve kullanıcıya bildiriliyor. Ardından tek `commit`.
- Açık bir modal varken AI değişiklik yapamıyor; böylece kullanıcının modal'da kaydetmediği değişiklik ezilmiyor. Tool sonucunda "kullanıcı bir iş penceresini düzenliyor, kapatmasını iste" mesajı dönüyor.
- `reloadFromServer`: sohbet bir istek beklerken veri dosyadan yeniden yüklenmiyor; böylece yarıda kalan bir araç turu bayat veriyle karışmıyor.

**Panel arayüzü** ([public/index.html](public/index.html), [public/style.css](public/style.css))
- Üst çubukta, "Yeni İş"in yanında **"AI Asistan"** butonu var. Tıklayınca sağda 380 px genişliğinde bir panel açılıyor; pano daralıyor, üstüne binmiyor. Dar ekranda panel tam ekran açılıyor. Açık/kapalı tercihi `localStorage`'da tutuluyor.
- Panelde şunlar var:
  - başlık + "Yeni sohbet" + kapat butonları,
  - mesaj listesi,
  - boşken 3 örnek istek çipi ("Gecikmiş işleri listele", "Yarın bitecek bir iş ekle", "Devam eden işlerin önceliğini yükselt"),
  - çok satırlı giriş alanı (Enter gönderir, Shift+Enter yeni satır),
  - gönder/durdur butonu.
- **Mesaj görünümü:**
  - Kullanıcı ve asistan baloncukları ayrı stilde.
  - Asistan metni `esc` ile kaçışlanıyor; ardından küçük bir biçimlendirici yalnızca **kalın**, satır sonu ve `-` ile başlayan listeleri işliyor. HTML çalıştırılmıyor.
  - Araç uygulandığında bir **eylem kartı** çıkıyor: "✓ 2 iş oluşturuldu · 1 iş taşındı". Altında etkilenen işlerin tıklanabilir başlıkları (iş penceresini açıyor), atlanan öğelerin uyarıları ve **Geri al** butonu yer alıyor. Geri alındıktan sonra kartta "Geri alındı" yazıyor.
  - Bekleme sırasında "Düşünüyor…" göstergesi var. "Durdur" isteği `AbortController` ile iptal ediyor; o turda uygulanmış değişiklikler kalıyor ve geri alınabiliyor.
  - Hatalar kırmızı bir sistem mesajı olarak gösteriliyor (sunucunun Türkçe hata metniyle).
- Sohbet geçmişi bellekte tutuluyor. Modele en fazla son 30 mesaj gönderiliyor; araç mesajları ait oldukları asistan mesajıyla birlikte kırpılıyor.

## Değişecek / eklenecek dosyalar
- [server.js](server.js): `loadEnv`, `/api/ai/chat` uç noktası, `AI_TOOLS` tanımları, sistem mesajı, hata eşleme
- [public/ai.js](public/ai.js) (yeni): panel, mesajlar, araç döngüsü, durdurma
- [public/app.js](public/app.js): `aiBoardSnapshot`, `aiApply`, `aiUndo`, `AiChat.init` köprüsü, `reloadFromServer` koruması
- [public/index.html](public/index.html): "AI Asistan" butonu, panel iskeleti, `ai.js` script etiketi
- [public/style.css](public/style.css): panel, baloncuklar, eylem kartı, `.app.ai-open` yerleşimi
- [README.md](README.md): `.env` kurulumu, örnek istekler, gizlilik notu (panodaki aktif işlerin özeti OpenRouter'a gönderiliyor)
- `.env.example` (yeni): `OPENROUTER_API_KEY=` satırı

Yeniden kullanılacak mevcut parçalar: `normalizeTask`, `normalizeNote`, `RichEditor.fromPlain`/`toPlain`, `trToISO`/`isoDay`/`fmtDate`, `commit`/`Storage.save`, `sameOriginOk`, `readBody`, `esc`, `openModal`, `toast`.

## Checklist
- [x] Sunucu: `.env` okuma ve açılış durum logu (anahtar loglanmıyor)
- [x] Sunucu: `/api/ai/chat` (doğrulama, sabit model/araçlar, zaman aşımı, Türkçe hata eşleme)
- [x] Sunucu: araç şemaları + dinamik enum'lar + sistem mesajı + pano özeti kırpma
- [x] İstemci: `aiBoardSnapshot`, `aiApply` (doğrulama, tek commit, geri alma kaydı), `aiUndo`
- [x] İstemci: modal açıkken değişikliği engelleme; istek beklerken yeniden yüklemeyi engelleme
- [x] `ai.js`: panel, mesaj gösterimi, araç döngüsü (en fazla 6 tur), durdurma, örnek çipler, yeni sohbet
- [x] Eylem kartı: özet, tıklanabilir iş başlıkları, atlanan öğe uyarıları, Geri al
- [x] Stil: sağ panel, pano daralması, dar ekran düzeni
- [x] README + `.env.example`
- [x] Doğrulama (aşağıda)

## Doğrulama
1. **Sahte OpenRouter ile otomatik testler:** Sunucuya gizli bir `OPENROUTER_URL` ortam değişkeni eklenecek (yalnızca test için, varsayılan gerçek adres). Böylece yerel bir sahte sunucu, önceden belirlenmiş `tool_calls` döndürebilecek. Headless Chrome'da (önceki CDP test betiğiyle) şunlar denenecek:
   - "3 iş oluştur": kartlar panoda görünmeli ve `tasks.json`'a yazılmalı.
   - Tarihsiz "Devam Ediyor'a taşı": araç sonucunda hata dönmeli, kart taşınmamalı.
   - Çoklu güncelleme + taşıma: tek commit ile yazılmalı.
   - **Geri al:** dosya önceki hale dönmeli.
   - Modal açıkken araç çağrısı reddedilmeli.
   - Sahte sunucu 401, 429 ve zaman aşımı döndürdüğünde Türkçe hata mesajı görünmeli.
   - `X-Title` başlığı ve sabit model gönderilmeli; istemcinin gönderdiği `model` alanı yok sayılmalı.
   - JS hatası olmamalı.
2. **Güvenlik:**
   - `/api/ai/chat` yanıtında ve tarayıcıya giden hiçbir yerde anahtar bulunmamalı.
   - Yanlış Host ya da Origin ile istek 403 almalı.
   - Asistan metnindeki `<img onerror>` çalışmamalı.
3. **Gerçek OpenRouter:** Kullanıcı `.env`'i oluşturunca canlı bir deneme yapılacak: "Veri Ambarı projesine yarın bitecek kritik bir iş ekle" ve "gecikmiş işleri listele". gpt-oss-120b'nin araç çağrılarını doğru biçimde ürettiği kontrol edilecek. `.env` yoksa bu adım atlanacak ve bu açıkça raporlanacak.
4. **Gerileme:** Önceki uçtan uca test seti (40 kontrol) yeniden çalıştırılacak.
