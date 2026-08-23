@echo off
title F1 Dashboard -- PUBLIC SERVER (production)
color 0C
echo.
echo   ============================================================
echo    F1 DASHBOARD  --  GOING LIVE FOR FRIENDS  (production mode)
echo   ============================================================
echo.

echo   [1/4] Starting the backend...
start "F1 Backend" /min cmd /k "cd /d C:\Projects\.f1link\f1-dashboard\backend && python -m uvicorn main:app --port 8000"

echo   [2/4] Building the website (~10s; skipping this would serve STALE code)...
cd /d C:\Projects\.f1link\f1-dashboard\frontend
REM Always rebuild. This used to be `if not exist ".next\BUILD_ID"`, which meant
REM the first run baked a build and every later run reused it -- so code changes
REM silently never reached the public link.
call npm run build

echo   [3/4] Starting the website...
start "F1 Website" /min cmd /k "cd /d C:\Projects\.f1link\f1-dashboard\frontend && npx next start -p 3000"

echo   Waiting ~10s for warm-up...
timeout /t 10 /nobreak >nul

echo.
echo   ============================================================
echo    [4/4] YOUR PUBLIC LINK APPEARS BELOW
echo    (https://....trycloudflare.com -- copy it, send to friends)
echo.
echo    KEEP THE WINDOWS OPEN. Closing this one kills the link.
echo    NOTE: the link is NEW every time you run this.
echo   ============================================================
echo.

"C:\Projects\.claude\cloudflared.exe" tunnel --url http://localhost:3000

echo.
echo   Tunnel closed -- the public link is now offline.
pause
