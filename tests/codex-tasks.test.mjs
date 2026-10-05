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
async function fixture(t, scenario, overrides = {}) {
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
        this.turnInput = JSON.parse(params.input[0].text);
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
    ...overrides,
  };
  const tasks = createCodexTasks(config);
  t.after(async () => {
    await tasks.cancelAll("alice");
    await new Promise((resolve) => setTimeout(resolve, 30));
    await fs.rm(work, { recursive: true, force: true });
  });
  return {
    tasks,
    config,
    async persisted(id, state) {
      for (let i = 0; i < 200; i++) {
        try {
          const saved = JSON.parse(
            await fs.readFile(
              path.join(work, "alice", "codex-tasks", id + ".json"),
              "utf8",
            ),
          );
          if (saved.state === state) return;
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error("Task was not persisted");
    },
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
test("a finished planner turn retains the pending report and resumes exact approved work only once", async (t) => {
  let turns = 0;
  const f = await fixture(t, async (rpc) => {
    turns++;
    if (turns === 1) {
      void rpc.request("moa_review", report);
      await until(() => Boolean(f.tasks.get("alice", job.id).report));
      rpc.finish();
    } else {
      assert.equal(rpc.turnInput.approvedReport.status, "approved");
      assert.deepEqual(rpc.turnInput.approvedReport.calls, report.calls);
      assert.equal(
        (await rpc.request("editor_magnific_images_generate", args)).success,
        true,
      );
      assert.equal(
        (await rpc.request("editor_magnific_images_generate", args)).success,
        false,
      );
      rpc.finish();
    }
  });
  const job = await f.tasks.start("alice", input);
  await until(
    () =>
      f.tasks.get("alice", job.id).state === "awaiting-approval" &&
      f.planner.options &&
      f.tasks.get("alice", job.id).report,
  );
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(f.calls, 0);
  const review = f.tasks.get("alice", job.id).report;
  const approval = {
    reportId: review.id,
    approved: true,
    acknowledgeEstimatedCost: true,
  };
  const results = await Promise.allSettled([
    f.tasks.approve("alice", job.id, approval),
    f.tasks.approve("alice", job.id, approval),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  await until(() => f.tasks.get("alice", job.id).state === "completed");
  assert.equal(f.planner.failure, undefined);
  assert.equal(turns, 2);
  assert.equal(f.calls, 1);
});
test("native Runway uploads require their own exact approval and run before generation, once", async (t) => {
  const events = [];
  const runwayTool = {
    ...tool,
    name: "runway.generate_video",
    providerId: "runway",
  };
  const uploadArgs = { reference: "moa://ref/0" };
  const videoArgs = {
    model: "hailuo-3",
    duration: 5,
    promptText: "Continue",
    startFrame: { url: "moa://ref/0" },
  };
  const uploadReport = {
    summary: "One approved frame upload and one five-second video",
    followUp: "",
    calls: [
      {
        tool: "editor_moa_runway_upload_reference",
        arguments: uploadArgs,
        purpose: "Upload selected frame",
        estimatedCredits: null,
        pricingSource: "Unverified",
      },
      {
        tool: "editor_runway_generate_video",
        arguments: videoArgs,
        purpose: "Generate 5s",
        estimatedCredits: null,
        pricingSource: "Unverified",
      },
    ],
  };
  const f = await fixture(
    t,
    async (rpc) => {
      assert.equal(
        (await rpc.request("editor_moa_runway_upload_reference", uploadArgs))
          .success,
        false,
      );
      await rpc.request("moa_review", uploadReport);
      assert.equal(
        (
          await rpc.request("editor_moa_runway_upload_reference", {
            reference: "moa://ref/1",
          })
        ).success,
        false,
      );
      assert.equal(
        (await rpc.request("editor_moa_runway_upload_reference", uploadArgs))
          .success,
        true,
      );
      assert.equal(
        (await rpc.request("editor_moa_runway_upload_reference", uploadArgs))
          .success,
        false,
      );
      assert.equal(
        (await rpc.request("editor_runway_generate_video", videoArgs)).success,
        true,
      );
      rpc.finish();
    },
    {
      inventory: async () => ({
        apps: [{ id: "runway", executionReady: true }],
        tools: [
          runwayTool,
          ...["runway.init_upload", "runway.complete_upload"].map((name) => ({
            ...runwayTool,
            name,
          })),
        ],
      }),
      prepareReferenceFile: async (task, ref) => {
        events.push("extract");
        assert.equal(ref.assetId, "test");
        return { file: "owned-frame.jpg", mimeType: "image/jpeg" };
      },
      uploadReference: async ({ file, ensureActive }) => {
        ensureActive();
        assert.equal(file, "owned-frame.jpg");
        events.push("upload");
        return "https://cdn.example.com/approved.jpg";
      },
      executor: async () => ({
        threadId: "executor",
        rpc: {
          close: async () => {},
          call: async (_, params) => {
            events.push("generate");
            assert.equal(
              params.arguments.startFrame.url,
              "https://cdn.example.com/approved.jpg",
            );
            return {
              content: [],
              structuredContent: {
                taskId: "video-job",
                startFrame: { url: "https://cdn.example.com/approved.jpg" },
                posterUrl: "https://cdn.example.com/poster.jpg",
                videoUrl: "https://cdn.example.com/generated.mp4",
              },
            };
          },
        },
      }),
    },
  );
  const job = await f.tasks.start("alice", {
    ...input,
    providerId: "runway",
    providerName: "Runway",
    mode: "extend",
  });
  await until(() => f.tasks.get("alice", job.id).state === "awaiting-approval");
  assert.deepEqual(events, []);
  const review = f.tasks.get("alice", job.id).report;
  await f.tasks.approve("alice", job.id, {
    reportId: review.id,
    approved: true,
    acknowledgeEstimatedCost: true,
  });
  await until(() => f.tasks.get("alice", job.id).state === "completed");
  assert.equal(f.planner.failure, undefined);
  assert.deepEqual(events, ["extract", "upload", "generate"]);
  assert.equal(f.tasks.get("alice", job.id).outputs.length, 1);
  assert.equal(
    f.tasks.get("alice", job.id).outputs[0].url,
    "https://cdn.example.com/generated.mp4",
  );
});
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
test("decline/cancel never calls a provider; restarted untouched proposals require fresh review", async (t) => {
  const f = await fixture(t, async (rpc) => {
    await rpc.request("moa_review", report);
    await rpc.request("editor_magnific_images_generate", args);
    rpc.finish();
  });
  const job = await f.tasks.start("alice", input);
  await until(() => f.tasks.get("alice", job.id).state === "awaiting-approval");
  const recovered = createCodexTasks(f.config);
  await f.persisted(job.id, "awaiting-approval");
  const records = await recovered.list("alice");
  assert.equal(records[0].state, "awaiting-approval");
  assert.ok(records[0].report.expiresAt < Date.now());
  await f.tasks.cancel("alice", job.id);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(f.calls, 0);
  assert.equal(f.prepared, 0);
});
test("expired review renews the exact work without execution; stale, duplicate and foreign approvals fail", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const f = await fixture(t, async (rpc) => {
    if (!rpc.turnInput.approvedReport) {
      void rpc.request("moa_review", report);
      await until(() => Boolean(f.tasks.get("alice", job.id).report));
    } else {
      assert.deepEqual(rpc.turnInput.approvedReport.calls, report.calls);
      assert.equal(
        (await rpc.request("editor_magnific_images_generate", args)).success,
        true,
      );
    }
    rpc.finish();
  });
  const job = await f.tasks.start("alice", input);
  await until(() => f.tasks.get("alice", job.id).state === "awaiting-approval");
  await new Promise((r) => setTimeout(r, 30));
  const original = f.tasks.get("alice", job.id).report;
  await assert.rejects(
    f.tasks.renew("alice", job.id, { reportId: original.id }),
    (e) => e.status === 409,
  );
  t.mock.timers.tick(10 * 60000 + 1);
  const consent = { approved: true, acknowledgeEstimatedCost: true };
  await assert.rejects(
    f.tasks.approve("alice", job.id, { ...consent, reportId: original.id }),
    (e) => e.status === 409,
  );
  const restarted = createCodexTasks(f.config);
  await restarted.list("alice");
  await assert.rejects(
    restarted.renew("bob", job.id, { reportId: original.id }),
    (e) => e.status === 404,
  );
  const results = await Promise.allSettled([
    restarted.renew("alice", job.id, { reportId: original.id }),
    restarted.renew("alice", job.id, { reportId: original.id }),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const renewed = restarted.get("alice", job.id);
  assert.notEqual(renewed.report.id, original.id);
  assert.deepEqual(renewed.report.calls, original.calls);
  assert.deepEqual(renewed.references, job.references);
  assert.equal(renewed.report.summary, original.summary);
  assert.equal(renewed.reportHistory.at(-1).status, "expired");
  assert.equal(f.calls, 0);
  assert.equal(f.prepared, 0);
  await assert.rejects(
    restarted.approve("alice", job.id, { ...consent, reportId: original.id }),
    (e) => e.status === 409,
  );
  await restarted.approve("alice", job.id, {
    ...consent,
    reportId: renewed.report.id,
  });
  await until(() => restarted.get("alice", job.id).state === "completed");
  assert.equal(f.planner.failure, undefined);
  assert.equal(f.calls, 1);
  await assert.rejects(
    restarted.renew("alice", job.id, { reportId: renewed.report.id }),
    (e) => e.status === 409,
  );
});
test("restarting an approved task never recovers a runnable approval or permits renewal", async (t) => {
  let release;
  const hold = new Promise((resolve) => {
    release = resolve;
  });
  const f = await fixture(t, async (rpc) => {
    await rpc.request("moa_review", report);
    await hold;
    rpc.finish();
  });
  const job = await f.tasks.start("alice", input);
  await until(() => f.tasks.get("alice", job.id).state === "awaiting-approval");
  const pending = f.tasks.get("alice", job.id).report;
  await f.tasks.approve("alice", job.id, {
    reportId: pending.id,
    approved: true,
    acknowledgeEstimatedCost: true,
  });
  const restarted = createCodexTasks(f.config);
  const [record] = await restarted.list("alice");
  assert.equal(record.state, "interrupted");
  await assert.rejects(
    restarted.renew("alice", job.id, { reportId: pending.id }),
    (e) => e.status === 409,
  );
  assert.equal(f.calls, 0);
  release();
  await until(() => f.tasks.get("alice", job.id).state === "completed");
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
test("provider-echoed reference images are not treated as generated outputs", () => {
  assert.deepEqual(
    outputLinks({
      structuredContent: {
        startFrame: { url: "https://cdn.example.com/input.jpg" },
        referenceImages: [{ url: "https://cdn.example.com/reference.jpg" }],
        input: { url: "https://cdn.example.com/original.mp4" },
        output: [{ url: "https://cdn.example.com/generated.mp4" }],
      },
    }),
    ["https://cdn.example.com/generated.mp4"],
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
