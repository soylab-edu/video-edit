@echo off
chcp 65001 >nul
cd /d "%~dp0"
node --version >nul 2>&1
if errorlevel 1 (
  echo Node.js 24 이상을 설치한 뒤 다시 열어 주세요.
  pause
  exit /b 1
)
node scripts/start-local.mjs %*
if errorlevel 1 pause
