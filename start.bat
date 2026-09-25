@echo off
rem ChainLock + SENTINEL - double-click to install everything and run.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*
if errorlevel 1 pause
