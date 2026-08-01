@echo off
REM Double-click this to set up .env.local without touching a terminal.
cd /d "%~dp0"
call npm run setup
echo.
pause
