@echo off
chcp 65001 >nul
rem Is Takip'i oturum acilinca otomatik baslayacak sekilde kurar (Gorev Zamanlayici, yonetici izni gerekmez) ve tarayiciyi acar.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0servis.ps1" -Kur -TarayiciAc %*
echo.
pause
