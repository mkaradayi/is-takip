# İş Takip — Proje Rehberi (AI agent'lar için)

Yerel çalışan, **bağımlılıksız** bir kanban iş takip uygulaması: Node.js sunucusu (yalnızca yerleşik modüller) + vanilla JS arayüz. Kullanıcı Windows'ta, arayüz ve kod yorumları **Türkçe**. Kullanıcıya Türkçe yanıt verin.

- Çalıştırma: `baslat.bat` (Windows) ya da `node server.js` → http://localhost:3000
- Git deposu **değil**. Commit yok; değişiklik geçmişi bu dosyanın sonundaki "Geliştirme geçmişi" bölümünde.
- Son kullanıcı belgesi: [README.md](README.md). Geçmiş planlar ve checklist'ler: [PLAN.md](PLAN.md).

## Değişmez ilkeler (bunları bozmayın)
1. **Bağımlılık yok.** npm paketi eklenmez; `.env` elle ayrıştırılır, HTTP için yerleşik `fetch`/`http` kullanılır.
2. **Veri dosyada.** Tüm veri `data/*.json` dosyalarında durur, tarayıcı depolamasında değil. `localStorage` yalnızca arayüz tercihleri içindir (panel açık mı, seçili model).
3. **Tek yazma akışı (istemci):** state'i değiştir → `commit(kinds, mesaj)` → `renderAll()` + `Storage.save(kinds)`. AI'nin yaptığı değişiklikler de aynı yoldan geçer.
4. **Dosyadan gelen her değer `normalize*` fonksiyonlarından geçer** (id'ler `SAFE_ID = /^[\w-]{1,64}$/`, renkler `#rrggbb`). Bu değerler HTML attribute'larına kaçışsız gömüldüğü için bu doğrulama bir **güvenlik** önlemidir.
5. **Metin her zaman `esc()` ile basılır.** Zengin metin (açıklama) yalnızca `RichEditor.sanitize` beyaz listesinden geçtikten sonra HTML olarak kullanılır.
6. **Atomik yazım + çakışma kontrolü:** sunucu geçici dosyaya yazıp yeniden adlandırır (Windows için `renameWithRetry`). İstemci her PUT'ta `baseUpdatedAt` gönderir; dosya başka yerde değiştiyse 409 döner ve istemci "Sayfayı yenile" gösterir.
7. **Yüklenmeden yazma yok:** `Storage` sunucudan başarıyla okumadan kaydetmez; hata durumunda `fatalOverlay` açılır ve `.app` öğesi `inert` yapılır.
8. **API anahtarları tarayıcıya asla gitmez** (`.env`, `data/ai-models.json`).
9. Sunucu yalnızca `127.0.0.1`'e bağlanır. `sameOriginOk` hem **Host** (DNS rebinding) hem **Origin** başlığını kontrol eder; her `/api/*` rotası bu kontrolü çağırmalı.

## Dosyalar
| Dosya | İçerik |
|---|---|
| [server.js](server.js) | HTTP sunucu, statik dosyalar, JSON veri API'si, ekler, açılış yedeği, sahipsiz ek temizliği, `.env` okuma, AI aracısı (OpenRouter + OpenAI uyumlu yerel modeller), model kaydı |
| [public/index.html](public/index.html) | Tüm DOM: kenar çubuğu, Pano / Arşiv / Ayarlar sayfaları, iş modalı, onay modalı, seçim çubuğu, AI paneli |
| [public/app.js](public/app.js) | Ana uygulama (IIFE). Bölümler: CONFIG → UTILS → STATE/normalize → STORAGE → DOMAIN → VIEWS → İŞ MODALI → eylemler → AI köprüsü → yedek → INIT (`bind()`, `boot()`) |
| [public/editor.js](public/editor.js) | `window.RichEditor`: `contenteditable` editör + `sanitize` / `toPlain` / `fromPlain` |
| [public/eml.js](public/eml.js) | `window.Eml.build(...)`: MIME `.eml` taslak oluşturucu (Outlook için `X-Unsent: 1`) |
| [public/ai.js](public/ai.js) | `window.AiChat`: sağdaki sohbet paneli, araç döngüsü, durdurma, eylem kartları / Geri al |
| [public/ai-models.js](public/ai-models.js) | `window.AiModels`: Ayarlar → AI Modelleri (kayıt / test / seçim) |
| [public/style.css](public/style.css) | Tüm stiller (CSS değişkenleri `:root` içinde) |
| [tools/demo-veri.js](tools/demo-veri.js) | Demo veri yükleyici (`--sil` ile kaldırır); çalışan sunucunun API'sini kullanır |
| `baslat.bat` | Node kontrolü, tarayıcıyı 2 sn gecikmeyle açar, sunucuyu başlatır |
| `.env` / `.env.example` | `OPENROUTER_API_KEY=...` (`.env` gizli; içeriğini okumayın veya yazdırmayın) |

Script yükleme sırası önemli: `editor.js` → `eml.js` → `ai-models.js` → `ai.js` → `app.js`. `app.js` içindeki `bind()`, `AiModels.init` ve `AiChat.init`'i çağırır.

## Veri modeli (`data/`)
Her tür dosyası şu biçimde: `{ schemaVersion: 1, updatedAt: ISO, items: [...] }`. Düz dizi biçimi de okunur.

- **tasks.json / archive.json**: iş nesneleri:
  - `id, title, description` — `description` düz metindir; `descriptionHtml`'den türetilir, arama ve önizleme için kullanılır
  - `descriptionHtml` — temizlenmiş HTML
  - `unit` — sorumlu id
  - `priority`: `kritik | yuksek | orta | dusuk`
  - `status`: `backlog | beklemede | devam | tamamlandi | iptal`
  - `projectId` (`""` = projesiz)
  - `startDate, dueDate` — **ISO YYYY-AA-GG**; ekranda gg.aa.yyyy gösterilir
  - `createdAt, updatedAt` — gün biçiminde
  - `notes[{ id, text, date, createdAt }]`
  - `attachments[{ id, name, size, type, uploadedAt }]`
  - `archivedAt` — yalnızca arşivdeki işlerde
- **projects.json**: `{ id, name, color, status: aktif | arsivlenmis }`
- **units.json**: sorumlular `{ id, name, color, order }`. Dosya yoksa veya boşsa `DEFAULT_UNITS` kullanılır ve ilk değişiklikte dosya oluşur. Bilinmeyen bir `unit` olduğu gibi korunur ve "(silinmiş sorumlu)" olarak gösterilir.
- **attachments/**: `<id>` (dosyanın kendisi) + `<id>.json` (`{ name, type, size }`).
- **ai-models.json**: `{ items: [{ id, name, baseUrl, model, apiKey }] }` — **anahtarlar düz metin**. Bu dosya yedeğe ve dışa aktarmaya dahil değildir.
- **backup/**: her başarılı açılışta zaman damgalı bir klasör oluşur (son 30 tutulur). `demo-oncesi-*` klasörleri demo betiğinin aldığı yedeklerdir.

**İş kuralı (tarih zorunluluğu):** `needsDates(status)` → yalnızca **Beklemede, Devam Ediyor ve Tamamlandı** durumları için başlangıç + bitiş tarihi zorunludur; **Backlog ve İptal için zorunlu değildir**. Bitiş tarihi başlangıçtan önce olamaz. Bu kural elle taşımada (`moveTask`), modal kaydında (`saveTask`) ve AI'da (`aiDateRule`) aynıdır; değiştirirseniz üçünü birlikte değiştirin.

**Termin grupları:** `urgency(t)` ve `urgencyGroup(t)` → `over` (gecikmiş) / `today` (bugün) / `soon` (1–3 gün, `DUE_SOON_DAYS`). Tamamlanan ve iptal edilen işler uyarı vermez.

## Sunucu API'si
| Rota | İş |
|---|---|
| `GET /api/state` | `{ tasks, projects, archive, units, meta: { <tür>: updatedAt } }` |
| `PUT /api/{tasks\|projects\|archive\|units}` | `{ items, baseUpdatedAt }` → atomik yazar; sürüm uyuşmazsa 409 |
| `POST /api/attachments` | ham gövde + `X-File-Name` (URL kodlu), en fazla 25 MB |
| `GET /api/attachments/:id` | `nosniff` + CSP; yalnızca resim/PDF satır içi, gerisi indirme olarak sunulur |
| `POST /api/ai/chat` | `{ messages, board, modelId }` → `{ message, modelName }` |
| `GET/PUT /api/ai/models` | model listesi; yanıtta anahtar yerine `hasKey`. PUT'ta `apiKey` alanı verilmezse mevcut anahtar korunur, `""` verilirse silinir |
| `POST /api/ai/models/test` | `{ baseUrl, apiKey?, id? }` → sunucunun `/models` listesi |

Ortam değişkenleri: `PORT`, `DATA_DIR`, `HOST`, `OPENROUTER_API_KEY`. `OPENROUTER_URL` **yalnızca testte** sahte sunucuya yönlendirmek içindir.

## Özellikler (kısa)
- **Pano**: 5 durum sütunu, sürükle-bırak, öncelik/termin sıralaması, durum hattı (pipeline) filtresi. Kenar çubuğunda sorumlu / öncelik / proje filtreleri ve başlık araması var.
- **Uyarılar**: tek satırlık özet şeridi (Gecikmiş / Bugün / Yaklaşan rozetleri). Rozete tıklamak panoyu filtreler (`state.urgencyFilter`). "Ayrıntılar" yüksekliği sınırlı ve kaydırmalı bir panel açar (grup başına 6 satır + "+N daha"). Açık/kapalı tercihi `localStorage`'da tutulur.
- **İş modalı**: zengin metin açıklama ve ekler; resim yapıştırma ya da sürüklemeyle resim ek olarak yüklenip `<img src="/api/attachments/ID">` olarak eklenir. Durum notları, maskeli gg.aa.yyyy tarih alanları ve takvim butonu (gizli `input[type=date]` + `showPicker`) var.
- **Seçim + mail**: kart kutusu, Ctrl+tık ve **sütun başlığında "tümünü seç" kutusu** (kısmi seçim durumu da var). Alttaki seçim çubuğundan `.eml` taslak indirilir; içinde HTML gövde, `cid:` satır içi resimler ve ekler bulunur. Ekler 20 MB'ı aşarsa "eksiz oluştur" seçeneği sunulur. İş modalındaki "Mail taslağı" önce kaydeder, sonra taslağı oluşturur. Esc seçimi temizler.
- **Arşiv**: arşivleme, geri alma, kalıcı silme ve arama.
- **Ayarlar** sekmesi:
  - **Sorumlular**: ekleme, yeniden adlandırma, renk (tek nokta + açılır palet), sıralama, silme. İşleri olan bir sorumlu silinirken işlerin aktarılacağı yer sorulur; son sorumlu silinemez.
  - **Projeler**: aynı işlemler + arşivleme; silmede "Projesiz"e ya da başka bir projeye aktarılır.
  - **AI Modelleri**: bkz. aşağıdaki AI bölümü.
  - Kenar çubuğundaki eski "Sorumluları/Projeleri Yönet" butonları kullanıcının isteğiyle **kaldırıldı**; yönetim yalnızca Ayarlar'dan yapılır.
- **Yedek**: JSON dışa ve içe aktarma (units dahil, ekler hariç). İçe aktarma, değiştireceği her şey için önce onay ister.

## AI asistan (önemli ayrıntılar)
- **Mimari:** sunucu yalnızca aracıdır. Sistem mesajını, araç şemalarını ve model sınırlarını **sunucu** belirler; istemci bunları değiştiremez. Araçları **tarayıcı** çalıştırır (`app.js` → `aiApply`) ve sonuçları `tool` mesajı olarak geri gönderir. Kullanıcı mesajı başına en fazla 6 tur.
- **Araçlar:** `create_tasks`, `update_tasks`, `move_tasks`, `list_tasks` (urgency / status / unit / project / priority / due_before / query filtreleri), `get_task`. **Silme ve arşivleme yok** (bilinçli tercih).
- **`aiApply`:** her öğeyi ayrı doğrular (geçerli id'ler, tarih kuralı). Geçerli olanları **tek bir `commit`** ile uygular, geçersizleri `skipped` listesinde nedeniyle döndürür. `applied: 0` ise sonuçta açık bir `warning` alanı bulunur, böylece model "yaptım" diyemez. Her adım için bir geri alma kaydı tutulur (`aiUndo` yalnızca o adımın değiştirdiği işleri geri alır).
- **Modal açıkken** değişiklik reddedilir. AI isteği sürerken `reloadFromServer` çalışmaz.
- **Pano özeti** her işte hazır bir `due` metni taşır ("3 gün gecikti", "bugün bitiyor", "yakında (N gün kaldı)", "N gün kaldı"). Sistem mesajında bugünün tarihi ve günü, **önümüzdeki 14 günün takvimi** ve gecikmiş/bugün/yakın sayıları bulunur.
- **Sistem mesajındaki kurallar** (canlı testlerde çıkan hatalara karşı eklendi): tarih uydurma; id'leri kullanıcıya gösterme; sorumlu verilmediyse ilk sorumluyu, öncelik verilmediyse "orta"yı kullan; özeti yalnızca araç sonucundaki `ok` listesine dayandır; tarihi gg.aa.yyyy biçiminde iste; toplu isteklerde önce `list_tasks` çağır.
- **Modeller:** yerleşik `openrouter` → `openai/gpt-oss-120b` (OpenRouter'a `provider.require_parameters` ve `X-Title` başlıklarıyla gider). Ek modeller OpenAI uyumlu `baseUrl + /chat/completions` adresine gider; zaman aşımı 180 sn. Yanıttaki `<think>…</think>` metni atılır; nesne biçimli araç argümanları string'e çevrilir. Seçili model `localStorage` (`isTakip.aiModel`) anahtarında tutulur.
- **Asistan metni** önce `esc` ile kaçışlanır, ardından yalnızca **kalın**, `kod` ve liste biçimlemesi uygulanır.
- **Gizlilik:** her istekte aktif işlerin özeti (açıklamanın ilk 300 karakteri ve son not dahil) seçili modele gider.

## Test yaklaşımı
Repoda test dosyası **yok**; önceki oturumlarda geçici test betikleri kullanıldı. Aynı yöntemi tekrarlayın:
- **Gerçek veriye dokunmayın.** Testte `DATA_DIR=<geçici klasör> PORT=3917 node server.js` kullanın. `data/` kullanıcının gerçek verisidir; kullanıcının sunucusu genelde 3000 portunda açıktır.
- **Tarayıcı testi:** Chrome'u headless çalıştırın (`chrome.exe --headless=new --remote-debugging-port=9333 --user-data-dir=<geçici>`) ve Node 24'ün yerleşik `WebSocket`'iyle CDP üzerinden sürün: `Runtime.evaluate`, `Page.captureScreenshot`. Konsol hatalarını `Runtime.exceptionThrown` ile toplayın.
- **AI testi:** `OPENROUTER_URL=http://127.0.0.1:<port>/v1` ile sahte bir OpenAI uyumlu sunucuya yönlendirin. Sahte sunucu, kuyruktan sırayla yanıt döndürüp gelen istekleri kaydetmelidir; `GET /models` da desteklenmeli. Gerçek modelle de kısa bir canlı deneme yapın (`.env` anahtarı sunucu tarafından okunur).
- **Demo veri:** `DATA_DIR=... PORT=3917 node tools/demo-veri.js` (28 iş, 4 proje, 3 arşiv kaydı; tarihler bugüne göre: 7 gecikmiş, 3 bugün, 5 yakın).
- `node --check <dosya>` ile sözdizimi kontrolü yapın.
- **`server.js` değişirse** kullanıcıya `baslat.bat` penceresinde Ctrl+C ile sunucuyu yeniden başlatmasını söyleyin. Yalnızca `public/` değiştiyse F5 yeterlidir (statik dosyalar `no-cache` ile sunulur).

## Bilinen tuzaklar
- Port doluyken (`EADDRINUSE`) yedek alınmaz; bu bilinçli bir tercih (yedek `listen` başarılı olduktan sonra alınıyor).
- `.env` ayrıştırıcısı BOM, `export`, tırnaklı değer ve satır sonu yorumu (`KEY="x" # yorum`) destekler. Ortamda zaten tanımlı bir değişken `.env` tarafından ezilmez.
- `document.execCommand` editörde bilinçli olarak kullanılıyor (eski ama çalışıyor). Yapıştırılan içerik her zaman temizleniyor.
- Tarayıcının `confirm()` / `alert()` pencereleri kullanılmaz; bunun yerine `showConfirm` / `showInfo` kullanılır. `showConfirm`'e `select` seçeneği verilirse kullanıcının seçtiği değer `onConfirm(value)`'ya geçer.
- Uyarı paneli ve AI panelinin açık/kapalı durumu, seçili model gibi tercihler `localStorage`'dadır. Testlerden önce `localStorage.clear()` yapın.

## Geliştirme geçmişi (eskiden yeniye)
1. **Kod incelemesi ve düzeltmeleri:**
   - içe aktarma onayı,
   - bozuk notlarda modalın çökmesi,
   - id/renk kaynaklı XSS,
   - DNS rebinding (Host kontrolü),
   - yedeğin `listen` sonrasına taşınması,
   - Windows rename retry,
   - yüklenmeden yazma kilidi,
   - çok pencerede çakışma (409),
   - `baslat.bat` gecikmesi.
2. **Beş özellik:** zengin metin + ekler, gg.aa.yyyy tarih biçimi, kart seçimi ve `.eml` mail taslağı, uyarı alanının yeniden tasarımı, Ayarlar sayfası (sorumlu/proje yönetimi, `units.json`). Sonradan eklenenler: tablo desteği ve renk paleti açılır menüsü.
3. **AI asistan** (OpenRouter, gpt-oss-120b): hemen uygula + Geri al; sohbet yalnızca bellekte.
4. **AI düzeltmeleri:**
   - "gecikmiş işleri listele" yanıtsız kalıyordu → `list_tasks` aracı ve hazır `due` metni eklendi;
   - yanlış gün hesabı → 14 günlük takvim;
   - gereksiz soru sorma ve id gösterme düzeltildi;
   - özette uydurma iş adları → araç sonucuna başlıklar eklendi;
   - `tools/demo-veri.js` eklendi.
5. **İptal düzeltmesi:** İptal için tarih zorunluluğu kaldırıldı (`needsDates`). Model başarısız bir taşımaya "yaptım" diyordu → `applied` / `warning` alanları ve kırmızı "Değişiklik yapılamadı" kartı; tarih uydurma yasağı.
6. **AI model seçimi:** OpenAI uyumlu yerel modeller (Ayarlar → AI Modelleri, `data/ai-models.json`) ve paneldeki model seçici.
7. Kenar çubuğundaki "Sorumluları/Projeleri Yönet" butonları kaldırıldı.
8. Sütun başlığına "tümünü seç" kutusu eklendi (`toggleColumn`).

## Kullanıcı tercihleri ve çalışma biçimi
- Kullanıcı Türkçe yazıyor; açıklamaları ve özetleri Türkçe verin.
- Büyük işlerde önce plan ve checklist istiyor (plan modu). Onay verdikten sonra "sırayla başla ve bitir" diyerek tamamını bekliyor.
- Değişikliklerin gerçek tarayıcıda test edilip ekran görüntüsüyle doğrulanmasını bekliyor; test sonuçlarını dürüstçe bildirin.
- Kullanıcının gerçek verisine yalnızca açıkça istendiğinde yazın; yazmadan önce yedek alın ve çalışan sunucunun API'sini `baseUpdatedAt` ile kullanın.
