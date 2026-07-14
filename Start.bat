@echo off
:: ============================================================
:: Start.bat - D&D 5e Studio launcher (VISIBLE debug variant)
:: ------------------------------------------------------------
:: For the normal start WITHOUT a console window: use Start.vbs!
:: This variant shows the server window with logs - useful for
:: troubleshooting. A double-click is enough:
::   1. Requests administrator rights (UAC dialog)
::   2. Checks whether Node.js is installed
::   3. Starts the local server (node server.js)
::   4. Opens the browser at http://localhost:8420
::
:: Leave the server window open - closing it stops the app.
:: ============================================================
setlocal
title D&D 5e Studio

:: -- 1. request administrator rights (self-elevation) --------
:: "net session" fails without admin rights -> then the script
:: relaunches itself via PowerShell with "RunAs" (UAC prompt).
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Fordere Administratorrechte an...
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

:: after elevation, the working directory is C:\Windows\System32
:: -> switch back to the folder of this file.
cd /d "%~dp0"

:: -- 2. check Node.js -----------------------------------------
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo  [FEHLER] Node.js wurde nicht gefunden.
    echo.
    echo  Bitte Node.js ^(Version 18 oder neuer^) installieren:
    echo  https://nodejs.org
    echo.
    pause
    exit /b 1
)

for /f "tokens=*" %%v in ('node --version') do set NODE_VERSION=%%v
echo.
echo  ============================================
echo   D^&D 5e Studio
echo   Node.js %NODE_VERSION% ^| Modus: Administrator
echo  ============================================
echo.
echo  Server startet auf http://localhost:8420
echo  Dieses Fenster offen lassen. Schliessen beendet die App.
echo.

:: -- 3. open the browser with a delay (server needs ~1 second) -
start "" cmd /c "timeout /t 2 /nobreak >nul & start "" http://localhost:8420"

:: -- 4. start the server in the foreground ---------------------
node server.js

:: if the server crashes: keep the window open so the error is readable
echo.
echo  Server wurde beendet.
pause
endlocal
