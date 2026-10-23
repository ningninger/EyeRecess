@echo off
rem ASCII only + CRLF. Do not add Chinese text to this file.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\diagnose.ps1"
pause
