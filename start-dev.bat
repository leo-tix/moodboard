@echo off
title Moodboard Dev Server
cd /d "%~dp0apps\web"
echo.
echo  Moodboard - Serveur de developpement
echo  http://localhost:3000
echo.
call pnpm dev
pause
