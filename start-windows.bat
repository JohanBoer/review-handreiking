@echo off
setlocal enabledelayedexpansion
REM Dubbelklikbare starter voor Windows: controleert Node.js, start de server en opent de browser.
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is niet gevonden op dit systeem.
  where winget >nul 2>nul
  if not errorlevel 1 (
    set /p ans=Node.js installeren via winget? ^(j/n^):
    if /i "!ans!"=="j" (
      winget install -e --id OpenJS.NodeJS.LTS
      echo.
      echo Node.js is geinstalleerd. Sluit dit venster en start start-windows.bat opnieuw.
      pause
      exit /b 0
    )
  )
  echo Download Node.js handmatig ^(LTS-versie^) via https://nodejs.org en start dit script daarna opnieuw.
  start https://nodejs.org/
  pause
  exit /b 1
)

echo.
echo Review-tool wordt gestart...
echo (Laat dit venster open zolang je de tool gebruikt. Sluiten of Ctrl+C stopt de server.)
echo.

start "" /min cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:3000/setup"
node server.js
if errorlevel 1 (
  echo.
  echo De server is gestopt met een fout ^(zie hierboven^). Controleer of poort 3000 al in gebruik is.
)


pause
