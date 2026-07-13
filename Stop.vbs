' ============================================================
' Stop.vbs - D&D 5e Studio beenden (versteckt)
' ------------------------------------------------------------
' Beendet den unsichtbar laufenden Server. Da der Server mit
' Administratorrechten laeuft, wird auch das Beenden per UAC
' erhoeht ausgefuehrt. Alternativ: Knopf "App beenden" in den
' Einstellungen der App (ohne UAC-Abfrage).
' ============================================================
Option Explicit
On Error Resume Next

Dim app
Set app = CreateObject("Shell.Application")

' Beendet alle node-Prozesse, deren Kommandozeile server.js enthaelt.
' Fensterstil 0 = versteckt, Verb "runas" = mit Adminrechten.
app.ShellExecute "powershell.exe", _
    "-NoProfile -Command ""Get-CimInstance Win32_Process | " & _
    "Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*server.js*' } | " & _
    "ForEach-Object { Stop-Process -Id $_.ProcessId -Force }""", _
    "", "runas", 0

If Err.Number = 0 Then
    WScript.Sleep 1200
    MsgBox "D&D 5e Studio wurde beendet.", vbInformation, "D&D 5e Studio"
End If
