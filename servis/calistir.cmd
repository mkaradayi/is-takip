@echo off
rem Is Takip - sunucuyu calistirir ve ciktiyi logs\ klasorune yazar (gizli.vbs tarafindan cagrilir).
rem Sunucu cokerse 10 sn sonra yeniden baslatir (port doluysa da bosalana kadar dener).
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

:dongu
rem Log 5 MB'i asinca bir oncekine devret
for %%F in ("%LOG%") do if %%~zF GTR 5242880 move /y "%LOG%" "%LOG%.1" >nul
echo.>>"%LOG%"
echo ===== %DATE% %TIME% baslatiliyor (port %PORT%) =====>>"%LOG%"
"%NODE%" server.js >>"%LOG%" 2>&1
set "RC=%ERRORLEVEL%"
echo ===== %DATE% %TIME% durdu (kod %RC%), 10 sn sonra yeniden baslatilacak =====>>"%LOG%"
rem Gizli pencerede "timeout" calismaz; bekleme icin ping kullanilir
ping -n 11 127.0.0.1 >nul
goto dongu
