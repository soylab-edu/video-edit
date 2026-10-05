import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

// The installed PixVerse plugin is a CLI, not a codex_apps MCP server.
// Query the current Windows user's native login without copying its credentials.
export async function localPixverseStatus({
  root = process.env.MOA_PIXVERSE_PLUGIN_ROOT,
  python = process.env.MOA_PYTHON || path.resolve(".venv/Scripts/python.exe"),
} = {}) {
  if (process.platform !== "win32" && !root) return null;
  if (!root) {
    const base = path.join(
      process.env.USERPROFILE || "",
      ".codex/plugins/cache/openai-curated-remote/pixverse",
    );
    let versions;
    try {
      versions = await fs.readdir(base);
    } catch {
      return null;
    }
    for (const version of versions.sort((a, b) =>
      b.localeCompare(a, undefined, { numeric: true }),
    )) {
      try {
        const manifest = JSON.parse(
          await fs.readFile(
            path.join(base, version, ".codex-plugin/plugin.json"),
            "utf8",
          ),
        );
        if (
          manifest.name === "pixverse" &&
          manifest.homepage === "https://app.pixverse.ai"
        ) {
          root = path.join(base, version);
          break;
        }
      } catch {}
    }
  }
  if (!root) return null;
  const status = {
    installed: true,
    authentication: "unverified",
    source: "local-cli",
    executionReady: false,
  };
  const bash = path.join(
    process.env.ProgramFiles || "C:/Program Files",
    "Git/bin/bash.exe",
  );
  let output = "";
  const result = await new Promise((resolve) => {
    const child = spawn(
      bash,
      [
        path.join(root, "scripts/pvx").replaceAll("\\", "/"),
        "pixverse",
        "auth",
        "status",
        "--json",
      ],
      {
        env: { ...process.env, PYTHON_BIN: python.replaceAll("\\", "/") },
        windowsHide: true,
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    const timer = setTimeout(() => {
      child.kill();
      resolve(false);
    }, 30000);
    child.stdout.on("data", (chunk) => {
      if (output.length < 64000) output += chunk;
    });
    child.once("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
  });
  if (result) {
    try {
      status.authentication =
        JSON.parse(output).authenticated === true
          ? "verified"
          : "reauthentication";
    } catch {}
  }
  return status;
}
