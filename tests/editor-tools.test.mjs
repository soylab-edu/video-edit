import test from "node:test";
import assert from "node:assert/strict";
import {
  editorInventory,
  clearEditorInventory,
} from "../server/editor-tools.mjs";
test("editor discovery uses actual tools, checks auth read-only and omits unrelated providers and private metadata", async () => {
  const methods = [],
    called = [];
  const make = (name, provider, readonly = false) => ({
    name,
    title: name,
    description: "Fixture",
    inputSchema: { type: "object" },
    annotations: { readOnlyHint: readonly },
    _meta: {
      connector_id: "fixture-" + provider,
      connector_name: provider,
      link_owner_profile: { email: "private@example.test" },
    },
  });
  const tools = Object.fromEntries(
    [
      make("magnific.account_balance", "Magnific", true),
      make("magnific.images_generate", "Magnific"),
      make("magnific.delete_everything", "Magnific"),
      make("runway.whoami", "Runway", true),
      make("runway.generate_video", "Runway"),
      make("higgsfield.generate_video", "Higgsfield"),
      make("gmail.send", "Gmail"),
    ].map((t) => [t.name, t]),
  );
  class Rpc {
    async initialize() {}
    async call(method, params) {
      methods.push(method);
      if (method === "thread/start")
        return { thread: { id: "read-only-inventory" } };
      if (method === "mcpServerStatus/list")
        return { data: [{ name: "codex_apps", tools }], nextCursor: null };
      if (method === "mcpServer/tool/call") {
        called.push(params.tool);
        return params.tool === "runway.whoami"
          ? { isError: true, structuredContent: { error_code: "UNAUTHORIZED" } }
          : { isError: false, structuredContent: { private: "not returned" } };
      }
      throw new Error(method);
    }
    async close() {}
  }
  const options = { home: "/test/editor-tools-auth", cwd: "/test", Rpc };
  clearEditorInventory(options.home);
  const result = await editorInventory(options);
  assert.deepEqual(
    result.apps.map((a) => a.name),
    ["Runway", "Magnific", "HeyGen", "PixVerse"],
  );
  assert.equal(
    result.apps.find((a) => a.id === "magnific").executionReady,
    true,
  );
  assert.equal(
    result.apps.find((a) => a.id === "runway").authentication,
    "reauthentication",
  );
  assert.equal(
    result.apps.find((a) => a.id === "runway").executionReady,
    false,
  );
  assert.ok(!JSON.stringify(result).includes("private@example.test"));
  assert.ok(!result.tools.some((t) => /delete|gmail|higgsfield/.test(t.name)));
  assert.deepEqual(called, ["runway.whoami", "magnific.account_balance"]);
  assert.ok(!methods.includes("turn/start"));
  clearEditorInventory(options.home);
});
