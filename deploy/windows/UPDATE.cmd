@echo off
rem Double-click to update Marina POS to this version. Your data is backed up first. Asks for administrator rights.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile -ExecutionPolicy Bypass -NoExit -File \"%~dp0update.ps1\"'"
