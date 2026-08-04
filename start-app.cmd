@echo off
REM Double-click this to start the app and open it in your browser.
REM
REM Closing this window stops the app. That is normal - it is not a program
REM that runs in the background, it is a program that runs in this window.
cd /d "%~dp0"

echo.
echo   Starting the app. This takes a few seconds the first time.
echo   Your browser will open at http://localhost:3000
echo.
echo   LEAVE THIS WINDOW OPEN while you are using the app.
echo   Close it (or press Ctrl+C) when you are finished.
echo.

REM Give the server a moment to bind the port before the browser asks for it,
REM otherwise the first page load races the startup and shows a refused
REM connection that looks like a failure.
start "" /b cmd /c "timeout /t 6 /nobreak >nul && start http://localhost:3000/review"

call npm run dev
echo.
pause
