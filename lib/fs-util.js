/* Dosya yardımcıları: Windows'ta yeniden denemeli rename, atomik yazma */
"use strict";
const fs = require("fs");

/* Windows'ta antivirüs/dizinleyici dosyayı kısa süre tutabilir; rename'i birkaç kez dene. */
function renameWithRetry(from, to){
  for(let i = 0; ; i++){
    try{ fs.renameSync(from, to); return; }
    catch(e){
      if(i >= 5 || !["EPERM", "EBUSY", "EACCES"].includes(e.code)) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50 * (i + 1));
    }
  }
}



function writeFileAtomic(p, data){
  const tmp = p + ".tmp-" + process.pid;
  try{
    const fd = fs.openSync(tmp, "w");
    fs.writeSync(fd, data);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    renameWithRetry(tmp, p);
  }catch(e){
    try{ fs.unlinkSync(tmp); }catch(_){}
    throw e;
  }
}

module.exports = { renameWithRetry, writeFileAtomic };
