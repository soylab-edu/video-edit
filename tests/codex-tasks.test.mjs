import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createCodexTasks,
  callSignature,
  outputLinks,
} from "../server/codex-tasks.mjs";
import {
  createShares,
  privateAddress,
  downloadOutput,
} from "../server/media-transfer.mjs";

const tool = {
  name: "magnific.images_generate",
  title: "Generate image",
  providerId: "magnific",
  description: "test",
  inputSchema: { type: "object" },
  annotations: { readOnlyHint: false },
};
const input = {
  providerId: "magnific",
  providerName: "Magnific",
  prompt: "Test approved editing",
  mode: "refs",
  references: [
    { assetId: "test", url: "moa://ref/0", kind: "image", name: "Frame" },
  ],
};
const args = { prompt: "Test", reference: "moa://ref/0" };
const report = {
  summary: "One image",
  calls: [
    {
      tool: "editor_magnific_images_generate",
      arguments: args,
      purpose: "Reference image",
      estimatedCredits: null,
      pricingSource: "No verified quote",
    },
  ],
  followUp: "Video needs a later approval",
};
const until = async (fn) => {
  for (let i = 0; i < 200; i++) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("Timed out");
};
async function fixture(t, scenario) {
  const work = await fs.mkdtemp(path.join(os.tmpdir(), "moa-task-"));
  let calls = 0,
    prepared = 0,
    planner,
    parameters;
  class FakeRpc {
    constructor(options) {
      this.options = options;
      planner = this;
    }
    async initialize() {}
    async call(method, params) {
      if (method === "thread/start") {
        assert.equal(params.config.features.apps, false);
        assert.equal(params.config.features.shell_tool, false);
        assert.equal(params.config.features.plugins, false);
        return { thread: { id: "planner" } };
      }
      if (method === "turn/start") {
        queueMicrotask(() =>
          scenario(this).catch((e) => {
            this.failure = e;
            this.finish();
          }),
        );
        return { turn: { id: "turn" } };
      }
    }
    request(tool, arguments_) {
      return this.options.onRequest({
        method: "item/tool/call",
        params: { tool, arguments: arguments_ },
      });
    }
    finish() {
      this.options.onEvent("turn/completed", { turn: { status: "completed" } });
    }
    async close() {
      this.options.onClose();
    }
  }
  const config = {
    home: (owner) => path.join(work, owner, "codex"),
    userDir: (owner) => path.join(work, owner),
    connected: async () => true,
    Rpc: FakeRpc,
    inventory: async () => ({
      tools: [tool],
      apps: [{ id: "magnific", executionReady: true }],
    }),
    executor: async () => ({
      threadId: "executor",
      rpc: {
        async call(method, p) {
          assert.equal(method, "mcpServer/tool/call");
          calls++;
          parameters = p;
          return {
            content: [],
            structuredContent: { url: "https://media.example.com/final.png" },
          };
        },
        async close() {},
      },
    }),
    prepareReferences: async () => {
      prepared++;
      return { "moa://ref/0": "https://editor.example.com/share/approved" };
    },
  };
  const tasks = createCodexTasks(config);
  t.after(async () => {
    await fs.rm(work, { recursive: true, force: true });
  });
  return {
    tasks,
    config,
    get calls() {
      return calls;
    },
    get prepared() {
      return prepared;
    },
    get planner() {
      return planner;
    },
    get parameters() {
      return parameters;
    },
  };
}
test("Codex cannot generate or share before exact approval; modified and repeated calls are blocked", async (t) => {
  const f = await fixture(t, async (rpc) => {
    const early = await rpc.request("editor_magnific_images_generate", args);
    assert.equal(early.success, false);
    await rpc.request("moa_review", report);
    const changed = await rpc.request("editor_magnific_images_generate", {
      ...args,
      prompt: "Different",
    });
    assert.equal(changed.success, false);
    const approved = await rpc.request("editor_magnific_images_generate", args);
    assert.equal(approved.success, true);
    const repeat = await rpc.request("editor_magnific_images_generate", args);
    assert.equal(repeat.success, false);
    rpc.finish();
  });
  const job = await f.tasks.start("alice", input);
  await until(() => f.tasks.get("alice", job.id).state === "awaiting-approval");
  const review = f.tasks.get("alice", job.id).report;
  assert.equal(f.calls, 0);
  assert.equal(f.prepared, 0);
  await assert.rejects(
    f.tasks.approve("bob", job.id, {
      reportId: review.id,
      approved: true,
      acknowledgeEstimatedCost: true,
    }),
    (e) => e.status === 404,
  );
  await assert.rejects(
    f.tasks.approve("alice", job.id, { reportId: review.id, approved: true }),
    (e) => e.status === 400,
  );
  await f.tasks.approve("alice", job.id, {
    reportId: review.id,
    approved: true,
    acknowledgeEstimatedCost: true,
  });
  await assert.rejects(
    f.tasks.approve("alice", job.id, {
      reportId: review.id,
      approved: true,
      acknowledgeEstimatedCost: true,
    }),
    (e) => e.status === 409,
  );
  await until(() => f.tasks.get("alice", job.id).state === "completed");
  assert.equal(f.planner.failure, undefined);
  assert.equal(f.calls, 1);
  assert.equal(f.prepared, 1);
  assert.equal(
    f.parameters.arguments.reference,
    "https://editor.example.com/share/approved",
  );
  assert.equal(f.tasks.get("alice", job.id).outputs.length, 1);
  assert.throws(
    () =>
      f.tasks.output("bob", job.id, f.tasks.get("alice", job.id).outputs[0].id),
    (e) => e.status === 404,
  );
});
test("decline/cancel never calls a provider; restarted pending tasks do not resume billing", async (t) => {
  const f = await fixture(t, async (rpc) => {
    await rpc.request("moa_review", report);
    await rpc.request("editor_magnific_images_generate", args);
    rpc.finish();
  });
  const job = await f.tasks.start("alice", input);
  await until(() => f.tasks.get("alice", job.id).state === "awaiting-approval");
  const recovered = createCodexTasks(f.config);
  const records = await recovered.list("alice");
  assert.equal(records[0].state, "interrupted");
  await f.tasks.cancel("alice", job.id);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(f.calls, 0);
  assert.equal(f.prepared, 0);
});
test("call authorization is stable under object key order and captures array/value changes", () => {
  assert.equal(
    callSignature("x", { a: 1, b: 2 }),
    callSignature("x", { b: 2, a: 1 }),
  );
  assert.notEqual(
    callSignature("x", { a: [1, 2] }),
    callSignature("x", { a: [2, 1] }),
  );
});
test("output extraction only accepts HTTPS links from tool results", () => {
  assert.deepEqual(
    outputLinks({
      content: [
        { type: "text", text: '{"videoUrl":"https://cdn.example.com/x.mp4"}' },
      ],
      structuredContent: { url: "file:///secret" },
      _meta: { url: "https://private.example.com/ignore" },
    }),
    ["https://cdn.example.com/x.mp4"],
  );
});
test("reference shares are revocable; media downloads reject private targets and private redirects", async () => {
  const shares = createShares();
  const token = shares.issue("/tmp/example", "image/jpeg", "task");
  assert.equal(shares.get(token).type, "image/jpeg");
  assert.equal(shares.get("bad"), null);
  shares.revoke("task");
  assert.equal(shares.get(token), null);
  for (const ip of [
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.0.1",
    "::1",
    "::ffff:127.0.0.1",
    "fd00::1",
  ])
    assert.ok(privateAddress(ip), ip);
  assert.equal(privateAddress("8.8.8.8"), false);
  await assert.rejects(
    downloadOutput("https://127.0.0.1/secret", "/tmp/unused"),
    /내부 네트워크/,
  );
  await assert.rejects(
    downloadOutput("https://cdn.example.com/x", "/tmp/unused", {
      lookup: async () => [{ address: "8.8.8.8" }],
      fetcher: async () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://169.254.169.254/secret" },
        }),
    }),
    /내부 네트워크/,
  );
});
