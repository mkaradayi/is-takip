# İş Takip — Proje Rehberi (AI agent'lar için)

Yerel çalışan, **bağımlılıksız** bir kanban iş takip uygulaması: Node.js sunucusu (yalnızca yerleşik modüller, veri `node:sqlite` ile SQLite'ta) + vanilla JS arayüz. Kullanıcı Windows'ta, arayüz ve kod yorumları **Türkçe**. Kullanıcıya Türkçe yanıt verin.

- Çalıştırma: Windows'ta `servis/servis-kur.bat` (Görev Zamanlayıcı ile penceresiz otomatik başlatma; kurar, başlatır, tarayıcıyı açar) ya da elle `node server.js` → http://localhost:3000. **Node ≥ 22.13** gerekir (yerleşik SQLite). Kullanıcı servisi kullanıyor; sunucu penceresizdir. (`baslat.bat` kullanıcı isteğiyle kaldırıldı.)
- **Git deposu var** (`main`, uzak sunucu yok), ama commit/push yalnızca kullanıcı isterse. **`data/` git'e girmez** (`.gitignore`; kullanıcı kararı): veritabanı, ekler, yedekler ve model anahtarları yalnızca diskte. Verinin yedeği git değil, `data/backup/` ve JSON dışa aktarmadır. (İlk iki commit'in geçmişinde eski veri hâlâ duruyor.) Değişiklik geçmişi bu dosyanın sonunda.
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
Derleme adımı yok. İstemci **ES modülleri** (`<script type="module" src="js/main.js">`), sunucu **CommonJS** (`lib/`). Her dosyanın ilk satırı ne yaptığını söyler.

**Sunucu** — [server.js](server.js) yalnızca başlatıcıdır (`listen` → `startStorage` → yedek → ek temizliği). Kod [lib/](lib/) altında; modüller arasında **döngüsel require yok** (sıra: util/config → fs-util → db → attachments → ai-common → ai-board/ai-project → http-util → static → routes):
| Dosya | İçerik |
|---|---|
| [lib/config.js](lib/config.js) | `.env` okuma, `PORT/HOST/DATA_DIR/PUBLIC_DIR`, `KINDS`, `SAFE_ID`, `MIME`, sınırlar. `ROOT` proje köküdür (`lib/`'in bir üstü) |
| [lib/db.js](lib/db.js) | SQLite: `openDb`, `readKindFull`, `writeKind` (+409), `migrateFromJson`, `backupDb`, `startStorage/closeStorage`. `db` değişkeni yeniden açılabildiği için diğer modüller **`getDb()`** kullanır |
| [lib/attachments.js](lib/attachments.js) | Ek kaydetme/sunma, `attText` (metin önbelleği), `cleanupOrphanAttachments` (`ATT_KINDS`) |
| [lib/extract.js](lib/extract.js) | `extract(buf, name, type)` → `{status, text, reason}`: txt/md/csv/json/xml, html, eml (MIME, RFC 2047), docx (elle ZIP), pdf (Flate, ToUnicode CMap, Tj/TJ). `VERSION` artırılırsa önbellek yenilenir |
| [lib/ai-common.js](lib/ai-common.js) | AI sabitleri, model kaydı (`data/ai-models.json`), `resolveModel`, `aiHeaders`, `netError`, `stripThink`, `testModel` |
| [lib/ai-board.js](lib/ai-board.js) | Pano asistanı: `cleanBoard`, araç şemaları (`aiTools`), sistem mesajı (`aiSystem`), `aiChat` |
| [lib/ai-project.js](lib/ai-project.js) | Proje asistanı: `projectContext`, `fitBudget`, `aiProject` |
| [lib/http-util.js](lib/http-util.js) | `send`, `readBody`, `sameOriginOk` (Host + Origin) |
| [lib/static.js](lib/static.js) | Statik dosyalar + **HTML parçalarını birleştirme**: `<!-- @include partials/ad.html -->` satırı `public/partials/ad.html` ile değiştirilir (yalnızca `[w-]+` ad; iç içe include yok) |
| [lib/routes.js](lib/routes.js) | Tüm `/api/*` rotaları (`handle(req, res)`) |
| [lib/util.js](lib/util.js) | `s(v, max)` metin kırpma |

**İstemci** — [public/](public/):
| Yer | İçerik |
|---|---|
| [public/index.html](public/index.html) | Yalnızca iskelet: CSS bağlantıları + `@include` satırları + modül girişi |
| [public/partials/](public/partials/) | Sayfa/pencere HTML'leri: `sidebar`, `board`, `projects`, `reminders`, `memos`, `archive`, `settings`, `ai-panel`, `select-bar`, `task-modal`, `project-note-modal`, `dialogs` (onay, toast, bağlantı hatası) |
| [public/css/](public/css/) | `base` (değişkenler `:root`) → `sidebar` → `board` → `pages` → `settings` → `modal` → `ai` → `responsive`. **Sıra önemli** (aynı özgüllükte sonraki kazanır; `responsive.css` en sonda) |
| [public/js/main.js](public/js/main.js) | Giriş: `bind()` (her modülün `bindX()`'ini çağırır + üst çubuk, kapanış uyarısı, odakta yeniden yükleme), `boot()`, `setFatal`, `reloadPage` |
| `js/core/` | `config` (STATUSES, PRIORITIES, ICON…), `utils` (`$`, `esc`, tarih), `state` (`state`, `normalize*`, `setUnits`, `UNIT_MAP`), `storage` (`Storage`, `commit`), `domain` (`urgency`, `needsDates`, `taskMatch`, `filteredTasks`), `ui` (`toast`, `showConfirm/showInfo`, `bindBackdropClose`, tarih alanı), `render` (`renderAll`, `VIEWS`, `switchView`), `overlays` (`topOverlayClose`, `anyOverlayOpen`) |
| `js/views/` | `sidebar`, `board` (sekmeler, kartlar, sürükle-bırak), `alerts`, `archive`, `reminders`, `memos`, `projects`, `project-assistant` (`pa*`), `settings` |
| `js/modals/` | `task-modal` (iş penceresi, `saveTask`, `modalSnapshot`), `project-note-modal` |
| `js/features/` | `task-actions` (sil/arşivle/geri al/taşı/seç), `mail` (.eml), `ai-bridge` (`aiBoardSnapshot`, `aiApply`, `aiUndo`), `backup` (JSON dışa/içe), `reminder-notify` |
| `js/components/` | Bağımsız bileşenler: `editor` (`RichEditor`: `create` + `sanitize`/`toPlain`/`fromPlain`), `eml` (`Eml.build`, `X-Unsent: 1`), `ai-models` (`AiModels`), `ai-chat` (`AiChat`; `AiChat.format` güvenli biçimlendirici) |

**Modül kuralları:** her modül kullandığı adları açıkça `import` eder; globaller (`window.X`) yok. İçe aktarılan `var`'a başka modülden **atama yapılamaz** (ES modül bağları salt okunur): değiştirilecek değer ya sahibi modülde bir fonksiyonla değiştirilir (ör. `reloadPage`, `startReminderTimer`) ya da `state` nesnesinin alanıdır. Döngüsel `import`'lar var ve sorun değil, çünkü modüllerin üst düzeyi yalnızca tanım yapar; her şey `main.js`'teki `bind()` / `boot()` ile başlar. Yeni bir üst düzey kodun başka modüldeki **değişkene** (fonksiyona değil) açılışta erişmesinden kaçının.

| Diğer | |
|---|---|
| [tools/demo-veri.js](tools/demo-veri.js) | Demo veri yükleyici (`--sil` ile kaldırır); çalışan sunucunun API'sini kullanır, önce `POST /api/backup` ile `demo-oncesi` yedeği alır |
| `servis/` | `servis.ps1` (`-Kur [-TarayiciAc]` / `-Kaldir` / `-Durum`; Node sürüm kontrolü; UTF-8 **BOM**'lu), `gizli.vbs` (penceresiz başlatıcı), `calistir.cmd` (yeniden başlatma döngüsü + `logs/` loglama), `servis-*.bat` (ASCII, CRLF) |
| `.env` / `.env.example` | `OPENROUTER_API_KEY=...` (`.env` gizli; içeriğini okumayın veya yazdırmayın) |

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
- **Pano**: durum **sekmeleri** (`#pipeline` öğesi, `renderPipeline`; sütun görünümü yok, kullanıcı kararı) + kart ızgarası (`renderBoard`, `tabTasks`). `state.statusTab` `localStorage`'da (`isTakip.statusTab`). Sekme sayıları filtrelere göre; filtre varken eşleşmesi olan diğer sekmeler `hit` sınıfıyla vurgulanır; boş sekmede `data-goto` geçiş bağlantıları. **Kart bir sekmeye bırakılınca** `moveTask` (bırakınca pano yeniden çizildiği için `dragend` kopuk karta gider; vurgu `endDrag` ile belge düzeyinde temizlenir). Seçim kutuları **opacity** ile görünür (yer hep ayrılmış; `display` değiştirmek titreme yapıyordu) ve başlığın **sağında**, arşiv/sil ikonlarının yanındadır (başlık kartın sol kenarıyla hizalı). **Masonry:** `renderBoard` → `layoutMasonry` kartları önce CSS ızgarasına basar, ızgaranın sütun sayısını ve kart yüksekliklerini ölçüp her kartı en kısa `.tab-col` sütununa taşır (tek sütunda ızgara kalır); `watchMasonry` (`ResizeObserver` + `document.fonts.ready`) sütun sayısı değişince ya da pano görünür olunca yeniden çizer. Pano gizliyken çizilirse ölçüm yapılmaz.
- **Arama**: `taskMatch(t, q)` başlık + açıklama + durum notları; `searchKey` = tr küçük harf + `ı→i`. Kartta `match-hint`. Arşiv, notlarım ve proje notları da `searchKey` kullanır.
- **Uyarılar**: özet şeridi (Gecikmiş / Bugün / Yaklaşan + `🔔 Hatırlatma` rozeti → hatırlatmalar sayfası); "Ayrıntılar" paneli (grup başına 6 satır, hatırlatma sütunu dahil).
- **İş modalı**: zengin metin, ekler, durum notları, "Hatırlatmalar ve notlarım" bölümü (bağlı hatırlatma ve notlar; "Hatırlatma ekle"/"Not ekle" önce kaydeder). **Kapatma koruması:** `bindBackdropClose` (mousedown + click ikisi de arka plandaysa), `modalSnapshot`/`modalDirty`/`requestCloseModal` (Esc, X, İptal, arka plan). Proje notu modalında da aynısı (`pnSnapshot`, `requestCloseProjectNote`). `saveTask`, not kutusunda bekleyen metni önce `addNote()` ile nota çevirir.
- **Mail (.eml)**: seçili işler; **tüm durum notları** (yeniden eskiye, satır sonları korunur), `cid:` resimler, ekler (20 MB üstü için "eksiz oluştur").
- **Hatırlatmalar**: sayfa, gruplar, satır içi düzenleme (yeniden çizimde yazılan korunur), saatli bildirim (`checkReminderTimes`, 30 sn; toast + izin verilmişse `Notification`; yalnızca sekme açıkken), kart zili (`remBell`).
- **Notlarım**: tarihsiz; en son güncellenen başta; değişiklik yoksa `updatedAt` değişmez.
- **Projeler**: liste (`renderProjectList`), detay (`renderProjectDetail`: notlar, işler, dosyalar + metin durumu rozetleri `attTextBadge`/`loadAttTextStatus`), proje notu modalı (ikinci `RichEditor` örneği `pnEditor`). Proje silinince notlar hedef projeye taşınır; "Projesiz" seçilirse silinir.
- **Ayarlar**: sorumlular, projeler, AI modelleri. Kenar çubuğu gezinmesi dikey menü (ikon + sola yaslı başlık + sağa yaslı sayaç, aktifte sol vurgu çizgisi; dar ekranda yatay) — `VIEWS` tablosu + `switchView`.
- **Yedek (JSON dışa/içe aktar)**: tüm türler (ekler hariç); içe aktarma her tür için ne değişeceğini sorar.
- **Eski sunucu uyarısı**: `boot` sırasında `meta`'da yeni türler yoksa "Sunucuyu yeniden başlatın" uyarısı; PUT 404 dönerse aynı açıklayıcı mesaj.

## AI (önemli ayrıntılar)
**Pano asistanı** (`/api/ai/chat`, `lib/ai-board.js` + `js/components/ai-chat.js` + `js/features/ai-bridge.js`): sunucu yalnızca aracıdır; sistem mesajı, araç şemaları ve sınırlar sunucuda. Araçları tarayıcı çalıştırır (`aiApply`), sonuçları `tool` mesajı olarak geri gönderir; mesaj başına en fazla 6 tur. Araçlar: `create_tasks`, `update_tasks`, `move_tasks`, `list_tasks`, `get_task`; **silme/arşivleme yok**. `aiApply` öğe öğe doğrular, geçerlileri tek `commit` ile uygular, `applied: 0` ise `warning` döner; her adım için geri alma kaydı (`aiUndo`). Modal açıkken değişiklik reddedilir. Pano özeti her işte hazır `due` metni taşır; sistem mesajında 14 günlük takvim var. Kurallar: tarih uydurma, id gösterme, varsayılan sorumlu/öncelik, özeti yalnızca `ok` listesine dayandır, toplu işte önce `list_tasks`.

**Proje asistanı** (`/api/ai/project`, `lib/ai-project.js` + `js/views/project-assistant.js` → `pa*` fonksiyonları): bağlamı `projectContext` DB'den kurar: seçili notların `text`'i, eklerin `attText` metni (okunamayanlar yalnızca adıyla `unreadable`), isteğe bağlı işler. **Bütçe**: yerleşik 150 bin, yerel 40 bin karakter; `fitBudget` tek bir üst sınırla adil kırpar (küçük kaynaklar tam kalır). Sistem mesajı: yalnızca kaynaklara dayan, uydurma, `[Not: …]`/`[Dosya: …]` diye kaynak göster, tablo/başlık kullanma. Zaman aşımı en az 180 sn. İstemci okunamayan ek kimliklerini de gönderir (adlarının bildirilmesi için). Sohbet bellekte; "Yanıtı nota kaydet" → yeni `projectNotes` kaydı. Model seçimi pano asistanıyla ortak (`AiModels`).

**Modeller:** yerleşik `openrouter` → `openai/gpt-oss-120b` (`X-Title` başlığı; pano isteklerinde `provider.require_parameters`). Ek modeller OpenAI uyumlu `baseUrl + /chat/completions`; zaman aşımı 180 sn. `<think>` metni atılır. Seçili model `localStorage` (`isTakip.aiModel`).

**Gizlilik:** pano: aktif işlerin özeti; proje asistanı: seçili notların ve eklerin **tam metni**. Seçili modele (OpenRouter → internet) gider. Kullanıcının gerçek verisini canlı modele **göndermeyin**; canlı denemeleri sentetik test verisiyle yapın.

## Test yaklaşımı
Repoda test dosyası **yok**; geçici test betikleri scratchpad'de yazılıp çalıştırılır. Aynı yöntemi tekrarlayın:
- **Gerçek veriye dokunmayın.** Testte `DATA_DIR=<scratchpad>/<klasör> PORT=3917 node server.js`. `data/` kullanıcının gerçek verisidir; kullanıcının sunucusu 3000'dedir (penceresiz servis olabilir). Gerçek veriyle bir şey doğrulamak gerekirse `data/`'yı **kopyalayıp** kopyada çalışın (yalnızca okuma isteği bile 3000'e gönderilecekse GET olsun).
- **Tarayıcı testi:** Chrome headless (`--headless=new --remote-debugging-port=9333 --user-data-dir=<geçici>`), Node 24'ün yerleşik `WebSocket`'iyle CDP: `Runtime.evaluate`, `Page.captureScreenshot`, `Input.dispatchMouseEvent`/`dispatchKeyEvent` (gerçek fare olayları; ör. modal dışına taşan seçim), `Page.printToPDF` (gerçekçi PDF test dosyası üretmek için). Konsol hatalarını `Runtime.exceptionThrown` ile toplayın. `state` bir ES modülünün içindedir, dışarıdan (ör. `Runtime.evaluate`) erişilemez: DOM'dan okuyun ya da sunucu API'sine bakın.
- **Sürükle-bırak**: sentetik `DragEvent` + `DataTransfer` ile (`dragstart` karta, `dragover`/`drop` sekmeye).
- **AI testi:** `OPENROUTER_URL=http://127.0.0.1:<port>/v1/chat/completions OPENROUTER_API_KEY=test-...` ile sahte OpenAI uyumlu sunucu; kuyruktan yanıt döndürüp istekleri kaydetsin (gönderilen sistem mesajını doğrulamak için), gecikme ve HTTP hata kodu da verebilsin. Canlı deneme: ortam değişkenlerini silip `.env`'deki anahtarla, **yalnızca sentetik veriyle**.
- **Demo veri:** `DATA_DIR=... PORT=3917 node tools/demo-veri.js` (28 iş, 4 proje, 3 arşiv kaydı; 7 gecikmiş, 3 bugün, 5 yakın).
- **Göç testi:** eski sürüm `server.js`'in bir kopyasıyla JSON verisi üretip yeni sunucuyu aynı klasörde açın; `/api/state` birebir aynı olmalı.
- **Servis testi:** `servis.ps1 -GorevAdi IsTakip-Test -Port 3917 -VeriKlasoru <geçici>`; bittiğinde görevi ve `logs/server-3917.log`'u silin. Kullanıcının "IsTakip" görevine dokunmayın.
- `node --check <dosya>`; PowerShell için `[System.Management.Automation.Language.Parser]::ParseFile`.
- **`server.js` / `lib/` değişirse** kullanıcıya sunucuyu yeniden başlatmasını söyleyin: `servis\servis-kur.bat` (eski sunucuyu durdurup yenisini başlatır); elle çalışıyorsa `node server.js` penceresinde Ctrl+C + yeniden çalıştır. Yalnızca `public/` değiştiyse F5 yeterlidir (statik dosyalar `no-cache`).

## Bilinen tuzaklar
- **Eski sunucu + yeni arayüz:** `public/` hemen yenilenir ama sunucu eski kodla çalışmaya devam eder → yeni türler 404. Arayüz bunu uyarır; kullanıcıya yeniden başlatmayı hatırlatın.
- **Servis süreç eşleme:** `gizli.vbs` komutu `cmd.exe /c ""...\calistir.cmd" 3000"` biçimindedir (port sonrası **tırnak**). `servis.ps1` bu cmd sürecini ve onun `node` çocuğunu komut satırıyla bulur; sıra wscript → cmd → node (döngü yeniden başlatmasın). `cmd /c` ikiden fazla tırnakta ilk ve son tırnağı sildiği için komutun tamamı bir kat daha tırnaklıdır. Gizli pencerede `timeout` çalışmaz; bekleme `ping` ile.
- **Windows PowerShell 5.1:** `.ps1` UTF-8 **BOM**'suz olursa Türkçe bozulur; `Invoke-WebRequest` proxy algılamasında zaman aşımını dinlemeden takılabilir → port kontrolü `TcpClient.ConnectAsync(...).Wait(1500)` ile.
- **SQLite:** WAL kullanılmıyor (bilinçli): süreç zorla kapatılınca (Windows'ta `kill` = zorla) veri `-wal`'da kalıp `.db` eksik görünüyordu; `.db` dosyası tek başına kopyalanınca (yedek, taşıma) eksik olmasın diye. Port doluyken (`EADDRINUSE`) DB açılmaz, yedek alınmaz.
- **Test betikleri:** scratchpad'deki `stop.sh` bash'ten başlatılan **tüm** node süreçlerini kapatır; bir node test betiğinin içinden çağırırsanız betiğin kendisini de öldürür (betik kendi sunucusunu `spawn` edip `kill` etmeli). Bash heredoc içinde ters eğik çizgiler (`\\`, `\n` içeren regex'ler) bozulabiliyor: kaçış içeren betikleri Write aracıyla dosyaya yazın. Zararlı HTML'i `innerHTML` ile test sayfasına doğrudan yazmak kodu tarayıcıda o an çalıştırır; XSS'i kaydedilen veriden ya da sunucuya doğrudan yazılmış veriden test edin.
- **Git satır sonu dönüşümü:** kullanıcıda `core.autocrlf` açık. `data/` artık git dışında; yine de `.gitattributes` `data/**` ve ikili türler için dönüşümü kapatır (`-text`), çünkü metin sanılan ekler (ör. PDF) depodan geri alınırken bozulur. Depoya ikili/veri dosyası eklerseniz bunu koruyun.
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
10. `baslat.bat` kaldırıldı (yerini `servis-kur.bat` aldı; tarayıcıyı da o açıyor); proje git'e işlendi ve `main`'e birleştirildi; `data/` git takibinden çıkarıldı.
11. **12 yeni istek planı (PLAN.md sonu):** kod modüllere bölündü — istemci `public/js/` (ES modülleri), HTML `public/partials/` (sunucu birleştiriyor), CSS `public/css/`, sunucu `lib/`. Davranış değişmedi (önce/sonra ekran görüntüleri piksel düzeyinde aynı).

## Kullanıcı tercihleri ve çalışma biçimi
- Kullanıcı Türkçe yazıyor; açıklamaları ve özetleri Türkçe verin.
- Büyük işlerde önce plan ve checklist istiyor (plan modu). Onaydan sonra **her madde bitince PLAN.md'deki checklist'i işaretleyip "devam edeyim mi?" diye sormanızı** bekliyor.
- Değişikliklerin gerçek tarayıcıda test edilip ekran görüntüsüyle doğrulanmasını bekliyor; test sonuçlarını (başarısızlar ve test hataları dahil) dürüstçe bildirin.
- Kullanıcının gerçek verisine yalnızca açıkça istendiğinde yazın; yazmadan önce yedek alın ve çalışan sunucunun API'sini `baseUpdatedAt` ile kullanın.
- Kapsamı değiştiren belirsiz isteklerde (ör. "arşivi sınırla" hangi arşiv?) uygulamadan önce sorun.
