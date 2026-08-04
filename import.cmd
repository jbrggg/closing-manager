@echo off
REM Double-click this to read the real email sitting in the inbox folder.
REM
REM Deliberately mirrors setup.cmd: same shape, same pause at the end, so the
REM window stays open long enough to read what happened. A .cmd that closes
REM itself is indistinguishable from one that never ran.
cd /d "%~dp0"

if not exist "inbox\*.eml" if not exist "inbox\*.mbox" (
  echo.
  echo   There is no exported email in the inbox folder yet.
  echo.
  echo   Open  inbox\README.md  for how to save messages out of Outlook.
  echo   The short version: open the message at outlook.office.com, click
  echo   the three dots, choose Download, and drag the file into inbox.
  echo.
  pause
  exit /b 2
)

call npm run import
echo.
echo   ------------------------------------------------------------
echo   The lines above only prove the mail was READ.
echo   What matters is what it CONCLUDED - that is the review queue.
echo.
echo   Leave this window open, then double-click  start-app.cmd
echo   and open  http://localhost:3000/review  in your browser.
echo   ------------------------------------------------------------
echo.
pause
