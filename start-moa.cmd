@echo off
chcp 65001 >nul
cd /d "%~dp0"
docker info >nul 2>&1
if errorlevel 1 (
  echo Docker Desktop을 설치하고 실행한 뒤 다시 열어 주세요.
  pause
  exit /b 1
)
docker compose up -d --build --wait --wait-timeout 180
if errorlevel 1 (
  echo 시작하지 못했습니다. 위 오류를 확인하세요.
  pause
  exit /b 1
)
docker compose exec -T editor node scripts/invite.mjs http://localhost:3001
echo 위 최초 설정 링크를 브라우저에서 열어 주세요.
echo 이미 설정했다면 http://localhost:3001 에서 로그인하세요.
pause
