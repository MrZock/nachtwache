@echo off
chcp 65001 >nul
title Nachtwache LAN-Server
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js wurde nicht gefunden. Bitte von https://nodejs.org installieren.
  pause
  exit /b 1
)
start "" http://localhost:8080
node server.js
pause
