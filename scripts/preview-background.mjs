// Cloud-only launcher: keep tunnel supervision independent of the command's
// stdout/terminal lifetime. This does not keep a stopped cloud machine alive.
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const state = path.join(root, ".data/preview-state");
const script = path.join(root, "scripts/preview.mjs");
const pidFile = path.join(state, "monitor.json");
const port = Number(process.env.PORT || 3002);
if (process.platform !== "linux") throw new Error("Use the foreground preview on this platform.");
const session = await (
  await fetch(`http://127.0.0.1:${port}/api/auth/session`, {
    signal: AbortSignal.timeout(5000),
  })
).json();
if (!session.enabled) throw new Error("The private production workspace must be running first.");
await fs.mkdir(state, { recursive: true, mode: 0o700 });

let existing;
try {
  existing = JSON.parse(await fs.readFile(pidFile, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
let running = false;
if (Number.isSafeInteger(existing?.pid) && existing.port === port) {
  const args = await fs.readFile(`/proc/${existing.pid}/cmdline`, "utf8").catch(() => "");
  running = args.split("\0").includes(script);
}
if (!running) {
  const logFile = path.join(state, "monitor.log");
  const stat = await fs.stat(logFile).catch(() => null);
  if (stat?.size > 2 * 1024 * 1024) await fs.rename(logFile, logFile + ".previous");
  const log = await fs.open(logFile, "a", 0o600);
  try {
    const child = spawn(process.execPath, ["--use-env-proxy", "--use-system-ca", script], {
      cwd: root,
      env: { ...process.env, PORT: String(port), MOA_PREVIEW_CHILD: "0" },
      detached: true,
      stdio: ["ignore", log.fd, log.fd],
    });
    await new Promise((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    child.unref();
    existing = { pid: child.pid, port, started: new Date().toISOString() };
    await fs.writeFile(pidFile, JSON.stringify(existing), { mode: 0o600 });
  } finally {
    await log.close();
  }
}
console.log(`Preview monitor ${running ? "already running" : "started"}: ${existing.pid}`);
console.log("Logs: .data/preview-state/monitor.log");
console.log("Read .data/preview-state/address.json and verify its HTTPS health before sharing the URL.");
