@echo off
chcp 65001 >nul
rem Otomatik baslatma gorevini ve calisan sunucuyu kaldirir.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0servis.ps1" -Kaldir %*
echo.
pause
