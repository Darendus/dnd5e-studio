' ============================================================
' Start.vbs - D&D 5e Studio (UNSICHTBARER Start)
' ------------------------------------------------------------
' Doppelklick genuegt. Im Gegensatz zu Start.bat erscheint KEIN
' Konsolenfenster - weder auf dem Desktop noch in der Taskleiste.
'   1. Prueft, ob Node.js installiert ist
'   2. Fordert Administratorrechte an (UAC-Dialog)
'   3. Startet den Server komplett versteckt
'   4. Wartet, bis der Server antwortet, und oeffnet den Browser
'
' Beenden: Knopf "App beenden" in den Einstellungen der App
'          oder Doppelklick auf Stop.vbs
' Sichtbare Variante (Logs/Debug): Start.bat
' ============================================================
Option Explicit

Dim fso, shell, app, appDir, exitCode, tries
Set fso   = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
Set app   = CreateObject("Shell.Application")

appDir = fso.GetParentFolderName(WScript.ScriptFullName)

' --- 1. Node.js pruefen (verstecktes Fenster, wartet auf Ergebnis) ---
exitCode = shell.Run("cmd /c where node >nul 2>&1", 0, True)
If exitCode <> 0 Then
    MsgBox "Node.js wurde nicht gefunden." & vbCrLf & vbCrLf & _
           "Bitte Node.js (Version 18 oder neuer) installieren:" & vbCrLf & _
           "https://nodejs.org", vbCritical, "D&D 5e Studio"
    WScript.Quit 1
End If

' --- 2.+3. Server mit Adminrechten UND unsichtbar starten ---
' ShellExecute mit Verb "runas" loest die UAC-Abfrage aus;
' Fensterstil 0 = komplett versteckt (kein Fenster, kein Taskleisten-Eintrag).
' Bricht der Nutzer die UAC-Abfrage ab, beendet sich das Skript still.
On Error Resume Next
app.ShellExecute "cmd.exe", "/c cd /d """ & appDir & """ && node server.js", "", "runas", 0
If Err.Number <> 0 Then
    WScript.Quit 0
End If
On Error GoTo 0

' --- 4. Warten bis der Server antwortet (max. ~15 s), dann Browser ---
' Ein versteckter PowerShell-Aufruf testet den Port; das vermeidet
' eine Fehlerseite, falls die UAC-Abfrage laenger offen war.
For tries = 1 To 30
    exitCode = shell.Run("powershell -NoProfile -Command " & _
        """try { $c = New-Object Net.Sockets.TcpClient('127.0.0.1', 8420); $c.Close(); exit 0 } catch { exit 1 }""", _
        0, True)
    If exitCode = 0 Then Exit For
    WScript.Sleep 500
Next

shell.Run "http://localhost:8420"
