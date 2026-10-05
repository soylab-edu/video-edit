# Moa Studio working context

## User goal and current direction

- Build an intuitive Korean video editor. The final product is a Windows program that people install and run on their own PCs. The user does **not** want to operate a hosted multi-user service.
- Keep the React editing UI with a local editing engine. FFmpeg and BandIt DnR should run on the user's PC. Each user authorizes their own Codex/ChatGPT and generation plugins.
- Docker is a proposed development convenience. Final users should not need to install Docker. Windows installer packaging is **not implemented yet**.
- The source handoff branch is `codex/moa-studio-local`. Read `README.md`, `docs/local-development.md`, `docs/plugin-gateway.md`, and `docs/validation.md` before continuing.

## Local continuation

1. Confirm the actual executor is the user's Windows PC. Opening a cloud conversation in Codex desktop does not itself move execution to the PC.
2. Inspect the existing checkout and installed tools; preserve all user changes. Native Windows startup is now validated with `scripts/setup-windows.ps1` and `start-moa.cmd` / `npm run dev:local`; see `docs/windows-development.md`. Dockerfiles and Docker startup remain untested on Windows.
3. Validate upload, timeline editing, project persistence, FFmpeg export, BandIt, TTS, and user-authorized Codex connections. Native Windows checks now pass: `npm run build`, `npm test` (30 tests), `npm run test:windows`, and explicit local TTS/BandIt verification. Use disposable workspaces for tests; do not repeat paid generation for regression checks.
4. Windows installer packaging remains a separate follow-up: bundled runtime/dependencies, robust child-process lifecycle and single-instance behavior, writable user data directory, Unicode paths, model installation, and installation/update checks. Native development now selects Windows Python/fonts, binds loopback, uses `.data/windows-workspace`, and validates Unicode/space/apostrophe paths. The development launcher is not a distributable installer.
5. Runway has a server-owned, separately approved local-reference upload adapter and a last-frame continuation selector. Approved real attempts established two failures: metadata-only init is rejected, and raw `mcpServer/tool/call` does not rewrite a local-path string to an uploaded file object. `server/codex-file-upload.mjs` now mirrors official Codex 0.160.0's create/PUT/finalize file transport using only the editor owner's login, then passes the actual file object to Runway. It accepts direct `upload_complete` responses (or multipart PUT/complete if returned). On 2026-10-05 the user's explicitly authorized H3 continuation succeeded: selected last-frame upload once, H3 generation once, real result import, 5-second timeline trim, saved project reload, and a downloaded 27-second H.264/AAC export verified by FFprobe/full decode. The provider returned 1344×768 and 5.166667 seconds for the requested 720p/5-second job; the editor trims to exactly 5 seconds. All 30 tests pass. Evidence is in `docs/windows-development.md` and ignored `test-results/runway-h3-*` artifacts. Do not rerun paid generation to repeat verification. Other providers still need a transfer path. Never assume providers can fetch localhost files.

## Preserve data and approval boundaries

- `.data/live-workspace` contains the real cloud account, project/media, sessions and Codex authentication. Never delete/reset it, include it in Git, or put its credentials in distributions. Source checkout is separate from migrating project/media.
- `tests/public-browser.mjs` initializes a disposable test workspace. Never run it against a user's workspace.
- Paid generation and uploads require the exact server-held proposal approval and explicit material/cost acknowledgement. Never generate merely to test a connection. Planner/executor isolation must remain intact.
- Keep approval UI brief: one-line work description, provider credit estimate (or unknown), and a single explicit approval button. Full arguments/material preview belong in collapsed details. Expired untouched proposals can be renewed without re-planning or provider calls; renewal is not approval and old report IDs stay invalid.
- Only Runway, Magnific, HeyGen and PixVerse should appear as external editing providers. Exclude Higgsfield. Built-in FFmpeg/BandIt and Microsoft TTS remain available separately.
- Real Magnific read calls and approval-report preparation have been tested; Magnific paid generation has not. Runway H3 generation/import/export succeeded after reauthentication and file transport fixes. HeyGen last required reauthentication. Refresh real connection status instead of hardcoding these observations.
- Windows follow-up: user-approved Codex login survives restart; Runway reauthentication and read-only account/model lookup succeeded. PixVerse is installed and authenticated as a native CLI plugin, not a `codex_apps` MCP tool. The UI now discovers its local authentication but its generation executor adapter is still unimplemented. Do not claim CLI installation means generation works in Moa.
- Director presets are researched editing heuristics, not claims of training a model or mastering a director's style.

## Temporary cloud preview

Preserve the existing cloud workspace while local development starts. Preview startup/recovery is documented in `docs/access.md`; never expose an unauthenticated development server. Free Tunnelmole addresses are temporary and can change. Background supervision does not guarantee uptime or a fixed hostname. This preview is not the final product deployment.
