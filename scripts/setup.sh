#!/usr/bin/env bash
set -euo pipefail
MOA_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$MOA_ROOT"
mkdir -p .data/npm-cache .data/uv-cache .data/vendor
command -v ffmpeg >/dev/null
command -v ffprobe >/dev/null
npm ci --cache "$MOA_ROOT/.data/npm-cache"
if [[ ! -x .venv/bin/python ]]; then
  uv venv --cache-dir "$MOA_ROOT/.data/uv-cache" .venv
fi
uv pip sync --cache-dir "$MOA_ROOT/.data/uv-cache" --python .venv/bin/python \
  --index-url https://pypi.org/simple --extra-index-url https://download.pytorch.org/whl/cpu \
  --index-strategy unsafe-best-match requirements-audio.lock
MOA_BANDIT_REV=840d5eb9ede59d64569c423244547e58cb00f647
if [[ ! -d .data/vendor/bandit/.git ]]; then
  git init .data/vendor/bandit
  git -C .data/vendor/bandit remote add origin https://github.com/kwatcharasupat/bandit.git
  git -C .data/vendor/bandit fetch --depth 1 origin "$MOA_BANDIT_REV"
  git -C .data/vendor/bandit checkout --detach "$MOA_BANDIT_REV"
fi
if [[ "$(git -C .data/vendor/bandit rev-parse HEAD)" != "$MOA_BANDIT_REV" ]]; then
  echo 'BandIt source differs from the tested revision; inspect before changing it.' >&2
  exit 1
fi
if [[ ! -f .data/models/bandit/checkpoint.json ]]; then
  .venv/bin/python scripts/setup-bandit.py --file dnr-3s-mus64-l1snr.ckpt --config dnr-3s-mus64-l1snr
fi
.venv/bin/python scripts/bandit-runner.py --check
if [[ ! -f public/demo/assets.json ]]; then
  npm run demo
fi
npm run build
