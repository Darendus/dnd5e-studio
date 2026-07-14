' ============================================================
' Start.vbs - D&D 5e Studio (INVISIBLE start)
' ------------------------------------------------------------
' A double-click is enough. Unlike Start.bat, NO console window
' appears - neither on the desktop nor in the taskbar.
'   1. Checks whether Node.js is installed
'   2. Requests administrator rights (UAC dialog)
'   3. Starts the server completely hidden
'   4. Waits until the server responds, then opens the browser
'
' Stop it: "Quit app" button in the app's settings
'          or double-click Stop.vbs
' Visible variant (logs/debug): Start.bat
' ============================================================
Option Explicit

Dim fso, shell, app, appDir, exitCode, tries
Set fso   = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
Set app   = CreateObject("Shell.Application")

appDir = fso.GetParentFolderName(WScript.ScriptFullName)

' --- 1. check Node.js (hidden window, waits for the result) ---
exitCode = shell.Run("cmd /c where node >nul 2>&1", 0, True)
If exitCode <> 0 Then
    MsgBox "Node.js wurde nicht gefunden." & vbCrLf & vbCrLf & _
           "Bitte Node.js (Version 18 oder neuer) installieren:" & vbCrLf & _
           "https://nodejs.org", vbCritical, "D&D 5e Studio"
    WScript.Quit 1
End If

' --- 2.+3. start the server with admin rights AND hidden ---
' ShellExecute with verb "runas" triggers the UAC prompt;
' window style 0 = completely hidden (no window, no taskbar entry).
' If the user cancels the UAC prompt, the script quits silently.
On Error Resume Next
app.ShellExecute "cmd.exe", "/c cd /d """ & appDir & """ && node server.js", "", "runas", 0
If Err.Number <> 0 Then
    WScript.Quit 0
End If
On Error GoTo 0

' --- 4. wait until the server responds (max. ~15 s), then browser ---
' A hidden PowerShell call tests the port; this avoids an error
' page in case the UAC prompt stayed open longer.
For tries = 1 To 30
    exitCode = shell.Run("powershell -NoProfile -Command " & _
        """try { $c = New-Object Net.Sockets.TcpClient('127.0.0.1', 8420); $c.Close(); exit 0 } catch { exit 1 }""", _
        0, True)
    If exitCode = 0 Then Exit For
    WScript.Sleep 500
Next

shell.Run "http://localhost:8420"
