import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";

const require = createRequire(import.meta.url);
export function codexEnvironment(home) {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    CODEX_HOME: home,
    NO_COLOR: "1",
    TERM: "dumb",
    ...Object.fromEntries(
      [
        "HTTPS_PROXY",
        "HTTP_PROXY",
        "NO_PROXY",
        "SSL_CERT_FILE",
        "SSL_CERT_DIR",
        "SystemRoot",
        "WINDIR",
        "USERPROFILE",
        "LOCALAPPDATA",
        "APPDATA",
        "TEMP",
        "TMP",
      ]
        .filter((k) => process.env[k])
        .map((k) => [k, process.env[k]]),
    ),
  };
}
export function codexExecutable() {
  if (process.env.MOA_CODEX_BINARY) return process.env.MOA_CODEX_BINARY;
  const targets = {
    "linux-x64": ["codex-linux-x64", "x86_64-unknown-linux-musl"],
    "linux-arm64": ["codex-linux-arm64", "aarch64-unknown-linux-musl"],
    "darwin-x64": ["codex-darwin-x64", "x86_64-apple-darwin"],
    "darwin-arm64": ["codex-darwin-arm64", "aarch64-apple-darwin"],
    "win32-x64": ["codex-win32-x64", "x86_64-pc-windows-msvc"],
    "win32-arm64": ["codex-win32-arm64", "aarch64-pc-windows-msvc"],
  };
  const target = targets[`${process.platform}-${process.arch}`];
  if (!target)
    throw new Error("이 서버의 Codex 로그인 실행 파일을 설정해 주세요.");
  const root = path.join(
    path.dirname(require.resolve(`@openai/${target[0]}/package.json`)),
    "vendor",
    target[1],
  );
  const executable = process.platform === "win32" ? "codex.exe" : "codex";
  const current = path.join(root, "bin", executable);
  return existsSync(current) ? current : path.join(root, "codex", executable);
}
export function createCodexLogin(userDir) {
  const pending = new Map();
  const home = (owner) => path.join(userDir(owner), "codex");
  async function connected(owner) {
    try {
      const auth = JSON.parse(
        await fs.readFile(path.join(home(owner), "auth.json"), "utf8"),
      );
      return auth.auth_mode === "chatgpt" && !!auth.tokens?.access_token;
    } catch {
      return false;
    }
  }
  async function status(owner) {
    if (await connected(owner)) return { state: "connected" };
    return pending.get(owner)?.view || { state: "idle" };
  }
  async function cancel(owner) {
    const login = pending.get(owner);
    if (login?.child && login.child.exitCode === null && !login.child.killed) {
      const closed = new Promise((resolve) =>
        login.child.once("close", resolve),
      );
      login.child.kill();
      await closed;
    }
    if (login?.timer) clearTimeout(login.timer);
    pending.delete(owner);
  }
  async function disconnect(owner) {
    await cancel(owner);
    await fs.rm(path.join(home(owner), "auth.json"), { force: true });
  }
  async function start(owner) {
    if (await connected(owner)) return { state: "connected" };
    const existing = pending.get(owner);
    if (existing && ["starting", "waiting"].includes(existing.view.state))
      return existing.view;
    await fs.mkdir(home(owner), { recursive: true, mode: 0o700 });
    const child = spawn(
      codexExecutable(),
      ["-c", 'cli_auth_credentials_store="file"', "login", "--device-auth"],
      { env: codexEnvironment(home(owner)), stdio: ["ignore", "pipe", "pipe"] },
    );
    const login = { child, view: { state: "starting" }, timer: null };
    pending.set(owner, login);
    let output = "";
    const parse = (chunk) => {
      // Never write authorization codes or raw CLI output to server logs.
      output = (output + chunk.toString())
        .slice(-12000)
        .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
      const url = output.match(
        /https:\/\/auth\.openai\.com\/codex\/device\b/,
      )?.[0];
      const code = output.match(/\b[A-Z0-9]{4,5}-[A-Z0-9]{4,5}\b/)?.[0];
      if (url && code)
        login.view = {
          state: "waiting",
          url,
          code,
          expires: Date.now() + 15 * 60000,
        };
    };
    child.stdout.on("data", parse);
    child.stderr.on("data", parse);
    child.on("error", () => {
      login.view = {
        state: "failed",
        error: "Codex 로그인 프로그램을 시작하지 못했습니다.",
      };
    });
    child.on("close", async (code) => {
      clearTimeout(login.timer);
      const ok = code === 0 && (await connected(owner));
      const networkFailure =
        /error sending request|connection|certificate|TLS/i.test(output);
      login.view = ok
        ? { state: "connected" }
        : {
            state: "failed",
            error: networkFailure
              ? "OpenAI 인증 서버에 연결하지 못했습니다. 이 서버에서 auth.openai.com HTTPS 접근과 인증서 설정을 확인해야 합니다."
              : "로그인이 완료되지 않았습니다. ChatGPT의 보안 설정에서 Codex 기기 코드 인증을 허용하고 다시 시도하세요.",
          };
      output = "";
    });
    login.timer = setTimeout(() => child.kill(), 16 * 60000);
    login.timer.unref();
    return login.view;
  }
  return { connected, status, start, cancel, disconnect, home };
}
