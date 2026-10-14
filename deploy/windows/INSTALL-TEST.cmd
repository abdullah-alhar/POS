@echo off
rem Double-click to install a TEST copy of Marina POS with sample products and test passwords.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile -ExecutionPolicy Bypass -NoExit -File \"%~dp0install.ps1\" -SampleData'"
