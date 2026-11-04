# İş Takip

Yerel çalışan, bağımlılıksız iş takip uygulaması. Veriler tarayıcıda değil, bu klasördeki `data/` altındaki JSON dosyalarında tutulur.

## Çalıştırma
1. Node.js (LTS) kurulu olmalı: https://nodejs.org
2. Windows: `baslat.bat` dosyasına çift tıklayın. Diğer sistemler: `node server.js`, ardından http://localhost:3000
3. Uygulamayı kullanırken açılan siyah pencere (sunucu) açık kalmalı. Kapatmak için pencerede Ctrl+C.

## Özellikler
- **Pano / Arşiv / Ayarlar** sekmeleri (sol üst).
- **Zengin metin açıklama:** kalın, italik, liste, başlık, bağlantı, tablo; resim yapıştırılabilir. "Ek" butonuyla ya da sürükle-bırakla dosya eklenir (dosya başına en fazla 25 MB).
- **Tarihler** her yerde `gg.aa.yyyy` (ör. 04.11.2026) biçimindedir. Elle yazılabilir ya da takvim simgesinden seçilebilir.
- **Mail taslağı:** Kartın sol üstündeki kutuyla (ya da Ctrl+tık ile) bir veya birden fazla iş seçin, alttaki çubukta "Mail taslağı oluştur"a basın. İş penceresindeki "Mail taslağı" butonu da tek iş için aynısını yapar. İnen `.eml` dosyasını açtığınızda Outlook bunu düzenlenebilir bir taslak olarak açar; açıklama, resimler ve ekler içindedir. Alıcıları ekleyip gönderin.
  - `.eml` dosyaları Windows'ta Outlook yerine başka bir programla açılıyorsa: dosyaya sağ tıklayın → Birlikte aç → Outlook → "Her zaman bu uygulamayı kullan".
- **Uyarılar:** Gecikmiş / bugün biten / yaklaşan işler panonun üstünde tek satırlık özet olarak görünür. "Ayrıntılar" ile liste açılır; bir sayıya tıklamak panoyu o gruba göre filtreler.
- **Ayarlar:** Sorumlu ve proje ekleme, yeniden adlandırma, renk ve sıra değiştirme, silme. İşleri olan bir sorumlu ya da proje silinirken işlerin kime aktarılacağı sorulur.

## AI asistan
Üst çubuktaki **AI Asistan** butonu sağda bir sohbet paneli açar. Doğal dille bir veya birden fazla işi oluşturabilir, düzenleyebilir ve taşıyabilir. Örnekler:
- "Veri Ambarı projesine cuma bitecek kritik bir iş ekle"
- "Gecikmiş işlerin hepsine 'takipte' notu ekle"
- "Test işi 12'yi Devam Ediyor'a al"

Değişiklikler hemen uygulanır ve dosyaya yazılır. Her adımın altındaki **Geri al** butonu o adımı tümüyle geri alır. AI iş silemez ve arşivleyemez. Sohbet kaydedilmez; sayfa yenilenince sıfırlanır.

**Kurulum:** Proje klasöründe `.env` adlı bir dosya oluşturun (örnek: `.env.example`) ve içine şunu yazın, sonra sunucuyu yeniden başlatın:
```
OPENROUTER_API_KEY=sk-or-...
```
Model `openai/gpt-oss-120b`, istekler OpenRouter üzerinden gider. Anahtar yalnızca sunucuda kalır, tarayıcıya gönderilmez.

**Başka modeller (yerel):** Ayarlar → **AI Modelleri** bölümünden OpenAI uyumlu herhangi bir sunucu ekleyebilirsiniz (Ollama, LM Studio, vLLM, llama.cpp…):
1. "Hazır adres" düğmesiyle adresi doldurun (ör. Ollama: `http://localhost:11434/v1`) ya da elle yazın.
2. **Modelleri getir** ile sunucudaki modelleri listeleyip birini seçin, gerekirse API anahtarını girin, **Kaydet**.
3. AI panelinin başlığındaki açılır listeden hangi modelin kullanılacağını seçin (seçim bu tarayıcıda hatırlanır).

Model, kartları değiştirebilmek için **araç çağırmayı (tool calling)** desteklemelidir (ör. Qwen 2.5, Llama 3.1+, Mistral Nemo; Ollama'da çoğu güncel model). Desteklemeyen modeller yalnızca sohbet edebilir ya da hata verir. Küçük modeller araçları daha az güvenilir kullanır.
Kayıtlı modeller ve anahtarları `data/ai-models.json` dosyasında **düz metin** olarak durur; tarayıcıya gönderilmez, açılış yedeklerine ve dışa aktarmaya dahil edilmez. Anahtarı silmek için düzenlerken anahtar alanına `-` yazıp kaydedin.

**Gizlilik:** Her mesajda panodaki **aktif işlerin özeti** (başlık, durum, sorumlu, proje, tarihler, açıklamanın ilk 300 karakteri, son not) seçili modele gönderilir: OpenRouter seçiliyse OpenRouter'a ve modeli çalıştıran sağlayıcıya, yerel bir model seçiliyse yalnızca o sunucuya. Arşiv ve ek dosyaları gönderilmez.

## Demo veri
Denemek için panoyu örnek işlerle doldurabilirsiniz (sunucu açıkken):
```
node tools/demo-veri.js          # 28 iş, 4 proje, 3 arşiv kaydı ekler; tarihler bugüne göre (gecikmiş/bugün/yaklaşan karışık)
node tools/demo-veri.js --sil    # yalnızca demo kayıtlarını kaldırır
```
Mevcut verinize dokunulmaz; önce `data/backup/demo-oncesi-<zaman>/` altına yedek alınır. Demo kayıtlarının kimlikleri `demo-` ile başlar.

## Veri dosyaları (`data/`)
- `tasks.json` – aktif işler
- `projects.json` – projeler
- `archive.json` – arşivlenmiş işler (ayrı dosya)
- `units.json` – sorumlular (ilk değişikliğe kadar oluşmaz; yoksa varsayılan liste kullanılır)
- `attachments/` – ek dosyaları ve açıklamalara yapıştırılan resimler
- `backup/` – sunucu her açılışta otomatik yedek alır (son 30 tutulur)

Her ekleme/güncelleme/silme anında ilgili dosyaya yazılır (atomik yazım). Sayfa her açıldığında ve sekmeye dönüldüğünde veri dosyalardan okunur. Dosyaları elle düzenleyebilirsiniz (sunucu kapalıyken ya da sayfayı yenileyin).

Hiçbir işin kullanmadığı ve 1 günden eski ekler, sunucu açılırken `attachments/` klasöründen silinir. Bir JSON dosyası bozuksa bu temizlik yapılmaz.

**Önemli:** Açılış yedekleri (`backup/`) ve "Dışa/İçe Aktar" yalnızca JSON verilerini kapsar, **ek dosyalarını içermez**. Ekleri de yedeklemek için `data/attachments/` klasörünü ayrıca kopyalayın.

## Ayarlar (ortam değişkenleri)
`PORT` (varsayılan 3000), `DATA_DIR` (varsayılan `./data`). Sunucu sadece bu bilgisayardan erişilebilir (127.0.0.1).

## Hata durumları
- Sunucu kapalıysa sayfa kilitli uyarı gösterir; sunucuyu başlatıp "Tekrar dene".
- Bir JSON dosyası bozulursa uygulama veriyi ezmemek için açılmaz ve hatayı gösterir; dosyayı düzeltin veya `data/backup/` içinden geri koyun.
- Yazma başarısız olursa sol alttaki durum satırında kırmızı uyarı ve "Tekrar dene" çıkar.
- Uygulama iki pencerede açıksa ve biri diğerinin değiştirdiği dosyayı ezmeye çalışırsa kayıt reddedilir ve "Sayfayı yenile" önerilir.
