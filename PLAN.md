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


---

# İş Takip — 11 Yeni İstek Planı

## Context
Kullanıcı 11 istek iletti: 2 hata (popup kapanınca veri kaybı, mailde durum notları eksik), 4 arayüz iyileştirmesi (sekmeler, dar sayaç, seçim kutusu titremesi, geniş arama), 1 işletim aracı (servis kurulumu), 1 altyapı değişikliği (SQLite), 1 saklama kuralı (7 gün) ve 2 büyük özellik (hatırlatmalar, proje sayfaları + LLM).

**Alınan kararlar:**
- ~~7 günlük sınır hem açılış yedekleri hem de arşivlenmiş işler için geçerli.~~ **Güncelleme (kullanıcı kararı):** 8. madde yalnızca yedeklerle sınırlandı; **tek yedek** tutulur. Arşivlenmiş işler otomatik silinmez.
- Pano yalnızca sekmelerle çalışacak; sütun görünümü kalkacak.
- Otomatik başlatma Görev Zamanlayıcı ile yapılacak.
- LLM'e verilecek dosyalar: düz metin, Word ve PDF (PDF'te yalnızca metin katmanı okunur, en iyi çaba).

**Değişmeyen ilkeler:**
- Bağımlılık eklenmiyor. SQLite için Node 24'ün yerleşik `node:sqlite` modülü kullanılacak; denendi: v24.19.0, SQLite 3.53.3.
- Tek yazma akışı korunuyor: `commit` → `Storage.save`, `baseUpdatedAt` ile 409.
- `normalize*` ve `esc` kuralları korunuyor.
- `sameOriginOk` her `/api/*` rotasında çağrılıyor.
- API anahtarı tarayıcıya gitmiyor.

**Çalışma biçimi:** İlk adımda bu plan, mevcut iki planın altına [PLAN.md](PLAN.md) içine eklenecek. Her özellik bitince:
1. headless Chrome ile test edilecek (geçici `DATA_DIR`, port 3917) ve ekran görüntüsüyle doğrulanacak,
2. PLAN.md'deki checklist maddesi `[x]` yapılacak,
3. kullanıcıya **"devam edeyim mi?"** diye sorulacak.

## Önem sırası (gerekçe)
1. **Popup kapanınca veri kaybı:** kullanıcı verisi kayboluyor.
2. **Mailde durum notları:** var olan özellik hatalı.
3. **Arama:** küçük ve hemen fayda sağlıyor.
4. **Seçim kutusu titremesi:** küçük bir CSS düzeltmesi.
5. **Durum sekmeleri + dar sayaç:** ikisi aynı alanı değiştiriyor; sayaç şeridi sekmelere dönüşüyor.
6. **Servis scriptleri:** günlük kullanım kolaylığı; koddan bağımsız.
7. **SQLite altyapısı:** yeni veri türlerinden (hatırlatma, proje notu) **önce** yapılmalı; böylece bunlar baştan yeni altyapı üzerine kurulur.
8. **Yedek saklama (tek yedek):** SQLite yedekleme koduyla birlikte yazılır.
9. **Hatırlatmalar:** yeni özellik, orta büyüklükte.
10. **Proje sayfaları + LLM:** en büyük iş; SQLite'a ve ek altyapısına dayanıyor.

---

## 1. Popup'ın yanlışlıkla kapanması
**Neden:** [app.js:1519](public/app.js#L1519) `overlay.onclick` kullanılıyor. Fare tuşu modalın içinde basılıp dışarıda bırakılınca `click` olayının hedefi overlay oluyor ve modal değişiklikler kaydedilmeden kapanıyor.
- Overlay'de `mousedown` hedefi kaydedilecek. Modal yalnızca **hem mousedown hem click** overlay'in kendisinde olursa kapanacak. Aynı düzeltme onay modalına ve yeni eklenecek modallara da uygulanacak (ortak yardımcı `bindBackdropClose(el, onClose)`).
- **Kaydedilmemiş değişiklik koruması:** `openModal` formun ilk halinin anlık görüntüsünü (`modalSnapshot()`) alacak. Bu görüntüde başlık, editör HTML'i, tarihler, sorumlu, öncelik, proje, durum, notlar, ekler ve not kutusunda bekleyen metin yer alacak. Arka plan tıklaması, Esc ya da İptal ile kapanırken içerik değişmişse `showConfirm` ile sorulacak: "Kaydedilmemiş değişiklikler var — Vazgeç / Kaydetmeden kapat".

## 2. Mailde durum notları
**Bulgular:** `mailTaskHtml` / `mailTaskText` ([app.js:1036](public/app.js#L1036)) yalnızca **son 3 notu** ekliyor. Ayrıca modalda not kutusuna yazılıp "Ekle"ye basılmamış metin, "Mail taslağı" ya da "Kaydet" ile **sessizce kayboluyor**. Kullanıcının gördüğü sorun büyük olasılıkla bu ikincisi.
- `saveTask`, not kutusunda bekleyen metni önce `addNote()` ile nota çevirecek; böylece kaydetme ve mail sırasında not kaybolmayacak.
- Mailde **tüm notlar** yer alacak (yeniden eskiye, tarih ve metinle). Başlık "Durum notları (N)" olacak. Notlardaki satır sonları korunacak.
- Doğrulama: üretilen `.eml` Node'da ayrıştırılıp notların HTML ve düz metin gövdede bulunduğu kontrol edilecek.

## 3. Arama: açıklama ve durum notları
- `filteredTasks` ([app.js:381](public/app.js#L381)) arama yaparken `title + description + notes[].text` alanlarına bakacak. Karşılaştırma `toLocaleLowerCase("tr")` ile yapılacak (İ/ı sorunu olmasın).
- Arşiv araması da aynı yardımcıyı (`taskMatches(t, q)`) kullanacak.
- Arama kutusunun yer tutucu metni: "Başlık, açıklama, notlarda ara…".

## 4. Seçim kutusu titremesi
**Neden:** `.card-check` ve `.col-check` için `display:none ↔ flex` geçişi yapılıyor ([style.css:286-307](public/style.css#L286)). Kutu görünüp kaybolunca başlık metni 23 px kayıyor; sütunda da renk noktasının yerini kutu alıyor.
- Kutunun yeri her zaman ayrılacak: `display:flex` + `opacity:0; pointer-events:none` olacak. Fareyle üzerine gelince ya da seçim varken `opacity:1` olacak ve `transition` ile yumuşakça görünecek. Böylece yerleşim değişmeyecek.
- Kart başlığında kutu ile renk noktası üst üste değil yan yana duracak (sabit genişlik).
- Sekmeli düzende (madde 5) "tümünü seç" kutusu sekme içeriğinin üst çubuğuna taşınacak.

## 5. Durum sekmeleri + dar sayaç alanı
- Geniş pipeline şeridi (`renderPipeline`, `.pipe-node` en az 130 px, 22 px sayılar) **sekme çubuğuna** dönüşecek. Her sekme tek satır olacak: `● Backlog 5`. Sekmeler kompakt (yaklaşık 36 px yükseklik), içerik genişliğinde ve sola yaslı olacak.
- `state.statusTab` mevcut `pipelineFilter`'ın yerini alacak. Her zaman bir sekme seçili olacak. Son seçilen sekme `localStorage`'da (`isTakip.statusTab`) tutulacak.
- Sekme sayıları filtrelere (sorumlu, öncelik, proje, arama, uyarı) göre güncellenecek. Arama yapılırken eşleşme olan diğer sekmeler vurgulanacak.
- **İçerik:** seçili durumun işleri, duyarlı bir kart ızgarasında (`grid-template-columns: repeat(auto-fill, minmax(280px,1fr))`) gösterilecek. Sıralama bugünkü gibi öncelik, sonra termin. Üstte ince bir çubuk olacak: "tümünü seç" kutusu + "N iş".
- **Sürükle-bırak:** kart bir **sekmenin üzerine** bırakıldığında durumu değişecek (mevcut `moveTask` ve tarih kuralı kullanılıyor). Sürükleme sırasında sekmeler bırakma hedefi olarak vurgulanacak.
- `toggleColumn` → `toggleTab` olacak. Uyarı rozetine tıklanınca etkilenen işler başka sekmedeyse, o grubun iş sayısı sekmelerde rozetle gösterilecek.
- Dar ekranda sekme çubuğu yatay kaydırılabilecek.
- AI tarafı `pipelineFilter`'a bağlı değil; etkilenmiyor.

## 6. Servis (otomatik başlatma) scriptleri
Yeni klasör `servis/`, içinde Görev Zamanlayıcı kullanan ve yönetici izni gerektirmeyen dosyalar:
- `servis-kur.bat` → PowerShell `servis.ps1 -Kur`:
  - Node yolunu ve sürümünü (≥ 22.13) doğrular.
  - `Register-ScheduledTask` ile "IsTakip" görevini oluşturur:
    - tetikleyici: oturum açılışı (geçerli kullanıcı),
    - eylem: `node.exe server.js` (çalışma klasörü proje kökü, gizli pencere),
    - ayarlar: çökerse 1 dakikada bir yeniden başlat (3 kez), süre sınırı yok, pilde de çalış.
  - Görevi hemen başlatır ve `http://localhost:3000` adresinin yanıt verdiğini kontrol eder.
- `servis-kaldir.bat`: görevi durdurur, çalışan `node server.js` sürecini (komut satırı ile eşleştirerek) kapatır ve görevi siler.
- `servis-durum.bat`: görev durumu, son çalışma sonucu ve portun yanıt verip vermediği.
- Loglama: sunucu çıktısı `data/../logs/server.log` dosyasına yönlendirilir (sarmalayıcı `servis/calistir.cmd`; log 5 MB'ı aşınca döndürülür). `logs/` `.gitignore`'a eklenecek.
- `baslat.bat`: servis zaten çalışıyorsa yalnızca tarayıcıyı açacak (port kontrolü), yeni sunucu başlatmayacak.
- README'ye "Otomatik başlatma" bölümü eklenecek.

## 7. SQLite altyapısı
**Yaklaşım:** İstemci API'si aynı kalıyor (`GET /api/state`, `PUT /api/<tür>` + `baseUpdatedAt`). Böylece `Storage`, `commit` ve çakışma kontrolü değişmiyor; değişiklik büyük ölçüde [server.js](server.js) içinde.
- `const { DatabaseSync } = require("node:sqlite")`, dosya `data/is-takip.db`.
  - `PRAGMA journal_mode=DELETE; synchronous=FULL; foreign_keys=ON`. (Uygulama sırasında WAL yerine DELETE seçildi: süreç zorla kapatılınca WAL kipinde veri `-wal` dosyasında kalıyor ve `.db` tek başına eksik görünüyordu. `data/` git'te izlendiği için bu önemli.)
  - Açılışta `PRAGMA integrity_check`; bozuksa sunucu açık bir hatayla durur.
- **Şema (v1):**
  - `meta(kind TEXT PRIMARY KEY, updated_at TEXT NOT NULL)`: türlerin sürüm damgası (409 için).
  - `items(rowid, kind TEXT NOT NULL, id TEXT, pos INTEGER NOT NULL, data TEXT NOT NULL)` + `INDEX(kind,pos)`: her kayıt bir JSON belge. Sıra `pos` ile korunuyor. Tür listesi `KINDS` (sonradan `reminders` ve `projectNotes` eklenecek).
  - `attachments(id TEXT PRIMARY KEY, name, type, size, uploaded_at)`: ek bilgileri. **Dosya içeriği diskte kalıyor** (`data/attachments/<id>`), çünkü büyük ikili veriler DB'yi ve her yedeği şişirir.
  - `att_text(id PRIMARY KEY, text, status, extracted_at)`: LLM için çıkarılmış metin önbelleği (madde 10).
  - `schema_version` için `PRAGMA user_version`.
- `readKindFull` / `writeKind` SQL'e taşınacak. `writeKind` tek bir `BEGIN IMMEDIATE` işleminde şunları yapacak: sürüm kontrolü → `DELETE kind` → toplu `INSERT` → `meta` güncellemesi. Kuyruğa ve `renameWithRetry`'a artık gerek kalmıyor (eklerde ve `ai-models.json`'da kullanılmaya devam ediyor).
- **Göç (bir kerelik, otomatik):** DB boşsa ve `data/*.json` dosyaları varsa:
  - hepsi tek işlemde içe aktarılacak (`updatedAt` korunacak),
  - `attachments/*.json` dosyaları tabloya alınacak,
  - özgün JSON dosyaları `data/json-yedek-<zaman>/` klasörüne **taşınacak**, silinmeyecek,
  - logda "N iş, M proje göç edildi" yazacak.
  - JSON dosyaları bozuksa göç yapılmayacak ve sunucu durup hatayı gösterecek.
- `ai-models.json` (gizli anahtarlar) **dosya olarak kalacak**; yedeğe girmemesi kuralı korunuyor.
- **Yedek:** açılışta (`listen` sonrası) `VACUUM INTO 'backup/<zaman>.db'` ile tutarlı tek dosyalık bir yedek alınacak. Eski klasör yedekleri okunmaya devam edecek, temizlik kuralı her ikisine de uygulanacak (madde 8).
- Sahipsiz ek temizliği, ekleri DB'deki `tasks`, `archive` ve (sonra) `projectNotes` kayıtlarından toplayacak.
- `tools/demo-veri.js`: JSON dosyalarını kopyalayarak aldığı yedek, DB yedeği alacak şekilde (`VACUUM INTO` ile ya da sunucudaki yeni `POST /api/backup` rotası, `sameOriginOk` ile) güncellenecek.
- `baslat.bat` ve servis betiği Node ≥ 22.13 olduğunu kontrol edecek.
- **Not:** `data/` git'te izleniyor; artık `is-takip.db` ikili dosyası izlenecek. `*.db-wal` ve `*.db-shm` `.gitignore`'a eklenecek.

## 8. Yedek saklama: yalnızca tek yedek
**Karar değişikliği:** Kullanıcı bu maddeyi "yalnızca 1 yedek tutacak şekilde" sınırladı. 7 günlük saklama ve arşivlenmiş işlerin otomatik silinmesi **yapılmayacak**; arşivdeki işler süresiz kalır.
- `KEEP_BACKUPS = 30` kaldırıldı. Yeni yedek (`VACUUM INTO`) **başarıyla alındıktan sonra** `data/backup/` içindeki diğer tüm yedekler silinir: eski `.db` dosyaları, JSON dönemi klasörleri ve `demo-oncesi-*` dahil. Yedek alınamazsa eskilere dokunulmaz.
- Kural hem açılış yedeğinde hem `POST /api/backup` ile alınan yedekte (demo betiği) geçerli.
- Boş veritabanının yedeği alınmaz; bu durumda eski yedekler korunur.
- `backup/` içindeki yedek olmayan dosyalara (klasör ya da `.db` dışındakiler) dokunulmaz.

## 9. Hatırlatmalar / kişisel notlar
**Güncelleme (kullanıcı isteği):** Hatırlatmalar ve kişisel notlar **ayrıldı**. Tarih yalnızca hatırlatmalarda var.
- **Notlarım** ayrı sayfa ve ayrı tür: `memos` `{ id, text (≤5000), taskId, createdAt, updatedAt }` (`normalizeMemo`). Tarih/saat alanı yok; zamanlar otomatik tutulur, liste en son güncellenen başta. Arama (metin + bağlı iş başlığı), satır içi düzenleme (değişiklik yoksa zaman güncellenmez), silme, isteğe bağlı iş bağlantısı. Enter yeni satır, Ctrl+Enter ekler/kaydeder. Kodda adı `memos`, çünkü işlerdeki "durum notları" alanı `notes`.
- İş penceresindeki bölüm "Hatırlatmalar ve notlarım" oldu: bağlı hatırlatmalar + notlar, "Hatırlatma ekle" / "Not ekle" butonları.
- Yedek dışa ve içe aktarmaya `memos` eklendi; eski sunucu uyarısı `meta.memos`'u da kontrol ediyor.

- Yeni tür `reminders`: `{ id, text (≤2000), date (ISO, zorunlu), time ("HH:MM" | ""), taskId ("" | id), done, doneAt, createdAt }`. `normalizeReminder` yazılacak (`SAFE_ID`, tarih ve saat doğrulamasıyla). Sunucuda `KINDS` ve rota regex'i genişletilecek; yedek dışa ve içe aktarmaya eklenecek.
- **Görünüm:** kenar çubuğuna "Hatırlatmalar" sekmesi gelecek (Pano · Projeler · Hatırlatmalar · Arşiv · Ayarlar).
  - Üstte hızlı ekleme satırı: metin, gg.aa.yyyy tarih (mevcut maske ve takvim butonu yeniden kullanılıyor), opsiyonel saat, opsiyonel "İşe bağla" (aktif işlerden aranabilir bir seçici).
  - Liste gruplara ayrılacak: Gecikmiş / Bugün / Yaklaşan (7 gün) / Daha sonra / Tamamlanan (katlanır).
  - Her satırda tamamlama kutusu, metin, tarih ve saat, bağlı iş çipi (tıklayınca iş modalı açılıyor; iş arşivdeyse "(arşivde)", silinmişse "(silinmiş iş)" yazıyor), düzenleme (satır içi) ve silme bulunacak.
- **Uyarı şeridi:** bugün ve gecikmiş hatırlatmalar için "🔔 N Hatırlatma" rozeti olacak; tıklayınca Hatırlatmalar sayfası açılacak.
- **Saatli hatırlatma:** sayfa açıkken dakikada bir kontrol edilecek; saati gelen hatırlatma için toast ve (izin verilmişse) tarayıcı `Notification` gösterilecek. Tekrar bildirmemek için bildirilenler oturum belleğinde tutulacak.
- **İş bağlantısı:** iş kartında aktif hatırlatma varsa zil simgesi olacak. İş modalında "Hatırlatmalar" bölümü bağlı hatırlatmaları listeleyecek; "Hatırlatma ekle" butonu Hatırlatmalar sayfasını o iş seçili halde açacak.
- AI asistanı bu aşamada hatırlatmalara dokunmayacak; ileride eklenebilir.

## 10. Proje sayfaları + LLM
**Veri:** yeni tür `projectNotes`: `{ id, projectId, title, html, text, attachments[], createdAt, updatedAt }`. `html` `RichEditor.sanitize`'dan, `text` `toPlain` ile türetilecek. `normalizeProjectNote` yazılacak. Proje silinince notlarının aktarılacağı yer sorulacak ya da notlar silinecek (mevcut `deleteProject` diyaloğu genişletiliyor).

**Görünüm:** kenar çubuğuna "Projeler" sekmesi gelecek.
- **Liste:** proje kartları (renk, aktif iş sayısı, gecikmiş sayısı, not ve dosya sayısı); arşivlenmiş projeler ayrı bir grupta.
- **Proje detayı:**
  - Başlık + geri dön butonu.
  - **İşler** özeti: duruma göre sayılar; tıklanınca o proje filtresiyle panoya gidiliyor.
  - **Notlar:** yeniden eskiye kart listesi; içinde arama var.
  - **Dosyalar:** notlardaki tüm ekler (ad, boyut, çıkarılan metin durumu: ✓ okunabilir / ⚠ kısmi / ✗ okunamadı).
  - **Proje asistanı** paneli.
- **Not editörü:** ayrı bir modal (madde 1'deki kapanma korumasıyla). İçinde başlık, `RichEditor` (ikinci örnek; `editor.js` birden fazla örneği desteklemiyorsa küçük bir düzenleme yapılacak), ekler (mevcut `addFiles` / `uploadImage` mantığı genelleştirilecek) ve resim yapıştırma bulunacak.

**Metin çıkarma** (sunucu, bağımlılıksız; sonuç `att_text` tablosunda önbelleğe alınıyor, dosya başına en fazla 200 bin karakter):
- txt / md / csv / json / log: UTF-8 (BOM temizlenerek); geçersizse Windows-1254 ile `TextDecoder`.
- html / eml: etiketler ve başlıklar ayıklanacak; eml'de `text/plain` parçası, quoted-printable ve base64 çözülecek.
- docx: ZIP merkez dizini elle okunacak → `word/document.xml` → `zlib.inflateRawSync` → `w:p` paragraflarına göre metin.
- pdf (en iyi çaba): `FlateDecode` akışları açılacak; `BT…ET` içindeki `Tj` / `TJ` / `'` / `"` metinleri ve kaçış dizileri çözülecek. Okunabilir karakter oranı düşükse "metin çıkarılamadı (taranmış ya da özel fontlu PDF)" olarak işaretlenecek.
- Diğer türler: LLM'e yalnızca dosya adı gidecek.

**LLM uç noktası:** `POST /api/ai/project`, `sameOriginOk` ile, 1 MB gövde sınırı. İstek: `{ projectId, question, noteIds?, attIds?, includeTasks, history[], modelId }`.
- Bağlamı **sunucu kendisi DB'den kuruyor** (istemciden metin almıyor): proje adı, seçilen notların metinleri, dosyaların çıkarılmış metinleri, opsiyonel olarak projenin işlerinin özeti.
- Bütçe: yerleşik OpenRouter modeli için yaklaşık 150 bin karakter, yerel modeller için yaklaşık 40 bin. Aşılırsa eski notlar ve büyük dosyalar orantılı kırpılacak; yanıtta `{ truncated, used: [...] }` dönecek ve arayüz "şu kaynaklar kısaltıldı" diyecek.
- Araç yok; sistem mesajı şunu söyleyecek: "yalnızca verilen kaynaklara dayan, kaynak adını belirt, bilmiyorsan söyle". Mevcut `resolveModel` / `aiHeaders` / `netError` / `stripThink` ve hata eşleme yeniden kullanılacak. Zaman aşımı mevcut değerlerle aynı.
- **Asistan paneli:**
  - kaynak seçimi (notlar ve dosyalar için onay kutuları, "Tümü" varsayılan; işler dahil mi?),
  - hızlı butonlar: "Özet çıkar", "Açık konular / riskler", "Kararlar ve aksiyonlar",
  - serbest soru kutusu ve model seçici (panodaki seçimle aynı `localStorage` anahtarı),
  - sohbet yalnızca bellekte tutuluyor,
  - yanıtlar `ai.js`'teki güvenli biçimlendirici ile gösteriliyor (biçimlendirici ortak hale getirilecek: `AiChat.format`),
  - **"Yanıtı nota kaydet"** butonu yanıtı yeni bir proje notu olarak kaydediyor.
- **Gizlilik:** README'ye eklenecek; ayrıca panelde "Seçilen notlar ve dosya içerikleri seçili modele gönderilir" uyarısı olacak.

---

## Değişecek / eklenecek dosyalar
- [server.js](server.js): SQLite katmanı, göç, tek yedek kuralı, yeni türler, metin çıkarma, `/api/ai/project`, ek bilgilerinin tabloya alınması
- [public/app.js](public/app.js): modal koruması, mail notları, arama, sekmeler, hatırlatmalar, proje sayfaları
- [public/index.html](public/index.html), [public/style.css](public/style.css): sekme çubuğu, yeni görünümler, not modalı, seçim kutusu stili
- [public/editor.js](public/editor.js): gerekirse çoklu örnek desteği
- [public/ai.js](public/ai.js): ortak biçimlendiricinin dışa açılması
- Yeni: `servis/servis.ps1`, `servis-kur.bat`, `servis-kaldir.bat`, `servis-durum.bat`, `calistir.cmd`
- [tools/demo-veri.js](tools/demo-veri.js), `baslat.bat`, `.gitignore`, [README.md](README.md), [CLAUDE.md](CLAUDE.md) (SQLite, yeni türler, servis; "Git deposu değil" bilgisi düzeltilecek), [PLAN.md](PLAN.md)

Yeniden kullanılacaklar: `esc`, `uid`, `safeId`, `HEX_COLOR`, `normalizeTask` / `normalizeNote` / `normalizeAttachment`, `commit`, `Storage.save` / `upload`, `showConfirm` / `showInfo` / `toast`, `trToISO` / `isoToTR` / tarih maskesi ve takvim butonu, `RichEditor.sanitize` / `toPlain` / `fromPlain`, `moveTask` / `needsDates`, `urgency` / `daysBetween`, `resolveModel` / `aiHeaders` / `netError` / `stripThink`, `sameOriginOk` / `readBody` / `send`, `writeFileAtomic`.

---

## Checklist (PLAN.md'ye eklenecek; her madde bitince işaretlenip kullanıcıya sorulacak)
- [x] 0. Bu plan PLAN.md'ye eklendi
- [x] 1. Popup koruması: mousedown/click düzeltmesi + kaydedilmemiş değişiklik onayı (iş modalı, onay modalı)
- [x] 2. Mail: bekleyen not otomatik ekleniyor; tüm durum notları HTML ve düz metinde; eml ayrıştırma testi
- [x] 3. Arama: başlık + açıklama + notlar (tr küçük harf); arşivde de
- [x] 4. Seçim kutuları yerleşimi kaydırmıyor (opacity, sabit yer)
- [x] 5. Durum sekmeleri (dar, sayılı, filtreye duyarlı), kart ızgarası, sekmeye sürükle-bırak, tümünü seç
- [x] 6. Servis betikleri: kur / kaldır / durum, loglama, `baslat.bat` port kontrolü, README
- [x] 7. SQLite: şema, okuma/yazma + 409, JSON'dan otomatik göç (JSON'lar taşınıyor), ek bilgileri tabloda, `VACUUM INTO` yedeği, demo betiği, Node sürüm kontrolü
- [x] 8. Tek yedek: yeni yedek alınınca diğer yedekler silinir (açılış + `/api/backup`); boş DB'de eskiler korunur. (Arşiv otomatik silme kullanıcı kararıyla kaldırıldı.)
- [x] 9. Hatırlatmalar: tür + normalize, sayfa, gruplar, iş bağlantısı, uyarı rozeti, saatli bildirim, kart zil simgesi, modal bölümü
- [x] 9b. Notlarım (tarihsiz kişisel notlar) hatırlatmalardan ayrıldı: `memos` türü, ayrı sayfa, arama, düzenleme, iş bağlantısı, iş penceresi, yedek
- [x] 10a. Proje sayfaları: liste, detay, not modalı (editör + ekler), dosya listesi, proje silme davranışı, sahipsiz ek temizliğine `projectNotes`'un eklenmesi
- [x] 10b. Metin çıkarma (txt/html/eml/docx/pdf) + önbellek
- [x] 10c. `/api/ai/project` + asistan paneli (kaynak seçimi, hızlı butonlar, nota kaydet) + canlı model denemesi
- [x] 11. README + CLAUDE.md güncellemesi; tam gerileme testi (254/254)

## Doğrulama
Bütün testler `DATA_DIR=<scratchpad>/testdata PORT=3917` ile, headless Chrome + CDP üzerinden yapılacak; JS hataları `Runtime.exceptionThrown` ile toplanacak, sonuçlar ekran görüntüsüyle doğrulanacak. Gerçek `data/` klasörüne dokunulmayacak.
1. **Popup:** modal içinde mousedown + overlay üzerinde mouseup → modal açık kalmalı. Değişiklik yapılıp Esc'ye basılınca onay çıkmalı; değişiklik yokken doğrudan kapanmalı.
2. **Mail:** 5 notlu bir iş + kutuda bekleyen not → `.eml` ayrıştırılınca 6 notun hepsi HTML ve düz metinde bulunmalı.
3. **Arama:** yalnızca notta geçen bir kelime ve "İSTANBUL" ile "istanbul" eşleşmesi.
4. **Seçim kutusu:** hover öncesi ve sonrası `card-title` öğesinin `getBoundingClientRect().left` değeri aynı olmalı.
5. **Sekmeler:** sekme sayıları filtreyle değişmeli; kart sekmeye bırakılınca durumu değişmeli; tarihsiz iş Devam'a bırakılınca modal açılmalı; dar ekran görüntüsü alınacak.
6. **Servis:** kur → görev listede ve port 3000 yanıt veriyor; kaldır → görev de süreç de yok. Bu test kullanıcının makinesinde görev oluşturduğu için **kullanıcının onayıyla** yapılacak (test görev adıyla ve 3917 portuyla).
7. **SQLite:** demo JSON verisi olan bir klasörde açılış → göç yapılmalı, JSON'lar `json-yedek-*` klasörüne taşınmalı, arayüz aynı veriyi göstermeli. İki sekmede 409. `VACUUM INTO` yedeği açılabilmeli. Bozuk JSON'da göç yapılmamalı.
8. **Tek yedek:** sahte eski yedekler (JSON klasörü, eski `.db`, `demo-oncesi-*.db`) + yedek olmayan dosya → açılıştan sonra yalnızca yeni yedek ve yedek olmayan dosya kalmalı; boş DB'de eskiler korunmalı; `/api/backup` sonrası yine tek yedek.
9. **Hatırlatmalar:** ekle / tamamla / düzenle / sil; işe bağlı hatırlatmadan modal açılmalı; bugün tarihli hatırlatma uyarı rozetinde görünmeli; 1 dakika sonrasına saatli hatırlatma → toast.
10. **Proje:** not + docx + pdf + txt ekle → çıkarma durumları doğru görünmeli. Sahte LLM sunucusuna giden istekte kaynak metinleri bulunmalı, `apiKey` bulunmamalı. Kırpma uyarısı gösterilmeli. Gerçek modelle kısa bir özet denemesi yapılacak.
11. **Gerileme:** arşivleme, geri alma, AI araçları ve Geri al, içe/dışa aktarma (yeni türler dahil), çakışma, yanlış Host/Origin → 403, XSS yükleri.

---

# İş Takip — 12 Yeni İstek Planı

## Context
Önceki plan ("11 Yeni İstek") tamamlandı. Kullanıcı şu istekleri iletti:
- **Arayüz düzeltmeleri:** dar ekranda alt alta gelen kartlar arasında boşluk kalması; seçim kutusu yüzünden iş başlığının içeride görünmesi; kenar çubuğundaki gezinme ızgarasında başlıkların hizasız olması.
- **Ölçeklenme:** sorumlu ve proje sayısı arttıkça hem sol kenar çubuğu hem de iş penceresi bozuluyor.
- **Veri modeli:** ekibin altında **çalışan** olacak; bir işe **birden fazla ekip ve çalışan** atanabilecek.
- **Ayarlar:** sorumlu ve proje yönetimi daha profesyonel olacak (çalışanlar dahil).
- **Yeni özellikler:** takvim (aylık + haftalık), AI'nin hatırlatma ve Notlarım kayıtlarını yönetebilmesi.
- **Kod yapısı:** tek dosyalık uzun yapılar (app.js 2580, server.js 908, index.html 617, style.css 808 satır) modüllere bölünecek.

**Alınan kararlar (kullanıcı):**
- Her çalışan **tek bir ekibe** bağlı. Bir işe birden fazla ekip ve çalışan seçilebilir. Çalışan seçilince ekibi de otomatik seçilir. Çalışan seçmeden yalnızca ekip seçmek de mümkün.
- Kenar çubuğu filtreleri **aranabilir, katlanır listeler** olacak. İş penceresinde **aranabilir çoklu seçim** kutusu kullanılacak.
- Kod **ES modüllerine** bölünecek (istemci: `public/js/`, sunucu: `lib/` altında CommonJS), derleme adımı yok. Bu iş **ilk** yapılacak.
- Takvim: **aylık + haftalık** görünüm. Gantt ve rapor sayfası bu planda yok.

**Değişmeyen ilkeler** (CLAUDE.md): bağımlılık yok; tek yazma akışı (`commit` → `Storage.save`, `baseUpdatedAt` ile 409); `normalize*` + `esc`; `sameOriginOk`; API anahtarı tarayıcıya gitmez; DB `listen` sonrası açılır.

**Çalışma biçimi:** plan PLAN.md'nin sonuna eklenecek. Her madde bitince headless Chrome ile test edilecek (`DATA_DIR=<scratchpad>`, port 3917) ve ekran görüntüsüyle doğrulanacak. Ardından checklist işaretlenip "devam edeyim mi?" diye sorulacak.

---

## 1. Kodun modüllere bölünmesi (davranış değişmez)
**İstemci** — `public/js/` (`<script type="module" src="js/main.js">`). `editor.js`, `eml.js`, `ai-models.js` ve `ai.js` de modüle çevrilecek. `window.RichEditor` gibi globaller kaldırılıp `import` kullanılacak:
- `core/`: `config.js` (STATUSES, PRIORITIES, DEFAULT_UNITS, ICON), `utils.js` (`$`, `esc`, `uid`, `safeId`, tarih yardımcıları, `searchKey`), `state.js` (`state`, `normalize*`, `setUnits`, `UNIT_MAP`), `storage.js` (`Storage`, `commit`), `ui.js` (`showConfirm`, `showInfo`, `toast`, `bindBackdropClose`), `domain.js` (`urgency`, `needsDates`, `moveTask`, `taskMatch`, `filteredTasks`).
- `views/`: `sidebar.js`, `board.js` (sekmeler, kartlar, sürükle-bırak, seçim), `alerts.js`, `reminders.js`, `memos.js`, `projects.js` + `project-assistant.js`, `archive.js`, `settings.js`, `calendar.js` (madde 7).
- `modals/`: `task-modal.js`, `project-note-modal.js`.
- `features/`: `mail.js`, `ai-bridge.js` (`aiApply`, `aiUndo`, board özeti), `backup.js` (içe/dışa aktarma), `reminder-notify.js`.
- `main.js`: `boot()`, `bind()`, `renderAll()`.
- Döngüsel bağımlılık olmaması için `renderAll` bir olay/kayıt mekanizmasıyla çağrılacak: `core/render.js` içinde `registerRenderer(fn)` ve `renderAll()`.
- **HTML:** `public/index.html` yalnızca iskelet olarak kalacak. Sayfalar `public/partials/*.html` dosyalarına taşınacak (`board`, `projects`, `reminders`, `memos`, `archive`, `settings`, `task-modal`, `project-note-modal`, `ai-panel`). Sunucu, `index.html` isteğinde `<!-- @include partials/x.html -->` satırlarını birleştirecek (`lib/static.js`; dosya değişim zamanına göre önbellek, yalnızca `partials/` altından, `..` reddedilir). Böylece tarayıcı tek bir HTML alır ve ek istek ya da zamanlama sorunu olmaz.
- **CSS:** `public/css/` altında `base.css` (değişkenler), `layout.css`, `sidebar.css`, `board.css`, `modal.css`, `pages.css`, `settings.css`, `ai.css`. `index.html` bunları sırayla `<link>` ile yükleyecek.

**Sunucu** — `server.js` yalnızca başlatıcı olarak kalacak. `lib/` altına bölünecek: `config.js` (`.env`, sabitler), `http-util.js` (`send`, `readBody`, `sameOriginOk`), `db.js` (`openDb`, `readKindFull`, `writeKind`, `migrateFromJson`, `backupDb`), `attachments.js` (yükleme, sahipsiz ek temizliği, `attText`), `ai-common.js` (`resolveModel`, `aiHeaders`, `netError`, `stripThink`, model kaydı), `ai-board.js` (`aiChat`, araç şemaları, sistem mesajı), `ai-project.js` (`projectContext`, `fitBudget`), `static.js`, `routes.js`. `extract.js` → `lib/extract.js`.

**Doğrulama:** 11. maddedeki gerileme testleri, değişiklik öncesi ve sonrası aynı demo veriyle çalıştırılacak: `/api/state` aynı olmalı, ekran görüntüleri aynı olmalı, konsol hatası olmamalı. Servis betikleri `server.js`'i çağırdığı için değişmeyecek (kontrol edilecek). CLAUDE.md'deki dosya tablosu güncellenecek.

## 2. Arayüz düzeltmeleri
- **Kart boşlukları:** `.tab-grid` CSS grid'i, satırdaki en uzun kart kadar yükseklik ayırdığı için alt alta gelen kartlar arasında boşluk kalıyor. Yerine **masonry düzeni** gelecek: `board.js` kartları N sütuna dağıtacak (sütun sayısı genişlikten hesaplanır: `minmax(280px)` mantığı). Her kart en kısa sütuna eklenir. Okuma sırası soldan sağa korunur. `ResizeObserver` ile sütun sayısı değişince yeniden dağıtılır. Sürükle-bırak ve seçim bundan etkilenmez.
  - *Varsayım:* sorun bu. Ekran görüntüsüyle doğrulanacak; farklıysa düzeltilecek.
- **Seçim kutusu:** `.card-check` başlığın solundan çıkarılıp sağdaki arşiv ve silme ikonlarının yanına (onlardan önce) taşınacak. Başlık kartın sol kenarıyla hizalı olacak. Kutu yine opacity ile gizlenecek. Seçim varken (`board.selecting`) bütün kartlarda görünür kalacak.
- **Gezinme ızgarası:** `.view-switch` 2 sütunlu ızgarada ikon ve metinler ortalı, rozetler ise metni kaydırıyor. Bunun yerine **tek sütunlu dikey gezinme menüsü** gelecek: sabit ikon sütunu (16 px), sola yaslı başlık, sağa yaslı sayaç rozeti; aktif öğede sol vurgu çizgisi. Takvim sekmesi de buraya eklenecek (madde 7).

## 3. Veri modeli: ekipler, çalışanlar, çoklu atama
- **`units`** (ekipler) türüne `members: [{ id, name, active }]` alanı eklenecek. `normalizeUnit` üyeleri `SAFE_ID` ile ve ad ≤ 80 karakter olacak şekilde doğrulayacak. Ayrı bir tür açılmayacak; sunucu `KINDS` aynı kalacak.
- **Görevler:** `unit: "id"` → `units: ["id", …]` (en az 1) + `members: ["id", …]`.
  - `normalizeTask` eski `unit` alanını `units: [unit]` olarak göç ettirecek (eski yedekleri içe aktarırken de).
  - Seçilen çalışanın ekibi `units` içinde yoksa otomatik eklenecek.
  - Bilinmeyen ekip veya çalışan korunacak ve "(silinmiş …)" olarak görünecek.
  - Kaydetmede `unit` alanı yazılmayacak. Sunucu türden bağımsız JSON sakladığı için göç istemcide yapılacak; ilk `commit`'te yazılacak.
- **Etkilenen yerler** (`grep \.unit` ile 69 kullanım): filtre (`filteredTasks`: işin ekiplerinden biri ya da çalışanlarından biri eşleşirse), kart etiketleri (en çok 2 ekip + "+N", çalışan baş harfleri), uyarı satırları, mail (`mailTaskHtml`/`Text`), arşiv, demo betiği, ekip silme (işler hedef ekibe aktarılır, çalışanlar da taşınabilir), içe aktarma.
- **AI (pano asistanı):** board özeti ve araç şemaları (`lib/ai-board.js`) `units[]` ve `members[]` alanlarını kullanacak. `create_tasks`/`update_tasks` ekip ve çalışan **adı veya id'si** kabul edecek. `list_tasks` ekip ya da çalışan filtresi alacak. Sistem mesajında ekip ve çalışan listesi yer alacak. Proje asistanının iş özeti de ekip ve çalışan adlarını gösterecek.

## 4. Ölçeklenen seçiciler
- **Ortak bileşen** `components/multi-select.js`: aranabilir açılır liste; ekipler grup başlığı, çalışanlar onun altında görünür. Klavye desteği (↑↓, Enter, Esc). Seçilenler çip olarak gösterilir ve çipteki × ile kaldırılır. Tekli seçim kipi de olacak. Arama `searchKey` ile yapılacak.
- **İş penceresi:** `fUnitSeg` (buton şeridi) yerine "Sorumlular" çoklu seçicisi (ekip + çalışan) gelecek. `fProject` select'i yerine aranabilir tekli seçici gelecek (arşivlenmiş projeler ayrı grupta). `modalSnapshot` yeni alanları içerecek.
- **Kenar çubuğu:** "Sorumlu" ve "Proje" bölümleri katlanır olacak (durum `localStorage`'da). Her bölümde 6 öğeden fazlası varsa arama kutusu çıkacak. İlk 6 öğe gösterilecek, "N tane daha" ile gerisi açılacak. Liste en fazla yaklaşık 40vh yükseklikte olacak ve kendi içinde kayacak.
  - Ekip satırındaki ok ile çalışanlar açılacak. Filtre `state.filterUnit` → `{ type: "unit" | "member", id }` olacak.
  - Seçili filtre, bölüm katlıyken başlıkta çip olarak görünecek.

## 5. Ayarlar: Ekipler ve Projeler
- **Ekipler ve çalışanlar** kartı: arama kutusu ve ekip listesi. Her ekip açılır bir satırdır: renk, ad, iş sayısı, çalışan sayısı, sıralama, sil. Açılınca çalışan listesi görünür: ad (satır içi düzenleme), iş sayısı, pasif yap / sil, "Çalışan ekle" satırı.
  - Çalışan silinirken işi varsa: başka çalışana aktar ya da yalnızca işlerden kaldır (`showConfirm` + `select`).
  - "Pasif" çalışan seçicilerde görünmez ama işlerde korunur.
- **Projeler** kartı: arama, durum filtresi (Aktif / Arşivde / Tümü), sıralama (ad / iş sayısı), satırda iş ve not sayısı ile proje sayfasına bağlantı.
- Görünüm: ortak `settings-table` stili, sabit sütun hizaları, boş durum ve sayaçlar; dar ekranda tek sütun.

## 6. AI: hatırlatma ve Notlarım araçları
- Yeni araçlar (`lib/ai-board.js` şemaları, istemcide `features/ai-bridge.js` → `aiApply`):
  - `create_reminders`, `update_reminders` (metin, tarih, saat, tamamlandı, işe bağlama), `list_reminders`,
  - `create_memos`, `update_memos`, `list_memos`.
- **Silme yok** (görevlerdeki kural korunuyor). Her araç öğe öğe doğrulama yapacak (`normalizeReminder`/`normalizeMemo`, tarih zorunlu, `TIME_RE`), tek `commit` ve `aiUndo` kaydı oluşturacak, `applied: 0` olursa `warning` döndürecek.
- Board özetine yaklaşan hatırlatmaların sayısı ve ilk 20'si eklenecek (notların tam metni gönderilmeyecek; gerekirse `list_memos` ile alınacak). Sistem mesajına kurallar eklenecek: tarih uydurma, saat belirtilmediyse boş bırak.
- Eylem kartları (`ai.js`) hatırlatma ve not için ikon ve "Geri al" gösterecek.

## 7. Takvim sayfası (aylık + haftalık)
- Kenar çubuğuna "Takvim" sekmesi eklenecek. `views/calendar.js`: üst çubukta ‹ Bugün ›, Ay/Hafta düğmesi ve dönem başlığı olacak. Seçili görünüm `localStorage`'da tutulacak.
- **Aylık:** 6×7 ızgara, Pazartesi başlangıçlı. İşler başlangıç–bitiş aralığında **çubuklar** olarak görünecek (hafta satırlarına bölünür, şeritlere yerleştirilir, renk önceliğe ya da ilk ekibe göre). Gün başına 3 şerit gösterilip fazlası "+N" ile belirtilecek. Hatırlatmalar küçük zil satırı olarak görünecek. Bugün vurgulanacak, gecikmiş işler kırmızı kenarlı olacak.
- **Haftalık:** 7 sütun; üstte çok günlük iş çubukları, altta gün başına hatırlatmalar (saatliler saat sırasıyla) ve o gün termini olan işler.
- Tarihi olmayan işler (Backlog) gösterilmeyecek; üst çubukta "N tarihsiz iş" bilgisi olacak.
- Kenar çubuğu filtreleri (ekip/çalışan, öncelik, proje) ve arama takvimde de geçerli olacak. Tamamlanan ve iptal edilen işleri göster/gizle seçeneği olacak.
- İşe tıklayınca iş modalı, hatırlatmaya tıklayınca hatırlatmalar sayfası açılacak. Boş güne çift tıklayınca o tarihli yeni iş modalı açılacak (başlangıç ve bitiş o gün olarak dolu gelecek).

---

## Önem / uygulama sırası
1. Modüllere bölme (sonraki tüm değişiklikler yeni yapıya yazılsın diye ilk sırada)
2. Arayüz düzeltmeleri (küçük ve hemen görünen)
3. Ekip/çalışan veri modeli
4. Ölçeklenen seçiciler (3'e dayanıyor)
5. Ayarlar (3 ve 4'e dayanıyor)
6. AI hatırlatma ve not araçları
7. Takvim

## Yeniden kullanılacaklar
`esc`, `uid`, `safeId`, `searchKey`, `normalize*`, `commit`/`Storage.save`, `showConfirm` (+`select`)/`showInfo`/`toast`, `bindBackdropClose`, `modalSnapshot`, `trToISO`/`isoToTR`/`daysBetween`/`todayISO`, `urgency`/`remGroup`/`needsDates`, `filteredTasks`/`taskMatch`, `swatches`/`nextColor`, `aiApply` doğrulama kalıbı ve `aiUndo`, `resolveModel`/`aiHeaders`.

## Kritik dosyalar
`public/app.js` → `public/js/**`; `public/index.html` + `public/partials/*`; `public/style.css` → `public/css/*`; `server.js` → `lib/*`; `extract.js` → `lib/extract.js`; `tools/demo-veri.js` (ekip/çalışan + çoklu atama); `README.md`, `CLAUDE.md`, `PLAN.md`.

## Checklist (PLAN.md'ye eklenecek)
- [x] 0. Plan PLAN.md'ye eklendi
- [x] 1. Modüller: istemci `public/js/`, partials + sunucu birleştirme, `public/css/`, sunucu `lib/`; gerileme testi öncesi ve sonrası aynı sonucu veriyor
- [x] 2. Masonry kart düzeni, seçim kutusu sağa taşındı, dikey gezinme menüsü
- [x] 3. Ekip/çalışan modeli, çoklu atama, göç, filtre/kart/mail/arşiv/AI uyarlaması, demo veri
- [x] 4. Aranabilir çoklu seçici (bileşen ve iş penceresindeki sorumlular 3. maddede yapıldı); iş penceresinde proje seçimi + kenar çubuğu (katlanır, arama, "daha fazla")
- [x] 5. Ayarlar: ekipler + çalışanlar, projeler (arama, filtre, sıralama)
- [x] 6. AI hatırlatma ve not araçları + Geri al
- [x] 7. Takvim (aylık + haftalık), filtreler, tıklama ve yeni iş
- [x] 8. README + CLAUDE.md; tam gerileme testi

## Doğrulama
Tüm testler `DATA_DIR=<scratchpad>/testdata PORT=3917` ile, headless Chrome + CDP üzerinden yapılacak. JS hataları `Runtime.exceptionThrown` ile toplanacak, sonuçlar ekran görüntüsüyle doğrulanacak. Gerçek `data/` klasörüne dokunulmayacak.
1. **Modüller:** bölmeden önce ve sonra demo veriyle `/api/state` ve tüm sayfaların ekran görüntüleri karşılaştırılacak. Eski gerileme senaryoları (arşiv, geri alma, AI + Geri al, içe/dışa aktarma, 409, yanlış Host/Origin → 403, XSS yükleri) çalıştırılacak. `partials` yol kaçışı (`..`) denenecek.
2. **Arayüz:** 1400 / 900 / 600 px genişlikte kartlar arasındaki dikey boşluk ≤ 12 px olmalı. Seçim kutusunun hover öncesi ve sonrası başlığın `left` değeri, kartın iç kenarına eşit olmalı.
3. **Veri modeli:** eski biçimde (`unit`) veri → açılış → kayıttan sonra `units[]` olmalı. Eski yedeği içe aktarma çalışmalı. Çalışan seçilince ekibi eklenmeli. Ekip silinince aktarma yapılmalı. Mailde tüm sorumlular yer almalı.
4. **Seçiciler:** 40 ekip, 150 çalışan ve 60 projelik sentetik veri → kenar çubuğu ve modal taşmamalı, arama Türkçe harf duyarsız çalışmalı, klavye ile seçim yapılabilmeli. Ekran görüntüsü alınacak.
5. **Ayarlar:** çalışan ekle/düzenle/pasif yap/sil + aktarma; proje araması.
6. **AI:** sahte LLM sunucusu ile `create_reminders` → hatırlatma oluşmalı, Geri al ile kalkmalı; geçersiz tarih → `warning` dönmeli; şemada silme aracı olmamalı. Sentetik veriyle canlı model denemesi yapılacak.
7. **Takvim:** ay ve hafta geçişleri; 3 haftaya yayılan işin çubuğu doğru bölünmeli; filtre takvime yansımalı; çift tıklamayla açılan modalda tarih dolu gelmeli; dar ekran görüntüsü alınacak.

`server.js`/`lib/` değiştiği için her sunucu değişikliğinden sonra kullanıcıya `servis\servis-kur.bat` ile sunucuyu yeniden başlatması hatırlatılacak.

---

# İş Takip — Ekip/Çalışan Mail Adresleri Planı

## Context
Mail taslağı (`.eml`) `To:` alanı boş oluşturuluyordu; alıcılar Outlook'ta elle ekleniyordu. İstek: ekip ve çalışan tanımlarına **mail adresi** eklenmesi ve taslakta alıcıların otomatik dolması. Adresi tanımlı olmayan ekip/çalışan atlanır; hiç adres yoksa `To:` boş kalır.

**Alınan kararlar (kullanıcı):** her işte, işin her ekibi için:
- İşte o ekipten adresi tanımlı **çalışan varsa** → çalışan(lar) **To**, ekip adresi **CC**.
- O ekipten çalışan yoksa (ya da çalışanların adresi yoksa) → ekip adresi **To**.
- Ekibin adresi yoksa yalnızca çalışan(lar) To'ya gider.

Birden fazla iş seçilince adresler tekrarsız birleştirilir; bir adres hem To hem CC'ye düşerse yalnızca To'da kalır. Pasif çalışan işe atanmışsa adresi dahil edilir. Alıcılar görünen adla yazılır (`Ad <adres>`, RFC 2047). Mail adresleri AI'ye gönderilmez. Ayrı tür yok; `units` kaydına alan eklenir, sunucu değişmez.

## 1. Veri modeli (`core/state.js`)
`normEmail` (ASCII, boşluk/`<>",;` yok, ≤ 254; CR/LF başlık enjeksiyonuna karşı güvenlik önlemi). `normalizeUnit`: ekip ve çalışanlara `email`. `MEMBER_MAP`'e `email`. `mailRecipients(tasks)` → `{ to, cc, missing }`.

## 2. Ayarlar (`views/settings.js`, `css/settings.css`)
Ekip ve çalışan satırlarında mail alanı; boş → silinir, geçersiz → uyarı + eski değer; arama adreste de eşleşir; dar ekranda satır sarar.

## 3. Mail (`components/eml.js`, `features/mail.js`)
`Eml.build({ to, cc })` → `To:` / `Cc:` başlıkları (katlanmış). Bilgi mesajında Kime/CC sayısı ve adresi eksik olanlar.

## 4. Demo veri ve belgeler
`tools/demo-veri.js` örnek `@example.com` adresleri (bazıları boş); README, CLAUDE.md.

## Checklist
- [x] 0. Plan PLAN.md'ye eklendi
- [x] 1. Veri modeli: `email` alanı, `normEmail`, `mailRecipients`
- [x] 2. Ayarlar: ekip ve çalışan mail alanları (doğrulama, arama, dar ekran)
- [x] 3. Mail taslağı: `To:` / `Cc:` alıcıları, bilgi mesajı
- [x] 4. Demo veri, README, CLAUDE.md; test + ekran görüntüleri

## Doğrulama
`DATA_DIR=<scratchpad>/testdata PORT=3917`, headless Chrome + CDP. Ayarlar: adres gir/boşalt/geçersiz (`abc`, `a@b`, CR/LF içeren) → `/api/state`. Mail: çalışanlı iş (çalışan To, ekip CC), yalnız ekipli iş (ekip To), adressiz çalışan (ekip To), adressiz ekip (çalışan To), adres yok (`To:` boş), iki ekipli karışık iş, çok iş seçiminde tekrarsız birleşim; indirilen `.eml` başlıkları ayrıştırılarak doğrulanır. Eski veri (email yok) sorunsuz açılmalı; AI pano özetinde email olmamalı.
