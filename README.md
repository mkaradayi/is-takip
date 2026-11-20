# İş Takip

Yerel çalışan, bağımlılıksız iş takip uygulaması. Veriler tarayıcıda değil, bu klasördeki `data/is-takip.db` SQLite veritabanında tutulur (Node.js'in yerleşik SQLite desteğiyle; ek program gerekmez).

## Çalıştırma
1. **Node.js 22.13 veya üstü** kurulu olmalı (LTS önerilir): https://nodejs.org
2. **Windows (önerilen):** `servis\servis-kur.bat` dosyasına bir kez çift tıklayın. Uygulama arka planda başlar, tarayıcı http://localhost:3000 adresiyle açılır ve bundan sonra her oturum açılışında kendiliğinden çalışır (aşağıya bakın). Tarayıcıda adresi yer imlerine ekleyin.
3. **Elle çalıştırma (her sistem):** proje klasöründe `node server.js`, ardından http://localhost:3000. Açılan pencere (sunucu) açık kalmalı; kapatmak için Ctrl+C.
4. Uygulama güncellendiğinde (`server.js` ya da `lib/` değiştiğinde) sunucuyu yeniden başlatın (`servis-kur.bat`'ı tekrar çalıştırın). Sunucu eski sürümde kalırsa sayfa "Sunucuyu yeniden başlatın" uyarısı gösterir.

## Otomatik başlatma (Windows)
Uygulama, oturum açılınca arka planda (penceresiz) başlayacak şekilde kurulur. Bunun için Windows Görev Zamanlayıcı kullanılır; yönetici izni ya da ek program gerekmez.

| Dosya (`servis/` klasörü) | İş |
|---|---|
| `servis-kur.bat` | "IsTakip" görevini kurar, sunucuyu hemen başlatır ve tarayıcıyı açar |
| `servis-durum.bat` | Görev durumu, sunucunun yanıt verip vermediği ve son log satırları |
| `servis-kaldir.bat` | Çalışan sunucuyu durdurur ve görevi siler |

- Kurmadan önce elle açılmış bir sunucu penceresi (`node server.js`) varsa Ctrl+C ile kapatın. Port başka bir programdaysa kurulum görevi oluşturur ama başlatmaz ve bunu bildirir.
- Sunucu çökerse 10 saniye sonra kendiliğinden yeniden başlar.
- Sunucu çıktısı `logs/server.log` dosyasına yazılır; dosya 5 MB'ı aşınca `server.log.1` olarak saklanır.
- **Güncellemeden sonra** `servis-kur.bat`'ı tekrar çalıştırmanız yeterli: eski sunucuyu durdurur, görevi yeniden kurar ve yenisini başlatır.

## Sayfalar (sol üst)
**Pano · Projeler · Hatırlatma · Notlarım · Arşiv · Ayarlar**

### Pano
- İşler **durum sekmeleriyle** ayrılır: `Backlog · Beklemede · Devam Ediyor · Tamamlandı · İptal`. Sekmedeki sayı, kenar çubuğu filtrelerine ve aramaya göre değişir; son seçilen sekme hatırlanır.
- Bir kartı başka bir **sekmenin üzerine sürükleyerek** durumunu değiştirebilirsiniz. Beklemede, Devam Ediyor ve Tamamlandı için başlangıç ve bitiş tarihi zorunludur; tarihsiz bir işi bu durumlara taşırsanız tarih istenir.
- **Arama** başlıkta, açıklamada ve durum notlarında arar (Türkçe büyük/küçük harf duyarsız). Eşleşme açıklamada ya da notta bulunduysa kartta küçük bir etiket görünür.
- **Uyarılar:** Gecikmiş / bugün biten / yaklaşan işler ve bugünkü hatırlatmalar panonun üstünde tek satırlık özet olarak görünür. "Ayrıntılar" ile liste açılır; bir sayıya tıklamak panoyu o gruba göre filtreler.
- **İş penceresi:** zengin metin açıklama (kalın, liste, başlık, bağlantı, tablo; resim yapıştırılabilir), dosya ekleri (dosya başına en fazla 25 MB), durum notları, bu işe bağlı hatırlatmalar ve notlar. Kaydedilmemiş değişiklik varken pencereyi kapatmaya çalışırsanız onay istenir; metin seçerken fare dışarı kaysa bile pencere kapanmaz.
- **Tarihler** her yerde `gg.aa.yyyy` (ör. 04.11.2026) biçimindedir. Elle yazılabilir ya da takvim simgesinden seçilebilir.
- **Mail taslağı:** Kartın sol üstündeki kutuyla (ya da Ctrl+tık ile) bir veya birden fazla iş seçin (sekme başındaki "Tümünü seç" de var), alttaki çubukta "Mail taslağı oluştur"a basın. İş penceresindeki "Mail taslağı" butonu tek iş için aynısını yapar. İnen `.eml` dosyasını Outlook düzenlenebilir bir taslak olarak açar; açıklama, **tüm durum notları**, resimler ve ekler içindedir.
  - `.eml` dosyaları Windows'ta Outlook yerine başka bir programla açılıyorsa: dosyaya sağ tıklayın → Birlikte aç → Outlook → "Her zaman bu uygulamayı kullan".

### Projeler
- Proje kartları: aktif iş, gecikmiş iş, not ve dosya sayıları. Bir projeye tıklayınca proje sayfası açılır:
  - **Notlar:** toplantı notu, karar, yazışma özeti gibi zengin metinli notlar; dosya eklenebilir. Notlarda arama yapılabilir; bir not başka projeye taşınabilir.
  - **İşler:** duruma göre sayılar (tıklayınca pano o proje ve durumla açılır) ve projenin işleri.
  - **Dosyalar:** notlardaki tüm ekler ve her birinin **metin durumu**: `✓ okunabilir`, `⚠ kısmen`, `✗ okunamadı` (ör. taranmış ya da şifreli PDF), `– desteklenmiyor`.
  - **Proje asistanı** (aşağıda).
- Projeler Ayarlar'dan eklenir. Notları olan bir proje silinirken notlar seçtiğiniz projeye taşınır; "Projesiz" seçilirse notlar ekleriyle birlikte silinir.

### Hatırlatma
Tarihli hatırlatmalar; isteğe bağlı saat ve iş bağlantısı. Gecikmiş / Bugün / Yaklaşan (7 gün) / Daha sonra / Tamamlanan olarak gruplanır. Saat verilen hatırlatma, **uygulama bir tarayıcı sekmesinde açıkken** zamanı gelince bildirim gösterir ("Masaüstü bildirimlerine izin ver" ile Windows bildirimi de çıkar). Hatırlatması olan kartlarda zil simgesi görünür.

### Notlarım
Tarihsiz kişisel notlar; isteğe bağlı iş bağlantısı. En son güncellenen en üstte görünür; arama yapılabilir. Enter yeni satır, Ctrl+Enter ekler/kaydeder.

### Arşiv ve Ayarlar
- **Arşiv:** arşivlenmiş işler; geri alma, kalıcı silme, arama (başlık, açıklama, notlar). Arşivdeki işler otomatik silinmez.
- **Ayarlar:** sorumlular, projeler (ekleme, yeniden adlandırma, renk, sıra, arşivleme, silme) ve AI modelleri.

## AI asistan (pano)
Üst çubuktaki **AI Asistan** butonu sağda bir sohbet paneli açar. Doğal dille bir veya birden fazla işi oluşturabilir, düzenleyebilir ve taşıyabilir. Örnekler:
- "Veri Ambarı projesine cuma bitecek kritik bir iş ekle"
- "Gecikmiş işlerin hepsine 'takipte' notu ekle"
- "Test işi 12'yi Devam Ediyor'a al"

Değişiklikler hemen uygulanır ve kaydedilir. Her adımın altındaki **Geri al** butonu o adımı tümüyle geri alır. AI iş silemez ve arşivleyemez. Sohbet kaydedilmez; sayfa yenilenince sıfırlanır.

## Proje asistanı
Proje sayfasının üstündeki **Proje asistanı**, projenin notlarını ve eklerin metnini seçili modele vererek sorularınızı yanıtlar.
- Varsayılan olarak **tüm notlar ve okunabilen tüm ekler** gönderilir. "Kaynakları seç" ile not ya da dosya çıkarabilir, "Projenin işlerini de ekle" ile işleri ekleyebilirsiniz.
- Hazır sorular: **Özet çıkar**, **Açık konular / riskler**, **Kararlar ve aksiyonlar**. Ya da kendi sorunuzu yazın; takip soruları önceki yanıtları da dikkate alır.
- Model yalnızca bu kaynaklara dayanır, bilgiyi uydurmaz ve kaynağı `[Not: …]` / `[Dosya: …]` şeklinde gösterir. Yanıtın altında kullanılan, kısaltılan ve okunamayan kaynaklar yazar.
- **Yanıtı nota kaydet** yanıtı soruyla birlikte yeni bir proje notu olarak ekler.
- **Desteklenen dosyalar:** txt, md, csv, json, log, xml, html, eml (Outlook'tan kaydedilmiş mailler), Word (.docx), PDF (yalnızca metin katmanı olanlar; taranmış PDF okunamaz, OCR yoktur). Eski Word (.doc), Excel, resim vb. için yalnızca dosya adı gider.
- **Sınır:** Bir seferde OpenRouter modeline yaklaşık 150 bin, yerel modellere yaklaşık 40 bin karakter gönderilir. Aşılırsa büyük kaynaklar kısaltılır, küçük notlar tam kalır.

## AI kurulumu ve modeller
**OpenRouter:** Proje klasöründe `.env` adlı bir dosya oluşturun (örnek: `.env.example`) ve içine şunu yazın, sonra sunucuyu yeniden başlatın:
```
OPENROUTER_API_KEY=sk-or-...
```
Model `openai/gpt-oss-120b`. Anahtar yalnızca sunucuda kalır, tarayıcıya gönderilmez.

**Başka modeller (yerel):** Ayarlar → **AI Modelleri** bölümünden OpenAI uyumlu herhangi bir sunucu ekleyebilirsiniz (Ollama, LM Studio, vLLM, llama.cpp…):
1. "Hazır adres" düğmesiyle adresi doldurun (ör. Ollama: `http://localhost:11434/v1`) ya da elle yazın.
2. **Modelleri getir** ile sunucudaki modelleri listeleyip birini seçin, gerekirse API anahtarını girin, **Kaydet**.
3. AI panelinin ya da proje asistanının başlığındaki listeden modeli seçin (iki panel ortak; seçim bu tarayıcıda hatırlanır).

Pano asistanının kartları değiştirebilmesi için model **araç çağırmayı (tool calling)** desteklemelidir (ör. Qwen 2.5, Llama 3.1+, Mistral Nemo). Proje asistanı araç kullanmaz; her sohbet modeliyle çalışır, ama bağlam penceresi küçük modellerde daha az kaynak gönderilir.
Kayıtlı modeller ve anahtarları `data/ai-models.json` dosyasında **düz metin** olarak durur; tarayıcıya gönderilmez, yedeklere ve dışa aktarmaya dahil edilmez. Anahtarı silmek için düzenlerken anahtar alanına `-` yazıp kaydedin.

**Gizlilik:**
- **Pano asistanı:** her mesajda panodaki aktif işlerin özeti (başlık, durum, sorumlu, proje, tarihler, açıklamanın ilk 300 karakteri, son not) gönderilir.
- **Proje asistanı:** seçilen notların ve eklerin **tam metni** (ve isterseniz projenin işleri) gönderilir.
- OpenRouter seçiliyse bu veriler OpenRouter'a ve modeli çalıştıran sağlayıcıya (internete) gider; yerel bir model seçiliyse yalnızca o sunucuya.

## Demo veri
Denemek için örnek işler ekleyebilirsiniz (sunucu açıkken):
```
node tools/demo-veri.js          # 28 iş, 4 proje, 3 arşiv kaydı ekler; tarihler bugüne göre (gecikmiş/bugün/yaklaşan karışık)
node tools/demo-veri.js --sil    # yalnızca demo kayıtlarını kaldırır
```
Mevcut verinize dokunulmaz; önce `data/backup/demo-oncesi-<zaman>.db` yedeği alınır. Demo kayıtlarının kimlikleri `demo-` ile başlar.

## Veri (`data/`)
- `is-takip.db` – tüm veri: işler, arşiv, projeler, sorumlular, hatırlatmalar, notlarım, proje notları, ek bilgileri ve eklerden çıkarılmış metin önbelleği. Her değişiklik anında ve tek işlem halinde kaydedilir.
- `attachments/` – ek dosyalarının kendisi ve açıklamalara/notlara yapıştırılan resimler.
- `backup/` – sunucu her açılışta otomatik yedek alır (`<zaman>.db`); **yalnızca en son yedek tutulur**, yenisi başarıyla alınınca eskiler silinir.
- `json-yedek-<zaman>/` – eski sürümden (JSON dosyaları) SQLite'a ilk geçişte özgün dosyalar buraya taşınır; silinmez.
- `ai-models.json` – kayıtlı yerel AI modelleri (anahtarlar düz metin).

Sayfa her açıldığında ve sekmeye dönüldüğünde veri sunucudan yeniden okunur. Hiçbir kaydın kullanmadığı ve 1 günden eski ekler, sunucu açılırken silinir.

**Yedekten geri dönmek:** Sunucuyu kapatın, `data/is-takip.db` dosyasını bir yere kopyalayın, `data/backup/` içindeki `.db` dosyasını `data/is-takip.db` adıyla yerine koyun ve sunucuyu başlatın.

**Önemli:** Açılış yedeği ve "Dışa/İçe Aktar" (.json) **ek dosyalarını içermez**. Ekleri de yedeklemek için `data/attachments/` klasörünü ayrıca kopyalayın. Yalnızca tek açılış yedeği tutulduğu için önemli dönemlerde "Yedek olarak dışa aktar" ile ayrıca yedek alın.

## Ayarlar (ortam değişkenleri)
`PORT` (varsayılan 3000), `DATA_DIR` (varsayılan `./data`). Sunucu sadece bu bilgisayardan erişilebilir (127.0.0.1).

## Hata durumları
- Sunucu kapalıysa sayfa kilitli uyarı gösterir; sunucuyu başlatıp "Tekrar dene".
- Veritabanı bozuksa sunucu açılmaz ve hatayı yazar; `data/backup/` içindeki yedeği geri koyun (yukarıda).
- Yazma başarısız olursa sol alttaki durum satırında kırmızı uyarı ve "Tekrar dene" çıkar. "Sunucu eski sürümle çalışıyor" yazıyorsa sunucuyu yeniden başlatın.
- Uygulama iki pencerede açıksa ve biri diğerinin değiştirdiği veriyi ezmeye çalışırsa kayıt reddedilir ve "Sayfayı yenile" önerilir.
