@echo off
:: ============================================================
:: Start.bat - D&D 5e Studio Launcher (SICHTBARE Debug-Variante)
:: ------------------------------------------------------------
:: Fuer den normalen Start OHNE Konsolenfenster: Start.vbs nutzen!
:: Diese Variante zeigt das Serverfenster mit Logs an - nuetzlich
:: zur Fehlersuche. Doppelklick genuegt:
::   1. Fordert Administratorrechte an (UAC-Dialog)
::   2. Prueft, ob Node.js installiert ist
::   3. Startet den lokalen Server (node server.js)
::   4. Oeffnet den Browser auf http://localhost:8420
::
:: Das Serverfenster offen lassen - Schliessen beendet die App.
:: ============================================================
setlocal
title D&D 5e Studio

:: -- 1. Administratorrechte anfordern (Selbst-Elevation) -----
:: "net session" schlaegt ohne Adminrechte fehl -> dann startet
:: sich das Skript per PowerShell mit "RunAs" (UAC-Abfrage) neu.
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Fordere Administratorrechte an...
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

:: Nach der Elevation ist das Arbeitsverzeichnis C:\Windows\System32
:: -> zurueck in den Ordner dieser Datei wechseln.
cd /d "%~dp0"

:: -- 2. Node.js pruefen --------------------------------------
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

:: -- 3. Browser verzoegert oeffnen (Server braucht ~1 Sekunde) -
start "" cmd /c "timeout /t 2 /nobreak >nul & start "" http://localhost:8420"

:: -- 4. Server im Vordergrund starten ------------------------
node server.js

:: Falls der Server abstuerzt: Fenster offen halten, Fehler lesbar
echo.
echo  Server wurde beendet.
pause
endlocal
