#!/usr/bin/env bash
set -euo pipefail
cd /app
mkdir -p .data
for MOA_MODEL_PART in vendor models; do
  if [[ ! -e ".data/$MOA_MODEL_PART" ]]; then
    ln -s "/opt/moa-models/$MOA_MODEL_PART" ".data/$MOA_MODEL_PART"
  fi
done
exec node --use-env-proxy server/index.mjs
