import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { z } from "zod";
import { codexEnvironment, codexExecutable } from "./codex-login.mjs";

const appSchema = z.object({
  id: z.string().min(1).max(300),
  name: z.string().min(1).max(300),
  description: z.string().max(6000).nullable().optional(),
  isAccessible: z.boolean().default(false),
  isEnabled: z.boolean().default(true),
  installUrl: z.string().nullable().optional(),
});
const pageSchema = z.object({
  data: z.array(appSchema).max(2000),
  nextCursor: z.string().nullable().optional(),
});

// Official app/list is a read-only inventory operation. No thread, inference,
// tool call, marketplace installation, or third-party generation is started.
export async function listCodexApps({
  home,
  cwd,
  binary = codexExecutable(),
  timeout = 60000,
}) {
  const child = spawn(
    binary,
    [
      "-c",
      'cli_auth_credentials_store="file"',
      "--enable",
      "apps",
      "app-server",
    ],
    { cwd, env: codexEnvironment(home), stdio: ["pipe", "pipe", "pipe"] },
  );
  const closed = new Promise((resolve) => child.once("close", resolve));
  const pending = new Map();
  let id = 0,
    failure = null,
    responseBytes = 0;
  const fail = () => {
    failure = new Error(
      "Codex 앱 목록을 가져오지 못했습니다. 로그인 상태와 서버 연결을 확인한 후 다시 조회하세요.",
    );
    for (const request of pending.values()) request.reject(failure);
    pending.clear();
  };
  child.on("error", fail);
  child.on("close", () => {
    if (pending.size) fail();
  });
  child.stdin.on("error", fail);
  // CLI diagnostics can contain account details. Do not return them or log them.
  child.stderr.resume();
  const lines = createInterface({ input: child.stdout });
  child.stdout.on("data", (bytes) => {
    responseBytes += bytes.length;
    if (responseBytes > 16 * 1024 * 1024) {
      fail();
      child.kill();
    }
  });
  lines.on("line", (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message.method && message.id !== undefined) {
      child.stdin.write(
        JSON.stringify({
          id: message.id,
          error: {
            code: -32601,
            message:
              "App inventory client does not execute tools or grant approvals.",
          },
        }) + "\n",
      );
      return;
    }
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error)
      request.reject(
        new Error(
          "Codex에서 앱 목록 조회를 거절했습니다. 로그인 상태를 확인해 주세요.",
        ),
      );
    else request.resolve(message.result);
  });
  const timer = setTimeout(() => {
    fail();
    child.kill();
  }, timeout);
  function rpc(method, params) {
    if (failure) return Promise.reject(failure);
    return new Promise((resolve, reject) => {
      const next = ++id;
      pending.set(next, { resolve, reject });
      child.stdin.write(JSON.stringify({ id: next, method, params }) + "\n");
    });
  }
  try {
    await rpc("initialize", {
      clientInfo: { name: "moa_studio", title: "Moa Studio", version: "0.1.0" },
      capabilities: { experimentalApi: true },
    });
    child.stdin.write(
      JSON.stringify({ method: "initialized", params: {} }) + "\n",
    );
    const apps = new Map(),
      cursors = new Set();
    let cursor = null;
    for (let page = 0; page < 30; page++) {
      const result = pageSchema.parse(
        await rpc("app/list", { limit: 100, cursor, forceRefetch: page === 0 }),
      );
      for (const app of result.data) {
        if (!app.isAccessible) continue;
        let installUrl = null;
        try {
          const url = new URL(app.installUrl);
          if (url.protocol === "https:" && url.hostname === "chatgpt.com")
            installUrl = url.href;
        } catch {}
        apps.set(app.id, {
          id: app.id,
          name: app.name,
          description: app.description || "",
          enabled: app.isEnabled,
          installUrl,
          source: "codex-account",
          executionReady: false,
        });
      }
      if (!result.nextCursor)
        return [...apps.values()].sort((a, b) => a.name.localeCompare(b.name));
      if (cursors.has(result.nextCursor))
        throw new Error(
          "앱 목록 페이지 조회가 반복되었습니다. 잠시 후 다시 시도해 주세요.",
        );
      cursors.add(result.nextCursor);
      cursor = result.nextCursor;
    }
    throw new Error(
      "앱 목록이 조회 한도를 초과했습니다. 목록을 확인하지 못했습니다.",
    );
  } finally {
    clearTimeout(timer);
    lines.close();
    child.kill();
    const killTimer = setTimeout(() => child.kill("SIGKILL"), 2000);
    await closed;
    clearTimeout(killTimer);
  }
}

export function createAppDiscovery({
  connected,
  home,
  userDir,
  list = listCodexApps,
}) {
  const cache = new Map(),
    inFlight = new Map();
  const empty = () => ({ state: "not-connected", apps: [], checkedAt: null });
  async function get(owner, force = false) {
    if (!(await connected(owner))) {
      cache.delete(owner);
      return empty();
    }
    const old = cache.get(owner);
    if (inFlight.has(owner))
      return old || { state: "checking", apps: [], checkedAt: null };
    if (!force && old && Date.now() - old.updatedAt < 5 * 60000) return old;
    const state = {
      state: "checking",
      apps: [],
      checkedAt: null,
      updatedAt: Date.now(),
    };
    cache.set(owner, state);
    const task = Promise.resolve()
      .then(() => list({ home: home(owner), cwd: userDir(owner) }))
      .then(async (apps) => {
        if (!(await connected(owner)) || cache.get(owner) !== state) return;
        cache.set(owner, {
          state: "ready",
          apps,
          checkedAt: new Date().toISOString(),
          updatedAt: Date.now(),
        });
      })
      .catch(() => {
        if (cache.get(owner) === state)
          cache.set(owner, {
            state: "error",
            apps: [],
            checkedAt: null,
            updatedAt: Date.now(),
            error:
              "계정 앱을 조회하지 못했습니다. 잠시 후 다시 조회하거나 Codex 로그인을 확인하세요.",
          });
      })
      .finally(() => {
        if (inFlight.get(owner) === task) inFlight.delete(owner);
      });
    inFlight.set(owner, task);
    return state;
  }
  return { get, clear: (owner) => cache.delete(owner) };
}
