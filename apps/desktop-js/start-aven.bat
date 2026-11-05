@echo off
cd /d "%~dp0"
echo Starte Aven ...
call npm start
if errorlevel 1 pause
