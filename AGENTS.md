# Moa Studio working context

## User goal and current direction

- Build an intuitive Korean video editor. The final product is a Windows program that people install and run on their own PCs. The user does **not** want to operate a hosted multi-user service.
- Keep the React editing UI with a local editing engine. FFmpeg and BandIt DnR should run on the user's PC. Each user authorizes their own Codex/ChatGPT and generation plugins.
- Docker is a proposed development convenience. Final users should not need to install Docker. Windows installer packaging is **not implemented yet**.
- The source handoff branch is `codex/moa-studio-local`. Read `README.md`, `docs/local-development.md`, `docs/plugin-gateway.md`, and `docs/validation.md` before continuing.

## Local continuation

1. Confirm the actual executor is the user's Windows PC. Opening a cloud conversation in Codex desktop does not itself move execution to the PC.
2. Inspect the existing checkout and installed tools; preserve all user changes. Verify Windows/Docker startup instead of claiming the existing launcher works based on cloud tests. Dockerfiles and launchers remain untested on Windows.
3. Validate upload, timeline editing, project persistence, FFmpeg export, BandIt, TTS, and user-authorized Codex connections. Run appropriate checks after changes; `npm run build` and `npm test` passed in the cloud (18 tests).
4. Implement Windows packaging after local startup works: bundled runtime/dependencies, loopback-only backend, child-process lifecycle, single-instance behavior, writable user data directory, Unicode paths, model installation, and installation/update checks. Current Python/font paths assume Linux and need container or platform handling.
5. Native plugin reference delivery currently needs a public HTTPS transfer path. Design an approved local-file upload path for the distributable app; do not assume providers can fetch localhost files.

## Preserve data and approval boundaries

- `.data/live-workspace` contains the real cloud account, project/media, sessions and Codex authentication. Never delete/reset it, include it in Git, or put its credentials in distributions. Source checkout is separate from migrating project/media.
- `tests/public-browser.mjs` initializes a disposable test workspace. Never run it against a user's workspace.
- Paid generation and uploads require the exact server-held proposal approval and explicit material/cost acknowledgement. Never generate merely to test a connection. Planner/executor isolation must remain intact.
- Only Runway, Magnific, HeyGen and PixVerse should appear as external editing providers. Exclude Higgsfield. Built-in FFmpeg/BandIt and Microsoft TTS remain available separately.
- Real Magnific read calls and approval-report preparation have been tested. Actual paid generation has not. Runway/HeyGen last required reauthentication; PixVerse tools were absent. Refresh real connection status instead of hardcoding these observations.
- Director presets are researched editing heuristics, not claims of training a model or mastering a director's style.

## Temporary cloud preview

Preserve the existing cloud workspace while local development starts. Preview startup/recovery is documented in `docs/access.md`; never expose an unauthenticated development server. Free Tunnelmole addresses are temporary and can change. Background supervision does not guarantee uptime or a fixed hostname. This preview is not the final product deployment.
