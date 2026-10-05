import { CodexRpc } from "./codex-rpc.mjs";

export const EDITOR_PROVIDERS = [
  {
    id: "runway",
    name: "Runway",
    description: "영상·이미지 생성 · 컷 연결 · 효과음",
  },
  {
    id: "magnific",
    name: "Magnific",
    description: "이미지 개선 · 참조 이미지·영상 생성",
  },
  { id: "heygen", name: "HeyGen", description: "아바타 · 립싱크 · 더빙" },
  { id: "pixverse", name: "PixVerse", description: "영상 생성 · 장면 변형" },
];
const reads = new Set([
  "runway.whoami",
  "runway.show_plans_and_credits",
  "runway.get_task",
  "runway.search_voices",
  "magnific.account_balance",
  "magnific.images_models_list",
  "magnific.images_models_show",
  "magnific.images_models_settings",
  "magnific.images_upscale_modes_list",
  "magnific.video_models_list",
  "magnific.video_models_show",
  "magnific.creations_get",
  "magnific.creation_status",
  "magnific.creations_wait",
  "magnific.audio_voices_list",
  "heygen.get_current_user",
  "heygen.list_model_audio_voices",
  "heygen.list_avatar_groups",
  "heygen.get_avatar_group",
  "heygen.internal_get_video_status",
  "heygen.bulk_video_statuses",
  "heygen.list_video_translation_languages",
]);
const writes = new Set([
  "runway.generate_video",
  "runway.generate_image",
  "runway.generate_sound_effect",
  "runway.generate_speech",
  "runway.upscale_image",
  "runway.upscale_video",
  "runway.edit_video",
  "magnific.images_generate",
  "magnific.images_upscale",
  "magnific.video_generate",
  "magnific.images_relight",
  "magnific.creations_upload_image",
  "magnific.creations_upload_file",
  "heygen.create_video_from_avatar",
  "heygen.create_video_from_cinematic_avatar",
  "heygen.create_speech",
  "heygen.translate_video",
]);
const cache = new Map();
export function dynamicName(tool) {
  return "editor_" + tool.name.replace(/[^a-zA-Z0-9_]/g, "_");
}
export function isReadTool(tool) {
  return reads.has(tool.name) && tool.annotations?.readOnlyHint === true;
}
export function editableTools(tools) {
  return tools.filter((t) => reads.has(t.name) || writes.has(t.name));
}
export async function openExecutor({ home, cwd, Rpc = CodexRpc }) {
  const rpc = new Rpc({
    home,
    cwd,
    onRequest: (m) =>
      m.method === "mcpServer/elicitation/request"
        ? { action: "decline", content: null }
        : null,
  });
  try {
    await rpc.initialize();
    const { thread } = await rpc.call("thread/start", {
      cwd,
      ephemeral: true,
      sandbox: "read-only",
      approvalPolicy: "untrusted",
      approvalsReviewer: "user",
      config: { features: { shell_tool: false } },
    });
    return { rpc, threadId: thread.id };
  } catch (e) {
    await rpc.close();
    throw e;
  }
}
export async function editorInventory(options, force = false) {
  const key = options.home;
  const previous = cache.get(key);
  if (!force && previous && Date.now() - previous.at < 5 * 60000)
    return previous.promise;
  const promise = (async () => {
    const { rpc, threadId } = await openExecutor(options);
    try {
      const tools = [];
      let cursor = null;
      for (let page = 0; page < 20; page++) {
        const result = await rpc.call(
          "mcpServerStatus/list",
          { cursor, limit: 100 },
          60000,
        );
        for (const server of result.data) {
          if (server.name !== "codex_apps") continue;
          for (const tool of Object.values(server.tools)) {
            const provider = EDITOR_PROVIDERS.find((p) =>
              tool.name.startsWith(p.id + "."),
            );
            if (!provider || !tool._meta?.connector_id) continue;
            // Retain only routing metadata. Account profiles and emails never reach the UI/model.
            tools.push({
              name: tool.name,
              title: tool.title || tool.name,
              description: tool.description || "",
              inputSchema: tool.inputSchema,
              annotations: tool.annotations || {},
              providerId: provider.id,
              connectorId: tool._meta.connector_id,
            });
          }
        }
        cursor = result.nextCursor;
        if (!cursor) break;
        if (page === 19)
          throw new Error("플러그인 도구 조회 한도를 초과했습니다.");
      }
      const supported = editableTools(tools);
      const checks = {
        runway: "runway.whoami",
        magnific: "magnific.account_balance",
        heygen: "heygen.get_current_user",
      };
      const apps = [];
      for (const p of EDITOR_PROVIDERS) {
        let authentication = "unverified";
        if (supported.some((t) => t.name === checks[p.id])) {
          try {
            const result = await rpc.call(
              "mcpServer/tool/call",
              {
                threadId,
                server: "codex_apps",
                tool: checks[p.id],
                arguments: {},
              },
              30000,
            );
            authentication = !result.isError
              ? "verified"
              : /UNAUTHORIZED|REAUTH|AUTHENTICATION/i.test(
                    result.structuredContent?.error_code || "",
                  )
                ? "reauthentication"
                : "unverified";
          } catch {}
        }
        apps.push({
          ...p,
          enabled: supported.some((t) => t.providerId === p.id),
          source: "codex-tools",
          authentication,
          executionReady:
            authentication === "verified" &&
            supported.some((t) => t.providerId === p.id && !isReadTool(t)),
          toolCount: tools.filter((t) => t.providerId === p.id).length,
        });
      }
      return { tools: supported, apps };
    } finally {
      await rpc.close();
    }
  })();
  cache.set(key, { at: Date.now(), promise });
  try {
    return await promise;
  } catch (e) {
    if (cache.get(key)?.promise === promise) cache.delete(key);
    throw e;
  }
}
export function clearEditorInventory(home) {
  cache.delete(home);
}
