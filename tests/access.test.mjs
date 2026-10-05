import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";

test(
  "private workspace: setup, API protection, persistent login/project, conflicts and logout",
  { timeout: 30000 },
  async (t) => {
    const data = await fs.mkdtemp(path.join(os.tmpdir(), "moa-access-"));
    const reservation = http.createServer();
    await new Promise((r) => reservation.listen(0, "127.0.0.1", r));
    const port = reservation.address().port;
    await new Promise((r) => reservation.close(r));
    const base = `http://127.0.0.1:${port}`;
    let server;
    const stop = async () => {
      if (!server) return;
      const old = server;
      server = null;
      const closed = new Promise((r) => old.once("close", r));
      old.kill();
      await closed;
    };
    async function start() {
      server = spawn(process.execPath, ["server/index.mjs"], {
        env: {
          ...process.env,
          PORT: String(port),
          MOA_DATA_DIR: data,
          MOA_AUTH_MODE: "required",
          NODE_ENV: "production",
          COOKIE_SECURE: "0",
        },
        stdio: "ignore",
      });
      for (let i = 0; i < 100; i++) {
        try {
          if ((await fetch(base + "/api/health")).ok) return;
        } catch {}
        await new Promise((r) => setTimeout(r, 60));
      }
      throw new Error("Access test server did not start");
    }
    t.after(async () => {
      await stop();
      await fs.rm(data, { recursive: true, force: true });
    });
    await start();
    let cookie = "";
    async function request(route, body, method = "POST", extra = {}) {
      return fetch(base + route, {
        method,
        headers: {
          "Content-Type": "application/json",
          Cookie: cookie,
          ...extra,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    }
    for (const route of [
      "/api/assets",
      "/api/project",
      "/api/status",
      "/api/connections/codex-apps",
      "/api/codex-tasks",
      "/demo/assets.json",
      "/media/fake.mp4",
    ])
      assert.equal((await fetch(base + route)).status, 401, route);
    assert.equal(
      (await request("/api/connections/codex-apps/refresh", {})).status,
      401,
    );
    const token = await fs.readFile(
      path.join(data, "access/invite-token"),
      "utf8",
    );
    const password = randomBytes(24).toString("hex");
    assert.equal(
      (await request("/api/auth/setup", { token: "wrong", password })).status,
      403,
    );
    assert.equal(
      (
        await request("/api/auth/setup", { token, password }, "POST", {
          Origin: "https://attacker.example",
        })
      ).status,
      403,
    );
    assert.equal(
      (await request("/api/auth/setup", { token, password: "short" })).status,
      400,
    );
    const setup = await request("/api/auth/setup", { token, password });
    assert.equal(setup.status, 200);
    assert.match(setup.headers.get("set-cookie"), /HttpOnly/);
    assert.match(setup.headers.get("set-cookie"), /SameSite=Strict/);
    cookie = setup.headers.get("set-cookie").split(";")[0];
    assert.equal(
      (await request("/api/auth/setup", { token, password })).status,
      409,
    );
    const project = {
      name: "로그인 후 이어서 편집",
      ratio: "16:9",
      clips: [],
      audio: [],
      titles: [],
      normalize: true,
    };
    const stored = await request(
      "/api/project",
      { project, baseRevision: null },
      "PUT",
    );
    assert.equal(stored.status, 200);
    const { revision } = await stored.json();
    assert.ok(revision);
    assert.equal(
      (
        await request(
          "/api/project",
          { project: { ...project, name: "stale" }, baseRevision: null },
          "PUT",
        )
      ).status,
      409,
    );
    await stop();
    await start();
    assert.deepEqual(
      (await (await request("/api/project", null, "GET")).json()).project,
      project,
    );
    assert.equal((await request("/api/auth/logout")).status, 200);
    assert.equal((await request("/api/project", null, "GET")).status, 401);
    cookie = "";
    assert.equal(
      (await request("/api/auth/login", { password: "wrong" })).status,
      401,
    );
    const login = await request("/api/auth/login", { password });
    assert.equal(login.status, 200);
    cookie = login.headers.get("set-cookie").split(";")[0];
    assert.deepEqual(
      (await (await request("/api/project", null, "GET")).json()).project,
      project,
    );
    const savedAccount = await fs.readFile(
      path.join(data, "access/account.json"),
      "utf8",
    );
    assert.ok(
      !savedAccount.includes(password),
      "password must only be stored as a salted hash",
    );
    await assert.rejects(fs.access(path.join(data, "access/invite-token")));
  },
);
