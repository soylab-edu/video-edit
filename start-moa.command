#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
command -v docker >/dev/null || { echo 'Docker Desktop을 설치하고 실행한 뒤 다시 열어 주세요.'; read -r; exit 1; }
docker compose up -d --build --wait --wait-timeout 180
docker compose exec -T editor node scripts/invite.mjs http://localhost:3001
echo '위 최초 설정 링크를 브라우저에서 열어 주세요. 이미 설정했다면 http://localhost:3001 에서 로그인하세요.'
read -r -p '종료하려면 Enter (편집기는 계속 실행됩니다).'
