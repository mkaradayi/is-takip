<#
  İş Takip — otomatik başlatma (Windows Görev Zamanlayıcı)

  Oturum açılınca sunucuyu gizli pencerede başlatan bir zamanlanmış görev kurar / kaldırır / durumunu gösterir.
  Yönetici izni gerekmez; görev yalnızca geçerli kullanıcı için çalışır. Ek program kurulmaz.

  Kullanım (genelde .bat dosyalarıyla çağrılır):
    servis.ps1 -Kur      [-GorevAdi IsTakip] [-Port 3000] [-VeriKlasoru <yol>] [-TarayiciAc]
    servis.ps1 -Kaldir   [-GorevAdi IsTakip] [-Port 3000]
    servis.ps1 -Durum    [-GorevAdi IsTakip] [-Port 3000]

  -VeriKlasoru yalnızca test içindir (DATA_DIR); verilmezse proje içindeki data/ kullanılır.
  -TarayiciAc: sunucu yanıt verince uygulamayı varsayılan tarayıcıda açar (servis-kur.bat bunu kullanır).
#>
param(
  [switch]$Kur,
  [switch]$Kaldir,
  [switch]$Durum,
  [switch]$TarayiciAc,
  [string]$GorevAdi = "IsTakip",
  [int]$Port = 3000,
  [string]$VeriKlasoru = ""
)

$ErrorActionPreference = "Stop"
$ServisDir = $PSScriptRoot
$Kok = Split-Path -Parent $ServisDir
$Vbs = Join-Path $ServisDir "gizli.vbs"
$LogDosya = Join-Path $Kok ("logs\" + $(if($Port -eq 3000){ "server.log" } else { "server-$Port.log" }))
$MinNode = [version]"22.13.0"

function Yaz($renk, $metin){ Write-Host $metin -ForegroundColor $renk }

# Port dinleniyor mu? (Invoke-WebRequest, Windows PowerShell 5.1'de proxy algılaması yüzünden zaman aşımını
# dinlemeden uzun süre takılabiliyor; bu yüzden doğrudan, kısa zaman aşımlı TCP bağlantısı kullanılır.)
function Port-YanitVeriyor {
  $c = New-Object System.Net.Sockets.TcpClient
  try { return ($c.ConnectAsync("127.0.0.1", $Port).Wait(1500) -and $c.Connected) } catch { return $false } finally { $c.Close() }
}

function Node-Kontrol {
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if(-not $cmd){ throw "Node.js bulunamadı. https://nodejs.org adresinden LTS sürümünü (22.13 veya üstü) kurun." }
  $v = [version]((& $cmd.Source --version).TrimStart("v"))
  if($v -lt $MinNode){ throw "Node.js $v çok eski; en az $MinNode gerekli (yerleşik SQLite için)." }
  return @{ Yol = $cmd.Source; Surum = $v }
}

# Görevin başlattığı süreçler: wscript (gizli.vbs) → cmd (calistir.cmd <port>) → node server.js
function Gorev-Surecleri {
  $tum = Get-CimInstance Win32_Process
  # Komut satırı: cmd.exe /c ""...\calistir.cmd" 3000"  (veri klasörü verilmişse: ... 3000 "C:\...")
  # Port numarasından sonra boşluk, tırnak ya da satır sonu gelebilir.
  $cmdler = $tum | Where-Object { $_.Name -eq "cmd.exe" -and $_.CommandLine -match "calistir\.cmd`"?\s+$Port(\s|`"|$)" }
  $sonuc = @()
  # Sıra önemli: önce wscript ve cmd (yeniden başlatma döngüsü), sonra node
  foreach($c in $cmdler){
    $sonuc += $tum | Where-Object { $_.ProcessId -eq $c.ParentProcessId -and $_.Name -eq "wscript.exe" }
    $sonuc += $c
    $sonuc += $tum | Where-Object { $_.ParentProcessId -eq $c.ProcessId -and $_.Name -eq "node.exe" }
  }
  return $sonuc
}

function Surecleri-Durdur {
  $s = Gorev-Surecleri
  foreach($p in $s){ try { Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop } catch {} }
  return @($s | Where-Object { $_.Name -eq "node.exe" }).Count
}

function Gorev-Kur {
  $node = Node-Kontrol
  Yaz Gray "Node.js $($node.Surum)  ($($node.Yol))"
  if(-not (Test-Path $Vbs)){ throw "gizli.vbs bulunamadı: $Vbs" }

  $arg = "`"$Vbs`" $Port"
  if($VeriKlasoru){ $arg += " `"$([IO.Path]::GetFullPath($VeriKlasoru))`"" }
  $kullanici = "$env:USERDOMAIN\$env:USERNAME"

  $eylem   = New-ScheduledTaskAction -Execute "wscript.exe" -Argument $arg -WorkingDirectory $Kok
  $tetik   = New-ScheduledTaskTrigger -AtLogOn -User $kullanici
  $ayarlar = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
               -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
  # RestartCount bilinçli olarak yok: yeniden deneme sınırı calistir.cmd'de (en fazla 3); vazgeçince görev yeniden başlatılmasın.
  $kimlik  = New-ScheduledTaskPrincipal -UserId $kullanici -LogonType Interactive -RunLevel Limited

  $var = Get-ScheduledTask -TaskName $GorevAdi -ErrorAction SilentlyContinue
  if($var){
    Yaz Yellow "'$GorevAdi' görevi zaten var; durdurulup yeniden kuruluyor."
    Stop-ScheduledTask -TaskName $GorevAdi -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $GorevAdi -Confirm:$false
  }
  # Bu betiğin önceden başlattığı sunucu (görev silinmiş olsa bile) eski kodla çalışıyor olabilir: durdur
  $n = Surecleri-Durdur
  if($n){
    Yaz Yellow "Eski sunucu durduruldu; yenisi başlatılacak."
    for($i = 0; $i -lt 20 -and (Port-YanitVeriyor); $i++){ Start-Sleep -Milliseconds 250 }   # portun boşalmasını bekle
  }
  $null = Register-ScheduledTask -TaskName $GorevAdi -Action $eylem -Trigger $tetik -Settings $ayarlar -Principal $kimlik `
            -Description "İş Takip sunucusu (http://localhost:$Port). Kaldırmak için servis\servis-kaldir.bat"
  Yaz Green "Görev kuruldu: '$GorevAdi' (oturum açılınca otomatik başlar, sunucu çökerse 10 sn arayla en fazla 3 kez yeniden başlatılır)."

  if(Port-YanitVeriyor){
    Yaz Yellow "Port $Port zaten kullanımda (büyük olasılıkla elle açılmış bir 'node server.js' penceresi var)."
    Yaz Yellow "O pencereyi Ctrl+C ile kapatın; görev bir sonraki oturum açılışında başlar ya da servis-kur.bat'ı tekrar çalıştırın."
    return
  }
  Start-ScheduledTask -TaskName $GorevAdi
  for($i = 0; $i -lt 30; $i++){
    if(Port-YanitVeriyor){
      Yaz Green "Sunucu çalışıyor: http://localhost:$Port"
      if($TarayiciAc){ Start-Process "http://localhost:$Port" }
      return
    }
    Start-Sleep -Milliseconds 500
  }
  Yaz Red "Görev başlatıldı ama sunucu 15 sn içinde yanıt vermedi. Log: $LogDosya"
  exit 1
}

function Gorev-Kaldir {
  $var = Get-ScheduledTask -TaskName $GorevAdi -ErrorAction SilentlyContinue
  if($var){ Stop-ScheduledTask -TaskName $GorevAdi -ErrorAction SilentlyContinue }
  $n = Surecleri-Durdur
  if($n){ Yaz Green "Çalışan sunucu durduruldu." }
  if($var){
    Unregister-ScheduledTask -TaskName $GorevAdi -Confirm:$false
    Yaz Green "Görev silindi: '$GorevAdi'. Uygulama artık otomatik başlamayacak (servis-kur.bat ile yeniden kurabilir ya da 'node server.js' ile elle açabilirsiniz)."
  } else {
    Yaz Yellow "'$GorevAdi' adında bir görev yok."
  }
}

function Gorev-Durum {
  $g = Get-ScheduledTask -TaskName $GorevAdi -ErrorAction SilentlyContinue
  if(-not $g){ Yaz Yellow "Görev kurulu değil ('$GorevAdi'). Kurmak için servis-kur.bat" }
  else {
    $info = Get-ScheduledTaskInfo -TaskName $GorevAdi
    $durumTr = @{ Ready = "Hazır (çalışmıyor)"; Running = "Çalışıyor"; Disabled = "Devre dışı"; Queued = "Sırada" }[[string]$g.State]
    Yaz Cyan  "Görev        : $GorevAdi"
    Yaz White "Durum        : $(if($durumTr){ $durumTr } else { $g.State })"
    $kod = [string]$info.LastTaskResult
    $sonuc = @{ "0" = "başarılı"; "267009" = "şu an çalışıyor"; "267011" = "henüz hiç çalışmadı"; "267014" = "kullanıcı durdurdu" }[$kod]
    if(-not $sonuc){ $sonuc = "kod 0x{0:X}" -f [int64]$kod }
    Yaz White "Son çalışma  : $(if($info.LastRunTime -and $info.LastRunTime.Year -gt 2000){ $info.LastRunTime } else { '—' })  ($sonuc)"
  }
  if(Port-YanitVeriyor){ Yaz Green "Sunucu       : yanıt veriyor  ->  http://localhost:$Port" }
  else { Yaz Red "Sunucu       : yanıt vermiyor (port $Port)" }
  if(Test-Path $LogDosya){
    Yaz Gray "Son log satırları ($LogDosya):"
    Get-Content $LogDosya -Tail 6 -Encoding UTF8 | ForEach-Object { Yaz Gray "  $_" }
  }
}

try {
  if($Kur){ Gorev-Kur }
  elseif($Kaldir){ Gorev-Kaldir }
  elseif($Durum){ Gorev-Durum }
  else { Yaz Yellow "Kullanım: servis.ps1 -Kur | -Kaldir | -Durum" }
} catch {
  Yaz Red ("Hata: " + $_.Exception.Message)
  exit 1
}
