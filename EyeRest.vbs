' EyeRest launcher: start the app with no console window.
' Just double-click this file (or make a desktop shortcut to it).
Option Explicit
Dim fso, sh, base, cmd
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh  = CreateObject("WScript.Shell")
base = fso.GetParentFolderName(WScript.ScriptFullName)
cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & base & "\scripts\launch.ps1"" -Quiet"
sh.Run cmd, 0, False