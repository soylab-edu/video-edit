# syntax=docker/dockerfile:1
FROM node:24.19.0-bookworm-slim AS frontend
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
COPY public ./public
RUN npm run build && npm prune --omit=dev

FROM python:3.12-slim-bookworm AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg fonts-noto-cjk libsndfile1 git tini ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=frontend /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
COPY requirements-audio.lock ./
RUN python -m pip install --no-cache-dir --extra-index-url https://download.pytorch.org/whl/cpu -r requirements-audio.lock
COPY --from=frontend /app/node_modules ./node_modules
COPY --from=frontend /app/dist ./dist
COPY --from=frontend /app/public ./public
COPY package.json ./
COPY server ./server
COPY scripts ./scripts
RUN git init .data/vendor/bandit && git -C .data/vendor/bandit remote add origin https://github.com/kwatcharasupat/bandit.git && git -C .data/vendor/bandit fetch --depth 1 origin 840d5eb9ede59d64569c423244547e58cb00f647 && git -C .data/vendor/bandit checkout --detach FETCH_HEAD && python scripts/setup-bandit.py --file dnr-3s-mus64-l1snr.ckpt --config dnr-3s-mus64-l1snr && python scripts/bandit-runner.py --check && mkdir -p /opt/moa-models && mv .data/vendor .data/models /opt/moa-models/ && useradd --uid 10001 --create-home moa && chown -R moa:moa /app/.data
ENV NODE_ENV=production MOA_AUTH_MODE=required MOA_PYTHON=/usr/local/bin/python PORT=3001 MOA_MAX_JOBS=1
USER moa
EXPOSE 3001
HEALTHCHECK --interval=20s --timeout=5s --start-period=90s CMD node -e "fetch('http://127.0.0.1:3001/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--", "bash", "scripts/container-start.sh"]
