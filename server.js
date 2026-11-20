/* İş Takip — minimal yerel sunucu.
   Bağımlılık yok (sadece Node.js yerleşik modülleri).
   - public/ klasörünü sunar
   - /api/state  (GET)  → tasks + projects + archive + units + reminders + memos (kişisel notlar) + projectNotes
   - /api/:kind  (PUT)  → kind: tasks | projects | archive | units | reminders | memos | projectNotes, gövde: { items: [...], baseUpdatedAt }
   - /api/attachments      (POST) → ham dosya gövdesi, X-File-Name başlığı → { id, name, size, type }
   - /api/attachments/:id  (GET)  → ek dosyasını indirir
   - /api/ai/chat          (POST) → { messages, board, modelId } → seçilen modele (OpenRouter ya da OpenAI uyumlu yerel sunucu) aracılık eder.
   - /api/ai/models        (GET/PUT) → kayıtlı AI modelleri (anahtarlar tarayıcıya gönderilmez)
   - /api/ai/models/test   (POST) → { baseUrl, apiKey?, id? } → sunucunun /models listesini döndürür
     Araçları (kart oluştur/düzenle/taşı) tarayıcı çalıştırır; anahtar yalnızca sunucuda kalır.
   - /api/backup           (POST) → { label? } → veritabanının anlık yedeği (data/backup/<label>-<zaman>.db)
   - /api/backup/download  (GET)  → tam yedek: manifest.json + is-takip.db + attachments/* tek .zip
   - /api/backup/restore   (POST) → ham .zip → doğrula, öncesini backup/geri-yukleme-oncesi-*.zip olarak yedekle, veritabanı + ekleri değiştir
   Veriler data/is-takip.db SQLite veritabanında durur (Node'un yerleşik node:sqlite modülü). İlk açılışta eski
   data/*.json dosyaları otomatik içe aktarılır ve data/json-yedek-<zaman>/ klasörüne taşınır.
   Ek dosyaları data/attachments/ altında, bilgileri veritabanında durur.
   Sunucu yalnızca bu bilgisayardan (127.0.0.1) erişilebilir. */

"use strict";
const http = require("http");
const { AI_MODEL, readModels } = require("./lib/ai-common");
const { cleanupOrphanAttachments } = require("./lib/attachments");
const { cleanupTmp } = require("./lib/backup-zip");
const { DATA_DIR, HOST, PORT } = require("./lib/config");
const { backupOnStartup, closeStorage, startStorage } = require("./lib/db");
const { handle } = require("./lib/routes");

const server = http.createServer(handle);

server.on("error", e => {
  if(e.code === "EADDRINUSE"){
    console.error("Port " + PORT + " zaten kullanımda. Uygulama başka bir pencerede çalışıyor olabilir ya da PORT ortam değişkeniyle farklı bir port seçin.");
  } else {
    console.error("Sunucu hatası:", e.message);
  }
  process.exit(1);
});

/* Veritabanı ve yedek, port başarıyla açıldıktan sonra açılır/alınır; böylece "port dolu" ile biten açılışlar eski yedekleri döndürmez. */
server.listen(PORT, HOST, () => {
  try{ startStorage(); }
  catch(e){ console.error("Veri deposu açılamadı: " + e.message); process.exit(1); }
  try{ backupOnStartup(); }catch(e){ console.error("Yedek alınamadı:", e.message); }
  try{ cleanupOrphanAttachments(); }catch(e){ console.error("Ek temizliği atlandı:", e.message); }
  try{ cleanupTmp(); }catch(e){ console.error("Geçici dosyalar silinemedi:", e.message); }
  console.log("İş Takip çalışıyor:  http://" + (HOST === "127.0.0.1" ? "localhost" : HOST) + ":" + PORT);
  console.log("Veri klasörü:        " + DATA_DIR);
  const extra = readModels().length;
  console.log("AI asistan:          OpenRouter " + (process.env.OPENROUTER_API_KEY ? "hazır (" + AI_MODEL + ")" : "kapalı — .env dosyasında OPENROUTER_API_KEY yok") +
    (extra ? " · " + extra + " ek model kayıtlı" : ""));
  console.log("Kapatmak için bu pencerede Ctrl+C.");
});

/* Ctrl+C / kapatma: veritabanını düzgün kapat */
["SIGINT", "SIGTERM", "SIGBREAK"].forEach(sig => process.on(sig, () => { closeStorage(); process.exit(0); }));
process.on("exit", closeStorage);
