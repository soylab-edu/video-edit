import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { codexEnvironment, codexExecutable } from "./codex-login.mjs";

export class CodexRpc {
  constructor({
    home,
    cwd,
    binary = codexExecutable(),
    onEvent = () => {},
    onRequest = () => null,
    onClose = () => {},
  }) {
    this.pending = new Map();
    this.nextId = 0;
    this.closed = false;
    this.child = spawn(
      binary,
      [
        "-c",
        'cli_auth_credentials_store="file"',
        "--enable",
        "apps",
        "--enable",
        "tool_call_mcp_elicitation",
        "app-server",
      ],
      { cwd, env: codexEnvironment(home), stdio: ["pipe", "pipe", "pipe"] },
    );
    this.child.stderr.resume();
    this.ended = new Promise((resolve) => this.child.once("close", resolve));
    const fail = () => {
      if (this.closed) return;
      this.closed = true;
      for (const item of this.pending.values()) {
        clearTimeout(item.timer);
        item.reject(new Error("Codex 연결이 종료됐습니다."));
      }
      this.pending.clear();
      onClose();
    };
    this.child.on("error", fail);
    this.child.on("close", fail);
    this.child.stdin.on("error", fail);
    this.lines = createInterface({ input: this.child.stdout });
    this.lines.on("line", (line) => {
      if (line.length > 64 * 1024 * 1024) {
        this.child.kill();
        return;
      }
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      if (message.method && message.id !== undefined) {
        Promise.resolve()
          .then(() => onRequest(message))
          .then((result) => {
            if (result === null || result === undefined)
              this.send({
                id: message.id,
                error: {
                  code: -32601,
                  message: "This client denied the unsupported request.",
                },
              });
            else this.send({ id: message.id, result });
          })
          .catch(() =>
            this.send({
              id: message.id,
              error: { code: -32603, message: "Request was not approved." },
            }),
          );
      } else if (message.method) onEvent(message.method, message.params || {});
      else {
        const item = this.pending.get(message.id);
        if (!item) return;
        this.pending.delete(message.id);
        clearTimeout(item.timer);
        if (message.error)
          item.reject(
            new Error(
              `Codex 요청을 처리하지 못했습니다 (${message.error.code}).`,
            ),
          );
        else item.resolve(message.result);
      }
    });
  }
  send(message) {
    if (!this.closed && this.child.stdin.writable)
      this.child.stdin.write(JSON.stringify(message) + "\n");
  }
  call(method, params, timeout = 60000) {
    if (this.closed)
      return Promise.reject(new Error("Codex 연결이 종료됐습니다."));
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Codex 응답 시간이 초과됐습니다."));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ id, method, params });
    });
  }
  async initialize() {
    await this.call("initialize", {
      clientInfo: { name: "moa_studio", title: "Moa Studio", version: "0.1.0" },
      capabilities: { experimentalApi: true },
    });
    this.send({ method: "initialized", params: {} });
  }
  async close() {
    this.lines.close();
    this.child.kill();
    const kill = setTimeout(() => this.child.kill("SIGKILL"), 2000);
    await this.ended;
    clearTimeout(kill);
  }
}
