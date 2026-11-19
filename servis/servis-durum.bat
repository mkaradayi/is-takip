@echo off
chcp 65001 >nul
rem Otomatik baslatma gorevinin ve sunucunun durumunu gosterir.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0servis.ps1" -Durum %*
echo.
pause
