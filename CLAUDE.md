# İş Takip — Proje Rehberi (AI agent'lar için)

Yerel çalışan, **bağımlılıksız** bir kanban iş takip uygulaması: Node.js sunucusu (yalnızca yerleşik modüller, veri `node:sqlite` ile SQLite'ta) + vanilla JS arayüz. Kullanıcı Windows'ta, arayüz ve kod yorumları **Türkçe**. Kullanıcıya Türkçe yanıt verin.

- Çalıştırma: Windows'ta `servis/servis-kur.bat` (Görev Zamanlayıcı ile penceresiz otomatik başlatma; kurar, başlatır, tarayıcıyı açar) ya da elle `node server.js` → http://localhost:3000. **Node ≥ 22.13** gerekir (yerleşik SQLite). Kullanıcı servisi kullanıyor; sunucu penceresizdir. (`baslat.bat` kullanıcı isteğiyle kaldırıldı.)
- **Git deposu var** (`main`), ama commit/push yalnızca kullanıcı isterse. `data/` git'te izleniyor (kullanıcının gerçek verisi; `is-takip.db` ikili dosya). Değişiklik geçmişi bu dosyanın sonunda.
- Son kullanıcı belgesi: [README.md](README.md). Planlar ve checklist'ler: [PLAN.md](PLAN.md) (en sondaki "11 Yeni İstek Planı" en güncelidir).

## Değişmez ilkeler (bunları bozmayın)
1. **Bağımlılık yok.** npm paketi eklenmez; `.env` elle ayrıştırılır, HTTP için yerleşik `fetch`/`http`, veri için `node:sqlite`, ZIP/PDF için `zlib` kullanılır.
2. **Veri sunucuda.** Tüm veri `data/is-takip.db` (SQLite) içindedir, tarayıcı depolamasında değil. `localStorage` yalnızca arayüz tercihleri içindir (panel açık mı, seçili model, seçili durum sekmesi).
3. **Tek yazma akışı (istemci):** state'i değiştir → `commit(kinds, mesaj)` → `renderAll()` + `Storage.save(kinds)`. AI'nin yaptığı değişiklikler de aynı yoldan geçer.
4. **Sunucudan gelen her değer `normalize*` fonksiyonlarından geçer** (id'ler `SAFE_ID = /^[\w-]{1,64}$/`, renkler `#rrggbb`, tarih `ISO_DAY`, saat `TIME_RE`). Bu değerler HTML attribute'larına kaçışsız gömüldüğü için bu doğrulama bir **güvenlik** önlemidir.
5. **Metin her zaman `esc()` ile basılır.** Zengin metin (iş açıklaması, proje notu) yalnızca `RichEditor.sanitize` beyaz listesinden geçtikten sonra HTML olarak kullanılır. Model yanıtları `AiChat.format` (önce kaçışla, sonra sınırlı biçim) ile basılır.
6. **Tek işlem + çakışma kontrolü:** sunucu her `PUT /api/<tür>`'ü tek bir `BEGIN IMMEDIATE` işleminde yazar (`writeKind` → `putItems`). İstemci her PUT'ta `baseUpdatedAt` gönderir; sürüm uyuşmazsa 409 döner ve istemci "Sayfayı yenile" gösterir. Aynı milisaniyedeki iki yazım aynı damgayı almaz.
7. **Yüklenmeden yazma yok:** `Storage` sunucudan başarıyla okumadan kaydetmez; hata durumunda `fatalOverlay` açılır ve `.app` öğesi `inert` yapılır.
8. **API anahtarları tarayıcıya asla gitmez** (`.env`, `data/ai-models.json`). LLM bağlamını (proje notları, ek metinleri) **sunucu** kurar; istemci yalnızca kimlik gönderir.
9. Sunucu yalnızca `127.0.0.1`'e bağlanır. `sameOriginOk` hem **Host** (DNS rebinding) hem **Origin** başlığını kontrol eder; her `/api/*` rotası bu kontrolü çağırmalı.
10. **Veritabanı `listen` başarılı olduktan sonra açılır** (`startStorage`): port doluysa (eski sunucu çalışıyorsa) JSON göçü yapılmaz ve veri ikiye bölünmez. Açılmadan gelen `/api/*` isteği 503 alır.

## Dosyalar
| Dosya | İçerik |
|---|---|
| [server.js](server.js) | HTTP sunucu, statik dosyalar, SQLite veri katmanı (`openDb`, `readKindFull`, `writeKind`, `migrateFromJson`, `backupDb`), ekler, ek metni (`attText`), sahipsiz ek temizliği, `.env`, AI aracısı (pano: `aiChat`, proje: `aiProject` + `projectContext`), model kaydı |
| [extract.js](extract.js) | `extract(buf, name, type)` → `{status, text, reason}`: txt/md/csv/json/xml, html, eml (MIME, RFC 2047), docx (elle ZIP), pdf (Flate, ToUnicode CMap, Tj/TJ). `VERSION` artırılırsa önbellek yenilenir |
| [public/index.html](public/index.html) | Tüm DOM: kenar çubuğu, Pano / Projeler / Hatırlatma / Notlarım / Arşiv / Ayarlar sayfaları, iş modalı, proje notu modalı (`pnOverlay`), onay modalı, seçim çubuğu, AI paneli |
| [public/app.js](public/app.js) | Ana uygulama (IIFE). Bölümler: CONFIG → UTILS → STATE/normalize → STORAGE → DOMAIN → VIEWS (pano, uyarılar, hatırlatmalar, notlarım, projeler + proje asistanı, ayarlar) → İŞ MODALI → eylemler → mail → AI köprüsü → yedek → INIT (`bind()`, `boot()`) |
| [public/editor.js](public/editor.js) | `window.RichEditor`: `create(host, {placeholder, onImage, onAttach, onFiles})` (çoklu örnek destekli) + `sanitize` / `toPlain` / `fromPlain` |
| [public/eml.js](public/eml.js) | `window.Eml.build(...)`: MIME `.eml` taslak oluşturucu (Outlook için `X-Unsent: 1`) |
| [public/ai.js](public/ai.js) | `window.AiChat`: pano sohbet paneli, araç döngüsü, durdurma, eylem kartları / Geri al; `AiChat.format` güvenli biçimlendirici |
| [public/ai-models.js](public/ai-models.js) | `window.AiModels`: Ayarlar → AI Modelleri; `list/selected/select/onChange` (pano ve proje asistanı ortak kullanır) |
| [public/style.css](public/style.css) | Tüm stiller (CSS değişkenleri `:root` içinde) |
| [tools/demo-veri.js](tools/demo-veri.js) | Demo veri yükleyici (`--sil` ile kaldırır); çalışan sunucunun API'sini kullanır, önce `POST /api/backup` ile `demo-oncesi` yedeği alır |
| `servis/` | `servis.ps1` (`-Kur [-TarayiciAc]` / `-Kaldir` / `-Durum`; Node sürüm kontrolü; UTF-8 **BOM**'lu), `gizli.vbs` (penceresiz başlatıcı), `calistir.cmd` (yeniden başlatma döngüsü + `logs/` loglama), `servis-*.bat` (ASCII, CRLF) |
| `.env` / `.env.example` | `OPENROUTER_API_KEY=...` (`.env` gizli; içeriğini okumayın veya yazdırmayın) |

Script yükleme sırası önemli: `editor.js` → `eml.js` → `ai-models.js` → `ai.js` → `app.js`. `app.js` içindeki `bind()`, `AiModels.init` ve `AiChat.init`'i çağırır.

## Veri modeli
**SQLite şeması** (`data/is-takip.db`, `PRAGMA user_version = 1`, `journal_mode=DELETE`, `synchronous=FULL`):
- `meta(kind, updated_at)` — türün sürüm damgası (409 için)
- `items(kind, pos, id, data)` — her kayıt bir JSON belgesi; sıra `pos` ile korunur
- `attachments(id, name, type, size, uploaded_at)` — ek bilgileri (dosyanın kendisi diskte: `data/attachments/<id>`)
- `att_text(id, text, status, extracted_at)` — ek metni önbelleği; `status = "v<EXTRACT_VERSION>:<ok|partial|none|unsupported>"`, ok/partial değilse `text` okunamama nedenidir

**Türler** (`KINDS`; istemci API'si tür başına tüm listeyi okur/yazar):
- **tasks / archive**: `id, title, description` (düz metin, `descriptionHtml`'den türetilir), `descriptionHtml`, `unit`, `priority: kritik|yuksek|orta|dusuk`, `status: backlog|beklemede|devam|tamamlandi|iptal`, `projectId` (`""` = projesiz), `startDate, dueDate` (ISO; ekranda gg.aa.yyyy), `createdAt, updatedAt` (gün), `notes[{id,text,date,createdAt}]` (durum notları), `attachments[{id,name,size,type,uploadedAt}]`, `archivedAt` (yalnızca arşivde)
- **projects**: `{ id, name, color, status: aktif | arsivlenmis }`
- **units**: sorumlular `{ id, name, color, order }`. Boşsa `DEFAULT_UNITS`. Bilinmeyen `unit` korunur, "(silinmiş sorumlu)" görünür.
- **reminders**: `{ id, text, date (zorunlu), time ("HH:MM"|""), taskId, done, doneAt, createdAt }`
- **memos** ("Notlarım", tarihsiz kişisel notlar): `{ id, text, taskId, createdAt, updatedAt }`. Kodda adı `memos`, çünkü işlerdeki durum notları `notes`.
- **projectNotes**: `{ id, projectId, title, html (temizlenmiş), text (html'den türetilir), attachments[], createdAt, updatedAt }`

Dosyada kalanlar: `data/ai-models.json` (`{ items: [{ id, name, baseUrl, model, apiKey }] }`, **anahtarlar düz metin**, yedeğe/dışa aktarmaya dahil değil), `data/attachments/`.

**Göç:** DB boşsa ve `data/*.json` varsa ilk açılışta tek işlemde içe aktarılır (`updatedAt` korunur), JSON'lar ve `attachments/*.json` `data/json-yedek-<zaman>/`'a **taşınır**. JSON bozuksa göç yapılmaz, sunucu çıkış kodu 1 ile durur. DB doluyken JSON dosyası bulunursa yok sayılır (uyarı loglanır).

**Yedek:** açılışta (veri varsa) `VACUUM INTO backup/<zaman>.db`. **Yalnızca tek yedek tutulur** (kullanıcı kararı): yeni yedek başarılı olunca `backup/` içindeki diğer `.db` dosyaları ve klasörler (eski JSON yedekleri, `demo-oncesi-*`) silinir. `POST /api/backup` (demo betiği) de aynı kurala tabidir. Arşivdeki işler otomatik silinmez.

**Sahipsiz ek temizliği** (açılışta): `ATT_KINDS = tasks, archive, projectNotes` içindeki `attachments` ve `descriptionHtml`/`html` içindeki `/api/attachments/<id>` referansları korunur; diğerleri 1 günden eskiyse dosya + satır + metin önbelleği silinir. **Eki olan yeni bir tür eklerseniz `ATT_KINDS`'e ekleyin**, yoksa ekleri bir gün sonra silinir.

**İş kuralı (tarih zorunluluğu):** `needsDates(status)` → yalnızca **Beklemede, Devam Ediyor ve Tamamlandı** için başlangıç + bitiş zorunlu; Backlog ve İptal için değil. Bitiş başlangıçtan önce olamaz. Kural `moveTask` (sekmeye sürükleme dahil), `saveTask` ve AI'da (`aiDateRule`) aynıdır; değiştirirseniz üçünü birlikte değiştirin.

**Termin grupları:** `urgency(t)` / `urgencyGroup(t)` → `over` / `today` / `soon` (1–3 gün, `DUE_SOON_DAYS`). Tamamlanan ve iptal edilen işler uyarı vermez. Hatırlatmalar: `remGroup` → over/today/soon(7 gün)/later/done.

## Sunucu API'si
| Rota | İş |
|---|---|
| `GET /api/state` | `{ tasks, projects, archive, units, reminders, memos, projectNotes, meta: { <tür>: updatedAt } }` |
| `PUT /api/{tasks\|projects\|archive\|units\|reminders\|memos\|projectNotes}` | `{ items, baseUpdatedAt }` → tek işlem; sürüm uyuşmazsa 409 |
| `POST /api/backup` | `{ label? }` (`/^[\w-]{1,40}$/`) → `{ file }`; tek yedek kuralı uygulanır |
| `POST /api/attachments` | ham gövde + `X-File-Name` (URL kodlu), en fazla 25 MB |
| `GET /api/attachments/:id` | `nosniff` + CSP; yalnızca resim/PDF satır içi, gerisi indirme |
| `POST /api/attachments/text-status` | `{ ids }` (≤300) → `{ items: { id: { status, chars, reason } } }` — metnin kendisi dönmez; gerekirse çıkarır ve önbelleğe alır |
| `POST /api/ai/chat` | Pano asistanı: `{ messages, board, modelId }` → `{ message, modelName }` (araçlı) |
| `POST /api/ai/project` | Proje asistanı: `{ projectId, question, history, noteIds?, attIds?, includeTasks, modelId }` → `{ answer, modelName, used[], unreadable[], truncated, budget, contextChars }` (araçsız) |
| `GET/PUT /api/ai/models` | model listesi; yanıtta anahtar yerine `hasKey`. PUT'ta `apiKey` verilmezse korunur, `""` silinir |
| `POST /api/ai/models/test` | `{ baseUrl, apiKey?, id? }` → sunucunun `/models` listesi |

Ortam değişkenleri: `PORT`, `DATA_DIR`, `HOST`, `OPENROUTER_API_KEY` (ortamdaki değer `.env`'i ezer). `OPENROUTER_URL` **yalnızca testte** sahte sunucuya yönlendirmek içindir (tam `/chat/completions` adresi).

## Özellikler (kısa)
- **Pano**: durum **sekmeleri** (`#pipeline` öğesi, `renderPipeline`; sütun görünümü yok, kullanıcı kararı) + kart ızgarası (`renderBoard`, `tabTasks`). `state.statusTab` `localStorage`'da (`isTakip.statusTab`). Sekme sayıları filtrelere göre; filtre varken eşleşmesi olan diğer sekmeler `hit` sınıfıyla vurgulanır; boş sekmede `data-goto` geçiş bağlantıları. **Kart bir sekmeye bırakılınca** `moveTask` (bırakınca pano yeniden çizildiği için `dragend` kopuk karta gider; vurgu `endDrag` ile belge düzeyinde temizlenir). Seçim kutuları **opacity** ile görünür (yer hep ayrılmış; `display` değiştirmek titreme yapıyordu).
- **Arama**: `taskMatch(t, q)` başlık + açıklama + durum notları; `searchKey` = tr küçük harf + `ı→i`. Kartta `match-hint`. Arşiv, notlarım ve proje notları da `searchKey` kullanır.
- **Uyarılar**: özet şeridi (Gecikmiş / Bugün / Yaklaşan + `🔔 Hatırlatma` rozeti → hatırlatmalar sayfası); "Ayrıntılar" paneli (grup başına 6 satır, hatırlatma sütunu dahil).
- **İş modalı**: zengin metin, ekler, durum notları, "Hatırlatmalar ve notlarım" bölümü (bağlı hatırlatma ve notlar; "Hatırlatma ekle"/"Not ekle" önce kaydeder). **Kapatma koruması:** `bindBackdropClose` (mousedown + click ikisi de arka plandaysa), `modalSnapshot`/`modalDirty`/`requestCloseModal` (Esc, X, İptal, arka plan). Proje notu modalında da aynısı (`pnSnapshot`, `requestCloseProjectNote`). `saveTask`, not kutusunda bekleyen metni önce `addNote()` ile nota çevirir.
- **Mail (.eml)**: seçili işler; **tüm durum notları** (yeniden eskiye, satır sonları korunur), `cid:` resimler, ekler (20 MB üstü için "eksiz oluştur").
- **Hatırlatmalar**: sayfa, gruplar, satır içi düzenleme (yeniden çizimde yazılan korunur), saatli bildirim (`checkReminderTimes`, 30 sn; toast + izin verilmişse `Notification`; yalnızca sekme açıkken), kart zili (`remBell`).
- **Notlarım**: tarihsiz; en son güncellenen başta; değişiklik yoksa `updatedAt` değişmez.
- **Projeler**: liste (`renderProjectList`), detay (`renderProjectDetail`: notlar, işler, dosyalar + metin durumu rozetleri `attTextBadge`/`loadAttTextStatus`), proje notu modalı (ikinci `RichEditor` örneği `pnEditor`). Proje silinince notlar hedef projeye taşınır; "Projesiz" seçilirse silinir.
- **Ayarlar**: sorumlular, projeler, AI modelleri. Kenar çubuğu sekmeleri 2 sütunlu ızgara (`VIEWS` tablosu + `switchView`).
- **Yedek (JSON dışa/içe aktar)**: tüm türler (ekler hariç); içe aktarma her tür için ne değişeceğini sorar.
- **Eski sunucu uyarısı**: `boot` sırasında `meta`'da yeni türler yoksa "Sunucuyu yeniden başlatın" uyarısı; PUT 404 dönerse aynı açıklayıcı mesaj.

## AI (önemli ayrıntılar)
**Pano asistanı** (`/api/ai/chat`, `ai.js`): sunucu yalnızca aracıdır; sistem mesajı, araç şemaları ve sınırlar sunucuda. Araçları tarayıcı çalıştırır (`aiApply`), sonuçları `tool` mesajı olarak geri gönderir; mesaj başına en fazla 6 tur. Araçlar: `create_tasks`, `update_tasks`, `move_tasks`, `list_tasks`, `get_task`; **silme/arşivleme yok**. `aiApply` öğe öğe doğrular, geçerlileri tek `commit` ile uygular, `applied: 0` ise `warning` döner; her adım için geri alma kaydı (`aiUndo`). Modal açıkken değişiklik reddedilir. Pano özeti her işte hazır `due` metni taşır; sistem mesajında 14 günlük takvim var. Kurallar: tarih uydurma, id gösterme, varsayılan sorumlu/öncelik, özeti yalnızca `ok` listesine dayandır, toplu işte önce `list_tasks`.

**Proje asistanı** (`/api/ai/project`, `app.js` → `pa*` fonksiyonları): bağlamı `projectContext` DB'den kurar: seçili notların `text`'i, eklerin `attText` metni (okunamayanlar yalnızca adıyla `unreadable`), isteğe bağlı işler. **Bütçe**: yerleşik 150 bin, yerel 40 bin karakter; `fitBudget` tek bir üst sınırla adil kırpar (küçük kaynaklar tam kalır). Sistem mesajı: yalnızca kaynaklara dayan, uydurma, `[Not: …]`/`[Dosya: …]` diye kaynak göster, tablo/başlık kullanma. Zaman aşımı en az 180 sn. İstemci okunamayan ek kimliklerini de gönderir (adlarının bildirilmesi için). Sohbet bellekte; "Yanıtı nota kaydet" → yeni `projectNotes` kaydı. Model seçimi pano asistanıyla ortak (`AiModels`).

**Modeller:** yerleşik `openrouter` → `openai/gpt-oss-120b` (`X-Title` başlığı; pano isteklerinde `provider.require_parameters`). Ek modeller OpenAI uyumlu `baseUrl + /chat/completions`; zaman aşımı 180 sn. `<think>` metni atılır. Seçili model `localStorage` (`isTakip.aiModel`).

**Gizlilik:** pano: aktif işlerin özeti; proje asistanı: seçili notların ve eklerin **tam metni**. Seçili modele (OpenRouter → internet) gider. Kullanıcının gerçek verisini canlı modele **göndermeyin**; canlı denemeleri sentetik test verisiyle yapın.

## Test yaklaşımı
Repoda test dosyası **yok**; geçici test betikleri scratchpad'de yazılıp çalıştırılır. Aynı yöntemi tekrarlayın:
- **Gerçek veriye dokunmayın.** Testte `DATA_DIR=<scratchpad>/<klasör> PORT=3917 node server.js`. `data/` kullanıcının gerçek verisidir; kullanıcının sunucusu 3000'dedir (penceresiz servis olabilir). Gerçek veriyle bir şey doğrulamak gerekirse `data/`'yı **kopyalayıp** kopyada çalışın (yalnızca okuma isteği bile 3000'e gönderilecekse GET olsun).
- **Tarayıcı testi:** Chrome headless (`--headless=new --remote-debugging-port=9333 --user-data-dir=<geçici>`), Node 24'ün yerleşik `WebSocket`'iyle CDP: `Runtime.evaluate`, `Page.captureScreenshot`, `Input.dispatchMouseEvent`/`dispatchKeyEvent` (gerçek fare olayları; ör. modal dışına taşan seçim), `Page.printToPDF` (gerçekçi PDF test dosyası üretmek için). Konsol hatalarını `Runtime.exceptionThrown` ile toplayın. `state` IIFE içindedir, dışarıdan erişilemez: DOM'dan okuyun ya da sunucu API'sine bakın.
- **Sürükle-bırak**: sentetik `DragEvent` + `DataTransfer` ile (`dragstart` karta, `dragover`/`drop` sekmeye).
- **AI testi:** `OPENROUTER_URL=http://127.0.0.1:<port>/v1/chat/completions OPENROUTER_API_KEY=test-...` ile sahte OpenAI uyumlu sunucu; kuyruktan yanıt döndürüp istekleri kaydetsin (gönderilen sistem mesajını doğrulamak için), gecikme ve HTTP hata kodu da verebilsin. Canlı deneme: ortam değişkenlerini silip `.env`'deki anahtarla, **yalnızca sentetik veriyle**.
- **Demo veri:** `DATA_DIR=... PORT=3917 node tools/demo-veri.js` (28 iş, 4 proje, 3 arşiv kaydı; 7 gecikmiş, 3 bugün, 5 yakın).
- **Göç testi:** eski sürüm `server.js`'in bir kopyasıyla JSON verisi üretip yeni sunucuyu aynı klasörde açın; `/api/state` birebir aynı olmalı.
- **Servis testi:** `servis.ps1 -GorevAdi IsTakip-Test -Port 3917 -VeriKlasoru <geçici>`; bittiğinde görevi ve `logs/server-3917.log`'u silin. Kullanıcının "IsTakip" görevine dokunmayın.
- `node --check <dosya>`; PowerShell için `[System.Management.Automation.Language.Parser]::ParseFile`.
- **`server.js` / `extract.js` değişirse** kullanıcıya sunucuyu yeniden başlatmasını söyleyin: `servis\servis-kur.bat` (eski sunucuyu durdurup yenisini başlatır); elle çalışıyorsa `node server.js` penceresinde Ctrl+C + yeniden çalıştır. Yalnızca `public/` değiştiyse F5 yeterlidir (statik dosyalar `no-cache`).

## Bilinen tuzaklar
- **Eski sunucu + yeni arayüz:** `public/` hemen yenilenir ama sunucu eski kodla çalışmaya devam eder → yeni türler 404. Arayüz bunu uyarır; kullanıcıya yeniden başlatmayı hatırlatın.
- **Servis süreç eşleme:** `gizli.vbs` komutu `cmd.exe /c ""...\calistir.cmd" 3000"` biçimindedir (port sonrası **tırnak**). `servis.ps1` bu cmd sürecini ve onun `node` çocuğunu komut satırıyla bulur; sıra wscript → cmd → node (döngü yeniden başlatmasın). `cmd /c` ikiden fazla tırnakta ilk ve son tırnağı sildiği için komutun tamamı bir kat daha tırnaklıdır. Gizli pencerede `timeout` çalışmaz; bekleme `ping` ile.
- **Windows PowerShell 5.1:** `.ps1` UTF-8 **BOM**'suz olursa Türkçe bozulur; `Invoke-WebRequest` proxy algılamasında zaman aşımını dinlemeden takılabilir → port kontrolü `TcpClient.ConnectAsync(...).Wait(1500)` ile.
- **SQLite:** WAL kullanılmıyor (bilinçli): süreç zorla kapatılınca (Windows'ta `kill` = zorla) veri `-wal`'da kalıp `.db` eksik görünüyordu; `data/` git'te izlendiği için önemli. Port doluyken (`EADDRINUSE`) DB açılmaz, yedek alınmaz.
- **Test betikleri:** scratchpad'deki `stop.sh` bash'ten başlatılan **tüm** node süreçlerini kapatır; bir node test betiğinin içinden çağırırsanız betiğin kendisini de öldürür (betik kendi sunucusunu `spawn` edip `kill` etmeli). Bash heredoc içinde ters eğik çizgiler (`\\`, `\n` içeren regex'ler) bozulabiliyor: kaçış içeren betikleri Write aracıyla dosyaya yazın. Zararlı HTML'i `innerHTML` ile test sayfasına doğrudan yazmak kodu tarayıcıda o an çalıştırır; XSS'i kaydedilen veriden ya da sunucuya doğrudan yazılmış veriden test edin.
- **Git satır sonu dönüşümü:** kullanıcıda `core.autocrlf` açık. `.gitattributes` `data/**` için dönüşümü kapatır (`-text`); yoksa metin sanılan ekler (ör. PDF) depodan geri alınırken bozulur. Veri içeren yeni bir klasör eklerseniz oraya da uygulayın.
- `.env` ayrıştırıcısı BOM, `export`, tırnaklı değer ve satır sonu yorumunu destekler; ortamda tanımlı değişkeni ezmez.
- `document.execCommand` editörde bilinçli olarak kullanılıyor. Yapıştırılan içerik her zaman temizleniyor.
- Tarayıcının `confirm()` / `alert()` pencereleri kullanılmaz; `showConfirm` / `showInfo` kullanılır. `showConfirm`'e `select` verilirse seçilen değer `onConfirm(value)`'ya geçer.
- Tercihler `localStorage`'da (uyarı paneli, AI paneli, seçili model, durum sekmesi). Testlerden önce `localStorage.clear()`.
- Yeniden çizimde kaybolmaması gereken giriş alanları (hatırlatma/not düzenleme formu, proje asistanı) ya statik HTML'dedir ya da `render*` içinde değerleri saklanıp geri yazılır; `reloadFromServer` düzenleme sürerken çalışmaz.

## Geliştirme geçmişi (eskiden yeniye)
1. **Kod incelemesi ve düzeltmeleri:** içe aktarma onayı, bozuk notlarda modal çökmesi, id/renk kaynaklı XSS, DNS rebinding, yedeğin `listen` sonrasına taşınması, Windows rename retry, yüklenmeden yazma kilidi, çok pencerede çakışma (409), `baslat.bat` gecikmesi.
2. **Beş özellik:** zengin metin + ekler, gg.aa.yyyy, kart seçimi ve `.eml`, uyarı alanı, Ayarlar (`units`). Sonra: tablo desteği, renk paleti menüsü.
3. **AI asistan** (OpenRouter, gpt-oss-120b): hemen uygula + Geri al.
4. **AI düzeltmeleri:** `list_tasks` ve `due` metni, 14 günlük takvim, gereksiz soru/id gösterme, uydurma iş adları, `tools/demo-veri.js`.
5. **İptal düzeltmesi** (`needsDates`), `applied`/`warning`, tarih uydurma yasağı.
6. **AI model seçimi** (yerel OpenAI uyumlu modeller).
7. Kenar çubuğundaki "Sorumluları/Projeleri Yönet" butonları kaldırıldı.
8. Sütun başlığına "tümünü seç" (sonra sekme üst çubuğuna taşındı).
9. **11 yeni istek (PLAN.md sonundaki plan):**
   - Modal dışına taşan seçimde kapanma ve veri kaybı düzeltildi; kaydedilmemiş değişiklik onayı.
   - Mailde tüm durum notları; kutuda bekleyen not kaydedilirken kaybolmuyor.
   - Arama: açıklama ve durum notları, Türkçe harf duyarsız.
   - Seçim kutusu titremesi (opacity).
   - Sütunlar yerine durum sekmeleri + dar sayaç; sekmeye sürükle-bırak.
   - Servis betikleri (Görev Zamanlayıcı); sonra görevsiz kalmış eski sunucuyu tanımayan süreç eşleme hatası düzeltildi.
   - **SQLite'a geçiş** (`node:sqlite`, otomatik JSON göçü, `VACUUM INTO` yedeği, DELETE günlük kipi).
   - Yedek saklama: **yalnızca tek yedek** (kullanıcı, 7 günlük saklama ve arşiv silme yerine bunu seçti).
   - Hatırlatmalar; sonra kullanıcı isteğiyle **Notlarım** (tarihsiz) ayrı tür ve sayfa oldu.
   - Proje sayfaları + proje notları; `extract.js` ile ek metni; **proje asistanı** (LLM ile notlar + ekler üzerinden soru-cevap).
10. `baslat.bat` kaldırıldı (yerini `servis-kur.bat` aldı; tarayıcıyı da o açıyor); proje git'e işlendi.

## Kullanıcı tercihleri ve çalışma biçimi
- Kullanıcı Türkçe yazıyor; açıklamaları ve özetleri Türkçe verin.
- Büyük işlerde önce plan ve checklist istiyor (plan modu). Onaydan sonra **her madde bitince PLAN.md'deki checklist'i işaretleyip "devam edeyim mi?" diye sormanızı** bekliyor.
- Değişikliklerin gerçek tarayıcıda test edilip ekran görüntüsüyle doğrulanmasını bekliyor; test sonuçlarını (başarısızlar ve test hataları dahil) dürüstçe bildirin.
- Kullanıcının gerçek verisine yalnızca açıkça istendiğinde yazın; yazmadan önce yedek alın ve çalışan sunucunun API'sini `baseUpdatedAt` ile kullanın.
- Kapsamı değiştiren belirsiz isteklerde (ör. "arşivi sınırla" hangi arşiv?) uygulamadan önce sorun.
