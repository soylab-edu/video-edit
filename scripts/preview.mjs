// Opt-in temporary HTTPS access, protected by the app's private workspace login.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { supervise } from "./preview-supervisor.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT || 3002);
const local = `http://127.0.0.1:${port}`;
const session = await (await fetch(local + "/api/auth/session", {
  signal: AbortSignal.timeout(5000),
})).json();
if (!session.enabled)
  throw new Error("Public previews require private workspace authentication.");
const runtime = path.join(root, ".data/preview-runtime");
const state = path.join(root, ".data/preview-state");
await fs.mkdir(runtime, { recursive: true });
await fs.mkdir(state, { recursive: true });
if (process.env.MOA_PREVIEW_CHILD !== "1") {
  const monitor = supervise({
    command: process.execPath,
    args: [...process.execArgv, fileURLToPath(import.meta.url)],
    options: {
      cwd: root,
      env: { ...process.env, MOA_PREVIEW_CHILD: "1" },
      stdio: "inherit",
    },
    onExit: async (outcome) => {
      let previous = {};
      try {
        previous = JSON.parse(
          await fs.readFile(path.join(state, "address.json"), "utf8"),
        );
      } catch {}
      await fs.writeFile(
        path.join(state, "address.json"),
        JSON.stringify({
          ...previous,
          status: "reconnecting",
          disconnectedAt: new Date().toISOString(),
          lastExit: outcome,
        }),
      );
      console.log(
        JSON.stringify({
          event: "preview-reconnecting",
          at: new Date().toISOString(),
          ...outcome,
        }),
      );
    },
  });
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.once(signal, () => {
      console.log(JSON.stringify({ event: "preview-stopped", signal, at: new Date().toISOString() }));
      monitor.stop();
    });
  }
  await monitor.done;
  process.exit(0);
}
const pkg = path.join(runtime, "node_modules/tunnelmole/dist");
try {
  await fs.access(path.join(pkg, "src/index.js"));
} catch {
  const args = [
    "install",
    "--prefix",
    runtime,
    "--cache",
    path.join(root, ".data/npm-cache"),
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "tunnelmole@2.4.0",
    "https-proxy-agent@7.0.6",
  ];
  const child = spawn("npm", args, { stdio: "inherit" });
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  if (code !== 0) throw new Error("Preview dependency installation failed.");
}
// Keep optional helper state inside the workspace and honor the managed HTTPS proxy.
const connectFile = path.join(pkg, "src/websocket/connect.js");
let connect = await fs.readFile(connectFile, "utf8");
if (!connect.includes("import { HttpsProxyAgent }")) {
  connect = connect
    .replace(
      "import config from",
      'import { HttpsProxyAgent } from "https-proxy-agent";\nimport config from',
    )
    .replace(
      "new HostipWebSocket(config.hostip.endpoint)",
      "new HostipWebSocket(config.hostip.endpoint, process.env.HTTPS_PROXY ? { agent: new HttpsProxyAgent(process.env.HTTPS_PROXY) } : {})",
    );
  await fs.writeFile(connectFile, connect);
}
const storageFile = path.join(pkg, "src/node-persist/storage.js");
const storage = (await fs.readFile(storageFile, "utf8")).replace(
  /const dir = .*;/,
  `const dir = ${JSON.stringify(state)};`,
);
await fs.writeFile(storageFile, storage);
process.env.TUNNELMOLE_TELEMETRY = "0";
process.env.TUNNELMOLE_QUIET_MODE = "1";
const { tunnelmole } = await import(
  pathToFileURL(path.join(pkg, "src/index.js")).href
);
const url = await tunnelmole({ port });
await fs.writeFile(
  path.join(state, "address.json"),
  JSON.stringify({
    url,
    status: "connected",
    created: new Date().toISOString(),
  }),
);
console.log("Private editor HTTPS address: " + url);
console.log(
  "For a new workspace, use: MOA_DATA_DIR=.data/live-workspace npm run invite -- " +
    url,
);
