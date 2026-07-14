' ============================================================
' Stop.vbs - stop D&D 5e Studio (hidden)
' ------------------------------------------------------------
' Stops the invisibly running server. Since the server runs with
' administrator rights, stopping it also requires elevation via
' UAC. Alternative: "Quit app" button in the app's settings
' (without a UAC prompt).
' ============================================================
Option Explicit
On Error Resume Next

Dim app
Set app = CreateObject("Shell.Application")

' Stops all node processes whose command line contains server.js.
' Window style 0 = hidden, verb "runas" = with admin rights.
app.ShellExecute "powershell.exe", _
    "-NoProfile -Command ""Get-CimInstance Win32_Process | " & _
    "Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*server.js*' } | " & _
    "ForEach-Object { Stop-Process -Id $_.ProcessId -Force }""", _
    "", "runas", 0

If Err.Number = 0 Then
    WScript.Sleep 1200
    MsgBox "D&D 5e Studio wurde beendet.", vbInformation, "D&D 5e Studio"
End If
