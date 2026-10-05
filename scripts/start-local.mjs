import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createServer } from "vite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
const apiPort = Number(process.env.PORT || 3001);
const webPort = 5173;
const url = `http://127.0.0.1:${webPort}`;
// Never replace another running editor or its workspace.
try {
  const existing = await fetch(`${url}/api/health`, {
    signal: AbortSignal.timeout(1500),
  });
  if (existing.ok && (await existing.json()).service === "moa-studio") {
    console.log(`Moa Studio is already running: ${url}`);
    if (!process.argv.includes("--no-open")) openBrowser();
    process.exit(0);
  }
} catch {}

const api = spawn(process.execPath, ["--use-env-proxy", "server/index.mjs"], {
  cwd: root,
  env: {
    ...process.env,
    NODE_ENV: "development",
    MOA_HOST: "127.0.0.1",
    MOA_DATA_DIR:
      process.env.MOA_DATA_DIR || path.join(root, ".data/windows-workspace"),
  },
  windowsHide: true,
  stdio: "inherit",
});
let web;
let stopping = false;
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  await web?.close();
  if (api.exitCode === null) {
    const closed = new Promise((resolve) => api.once("close", resolve));
    api.kill();
    await closed;
  }
  process.exit(code);
}
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
api.on("error", (error) => {
  console.error(error.message);
  void stop(1);
});
api.on("exit", (code) => {
  if (!stopping) void stop(code || 1);
});
function openBrowser() {
  if (process.platform === "win32") {
    const browser = spawn("explorer.exe", [url], {
      detached: true,
      windowsHide: true,
      stdio: "ignore",
    });
    browser.on("error", (error) =>
      console.error(`Open ${url}: ${error.message}`),
    );
    browser.unref();
  }
}
try {
  let ready = false;
  for (let i = 0; i < 300 && api.exitCode === null; i++) {
    try {
      const health = await fetch(`http://127.0.0.1:${apiPort}/api/health`, {
        signal: AbortSignal.timeout(1000),
      });
      if (health.ok && (await health.json()).service === "moa-studio") {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!ready)
    throw new Error(
      "Local API did not become ready. Check Node, Python and FFmpeg.",
    );
  web = await createServer({
    root,
    server: {
      host: "127.0.0.1",
      port: webPort,
      strictPort: true,
      proxy: {
        "/api": `http://127.0.0.1:${apiPort}`,
        "/media": `http://127.0.0.1:${apiPort}`,
      },
    },
  });
  await web.listen();
  console.log(`Moa Studio: ${url}\nPress Ctrl+C to stop the editor and API.`);
  if (!process.argv.includes("--no-open")) openBrowser();
} catch (error) {
  console.error(error.message);
  await stop(1);
}
