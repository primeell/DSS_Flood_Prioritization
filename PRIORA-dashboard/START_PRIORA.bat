@echo off
setlocal
cd /d "%~dp0"

where py >nul 2>nul
if %errorlevel%==0 (
  start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process 'http://127.0.0.1:8765/'"
  py -m http.server 8765 --bind 127.0.0.1
  exit /b
)

where python >nul 2>nul
if %errorlevel%==0 (
  start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process 'http://127.0.0.1:8765/'"
  python -m http.server 8765 --bind 127.0.0.1
  exit /b
)

echo Python tidak ditemukan.
echo Instal Python 3 atau unggah folder ini ke hosting statis.
pause
