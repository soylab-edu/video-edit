import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { listCodexApps, createAppDiscovery } from "../server/codex-apps.mjs";

async function fakeServer(t, program) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "moa-app-inventory-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const binary = path.join(dir, "codex.mjs");
  await fs.writeFile(
    binary,
    `#!${process.execPath}\nimport fs from 'node:fs';\nimport {createInterface} from 'node:readline';\nconst send = value => process.stdout.write(JSON.stringify(value)+'\\n');\ncreateInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);fs.appendFileSync('methods.jsonl',JSON.stringify(m)+'\\n');${program}\n});\n`,
    { mode: 0o700 },
  );
  return {
    home: path.join(dir, "private-home"),
    cwd: dir,
    binary,
    timeout: 3000,
  };
}

test("account app discovery paginates, excludes inaccessible apps and never starts inference", async (t) => {
  const options = await fakeServer(
    t,
    `
    if(m.method==='initialize') return send({id:m.id,result:{userAgent:'fixture'}});
    if(m.method==='initialized') return;
    if(m.method==='app/list') return send({id:m.id,result:m.params.cursor ? {
      data:[{id:'runway',name:'Runway',isAccessible:true,isEnabled:true,installUrl:'javascript:alert(1)'},{id:'paused',name:'Paused',isAccessible:true,isEnabled:false}],nextCursor:null
    } : {data:[{id:'runway',name:'Runway',isAccessible:true},{id:'catalog-only',name:'Catalog item',isAccessible:false},{id:'unspecified',name:'Unknown access'}],nextCursor:'page-2'}});
    send({id:m.id,error:{code:-32601,message:'not allowed'}});
  `,
  );
  const apps = await listCodexApps(options);
  assert.deepEqual(
    apps.map((a) => a.name),
    ["Paused", "Runway"],
  );
  assert.equal(apps[0].enabled, false);
  assert.equal(apps[1].installUrl, null);
  assert.ok(
    apps.every(
      (a) =>
        a.executionReady === false &&
        a.source === "codex-account" &&
        !a.capabilities,
    ),
  );
  const messages = (
    await fs.readFile(path.join(options.cwd, "methods.jsonl"), "utf8")
  )
    .trim()
    .split("\n")
    .map(JSON.parse);
  assert.deepEqual(
    messages.map((m) => m.method),
    ["initialize", "initialized", "app/list", "app/list"],
  );
  assert.equal(messages[2].params.forceRefetch, true);
  assert.equal(messages[3].params.cursor, "page-2");
});

test("inventory errors do not reveal raw account diagnostics or pretend the account has no apps", async (t) => {
  const options = await fakeServer(
    t,
    `
    if(m.method==='initialize') return send({id:m.id,result:{}});
    if(m.method==='app/list') return send({id:m.id,error:{code:401,message:'PRIVATE_TOKEN_FIXTURE'}});
  `,
  );
  await assert.rejects(
    listCodexApps(options),
    (e) =>
      !e.message.includes("PRIVATE_TOKEN_FIXTURE") && /로그인/.test(e.message),
  );
});

test("a hung inventory server times out without executing tools", async (t) => {
  const options = await fakeServer(t, "");
  await assert.rejects(
    listCodexApps({ ...options, timeout: 150 }),
    /앱 목록을 가져오지 못했습니다/,
  );
});

test("background discovery isolates owners and discards results after disconnect", async () => {
  const users = new Set(["alice", "bob"]),
    requests = [];
  const discovery = createAppDiscovery({
    connected: async (owner) => users.has(owner),
    home: (owner) => `/private/${owner}/codex`,
    userDir: (owner) => `/private/${owner}`,
    list: (options) =>
      new Promise((resolve, reject) =>
        requests.push({ options, resolve, reject }),
      ),
  });
  const tick = () => new Promise((resolve) => setImmediate(resolve));
  assert.equal((await discovery.get("nobody")).state, "not-connected");
  assert.equal(requests.length, 0);
  assert.equal((await discovery.get("alice")).state, "checking");
  assert.equal((await discovery.get("alice", true)).state, "checking");
  await tick();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.home, "/private/alice/codex");
  requests[0].resolve([{ id: "alice-app" }]);
  await tick();
  assert.equal((await discovery.get("alice")).apps[0].id, "alice-app");
  assert.equal((await discovery.get("bob")).state, "checking");
  await tick();
  requests[1].reject(new Error("private diagnostics"));
  await tick();
  assert.equal((await discovery.get("bob")).state, "error");
  assert.ok(
    !JSON.stringify(await discovery.get("bob")).includes("private diagnostics"),
  );
  assert.equal((await discovery.get("alice", true)).state, "checking");
  await tick();
  discovery.clear("alice");
  assert.equal((await discovery.get("alice")).state, "checking");
  users.delete("alice");
  requests[2].resolve([{ id: "stale-account-app" }]);
  await tick();
  assert.equal((await discovery.get("alice")).state, "not-connected");
  users.add("alice");
  assert.equal((await discovery.get("alice")).state, "checking");
  await tick();
  requests[3].resolve([{ id: "new-account-app" }]);
  await tick();
  assert.equal((await discovery.get("alice")).apps[0].id, "new-account-app");
});
