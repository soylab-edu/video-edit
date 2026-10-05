import fs from "node:fs/promises";
import path from "node:path";
import { openExecutor, editorInventory } from "../server/editor-tools.mjs";

const cwd = path.resolve(process.argv[2] || "");
if (!process.argv[2])
  throw new Error("Specify the editor workspace directory.");
const options = { cwd, home: path.join(cwd, "codex") };
const inventory = await editorInventory(options, true);
const { rpc, threadId } = await openExecutor(options);
const servers = [],
  details = [];
let runway;
try {
  const account = await rpc.call("mcpServer/tool/call", {
    threadId,
    server: "codex_apps",
    tool: "runway.whoami",
    arguments: {},
  });
  runway = account.structuredContent;
  if (!runway) {
    for (const c of account.content || []) {
      try {
        runway = JSON.parse(c.text);
        break;
      } catch {}
    }
  }
  let cursor = null;
  do {
    const result = await rpc.call(
      "mcpServerStatus/list",
      { cursor, limit: 100 },
      60000,
    );
    for (const server of result.data) {
      const tools = Object.values(server.tools || {});
      servers.push({
        name: server.name,
        authStatus: server.authStatus,
        toolCount: tools.length,
      });
      for (const tool of tools) {
        if (
          /pixverse/i.test(tool.name + " " + tool.title) ||
          /^runway\.(init_upload|complete_upload|generate_video|whoami)$/.test(
            tool.name,
          )
        )
          details.push({
            server: server.name,
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
            annotations: tool.annotations,
          });
      }
    }
    cursor = result.nextCursor;
  } while (cursor);
} finally {
  await rpc.close();
}
await fs.mkdir("test-results", { recursive: true });
const account = runway && {
  authenticated: runway.authenticated,
  availableVideoModels: runway.availableVideoModels,
  credits: runway.credits,
};
await fs.writeFile(
  "test-results/editor-connection-inspection.json",
  JSON.stringify(
    { apps: inventory.apps, servers, details, runway: account },
    null,
    2,
  ),
);
console.log(
  JSON.stringify(
    {
      apps: inventory.apps,
      servers,
      runway: account,
      toolNames: details.map((t) => t.name),
    },
    null,
    2,
  ),
);
