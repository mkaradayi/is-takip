@echo off
rem Is Takip - sunucuyu calistirir ve ciktiyi logs\ klasorune yazar (gizli.vbs tarafindan cagrilir).
rem Sunucu cokerse (ya da port doluysa) 10 sn arayla en fazla 3 kez yeniden baslatir, sonra vazgecer.
rem Sayac toplamdir (uzun sure sorunsuz calismak sifirlamaz); yeniden baslatmak icin servis-kur.bat ya da oturumu yeniden acin.
rem Kullanim: calistir.cmd <port> [veri-klasoru]
setlocal
cd /d "%~dp0.."
set "PORT=%~1"
if "%PORT%"=="" set "PORT=3000"
if not "%~2"=="" set "DATA_DIR=%~2"
if not exist logs mkdir logs
set "LOG=logs\server.log"
if not "%PORT%"=="3000" set "LOG=logs\server-%PORT%.log"
set "NODE=node"
where node >nul 2>nul || set "NODE=%ProgramFiles%\nodejs\node.exe"
set "DENEME=0"
set "MAKS=3"

:dongu
rem Log 5 MB'i asinca bir oncekine devret
for %%F in ("%LOG%") do if %%~zF GTR 5242880 move /y "%LOG%" "%LOG%.1" >nul
echo.>>"%LOG%"
echo ===== %DATE% %TIME% baslatiliyor (port %PORT%) =====>>"%LOG%"
"%NODE%" server.js >>"%LOG%" 2>&1
set "RC=%ERRORLEVEL%"
set /a DENEME+=1
if %DENEME% GTR %MAKS% goto vazgec
echo ===== %DATE% %TIME% durdu (kod %RC%), 10 sn sonra yeniden baslatilacak (deneme %DENEME%/%MAKS%) =====>>"%LOG%"
rem Gizli pencerede "timeout" calismaz; bekleme icin ping kullanilir
ping -n 11 127.0.0.1 >nul
goto dongu

:vazgec
echo ===== %DATE% %TIME% durdu (kod %RC%); %MAKS% yeniden denemeden sonra vazgecildi. Yeniden baslatmak icin servis\servis-kur.bat =====>>"%LOG%"
if "%RC%"=="0" set "RC=1"
exit /b %RC%
