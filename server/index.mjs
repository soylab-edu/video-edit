import express from "express";
import multer from "multer";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  run,
  projectSchema,
  duration,
  validateAssetBounds,
  silenceIntervals,
  keepRanges,
  tempoFilters,
  decodeFilename,
} from "./core.mjs";
import { styles } from "./styles.mjs";
import { autoSchema, planSchema, localPlan, applyPlan } from "./auto-edit.mjs";
import { installAccess, atomicJson } from "./access.mjs";
import { createCodexLogin, codexEnvironment } from "./codex-login.mjs";
import { createAppDiscovery } from "./codex-apps.mjs";
import {
  editorInventory,
  clearEditorInventory,
  EDITOR_PROVIDERS,
} from "./editor-tools.mjs";
import { createCodexTasks } from "./codex-tasks.mjs";
import { createShares, downloadOutput } from "./media-transfer.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.resolve(process.env.MOA_DATA_DIR || path.join(ROOT, ".data"));
const PYTHON = process.env.MOA_PYTHON || path.join(ROOT, ".venv/bin/python");
await fs.mkdir(DATA, { recursive: true });
const app = express(),
  jobs = new Map(),
  connections = new Map();
app.disable("x-powered-by");
app.use(express.json({ limit: "2mb" }));
const shares = createShares();
app.get("/share/:token", (req, res) => {
  const entry = shares.get(req.params.token);
  if (!entry) return res.status(404).end();
  res
    .set("Cache-Control", "no-store")
    .type(entry.type)
    .sendFile(entry.file, { dotfiles: "allow" });
});
app.use((req, res, next) => {
  const origin = req.get("origin");
  const allowedOrigins = (
    process.env.MOA_ALLOWED_ORIGINS ||
    (process.env.NODE_ENV === "production"
      ? ""
      : "http://127.0.0.1:5173,http://localhost:5173")
  )
    .split(",")
    .filter(Boolean);
  let originHost;
  try {
    originHost = origin && new URL(origin).host;
  } catch {
    return res.status(403).json({ error: "유효하지 않은 요청 출처입니다." });
  }
  if (
    !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
    origin &&
    originHost !== req.get("host") &&
    !allowedOrigins.includes(origin)
  )
    return res
      .status(403)
      .json({ error: "다른 사이트의 요청은 허용되지 않습니다." });
  next();
});
await installAccess(app, {
  data: DATA,
  onLogout: (owner) => connections.delete(owner),
});
app.use((req, res, next) => {
  if (req.accessOwner) {
    req.owner = req.accessOwner;
    return next();
  }
  const cookies = Object.fromEntries(
    (req.headers.cookie || "").split(";").map((v) => v.trim().split("=")),
  );
  req.owner = /^[0-9a-f-]{36}$/.test(cookies.moa_session || "")
    ? cookies.moa_session
    : randomUUID();
  if (req.owner !== cookies.moa_session)
    res.cookie("moa_session", req.owner, {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.COOKIE_SECURE === "1",
      maxAge: 365 * 86400000,
    });
  next();
});
const asyncRoute = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res)).catch(next);
const userDir = (owner) => path.join(DATA, owner);
const codexLogin = createCodexLogin(userDir);
const accountApps = createAppDiscovery({
  connected: codexLogin.connected,
  home: codexLogin.home,
  userDir,
  list: async (options) => (await editorInventory(options)).apps,
});
app.get(
  "/api/connections/codex-apps",
  asyncRoute(async (req, res) => res.json(await accountApps.get(req.owner))),
);
app.post(
  "/api/connections/codex-apps/refresh",
  asyncRoute(async (req, res) => {
    clearEditorInventory(codexLogin.home(req.owner));
    res.json(await accountApps.get(req.owner, true));
  }),
);
const codexTasks = createCodexTasks({
  home: codexLogin.home,
  userDir,
  connected: codexLogin.connected,
  onFinish: (task) => shares.revoke(task.id),
  prepareReferences: async (task) => {
    if (!task.references.length) return {};
    let publicUrl = process.env.MOA_PUBLIC_URL;
    if (!publicUrl) {
      try {
        publicUrl = JSON.parse(
          await fs.readFile(
            path.join(ROOT, ".data/preview-state/address.json"),
            "utf8",
          ),
        ).url;
      } catch {}
    }
    if (!publicUrl || new URL(publicUrl).protocol !== "https:")
      throw new Error(
        "참조 소재 전송을 위한 편집기의 HTTPS 주소를 확인하지 못했습니다.",
      );
    const dir = path.join(userDir(task.owner), "codex-references", task.id);
    await fs.mkdir(dir, { recursive: true });
    const urls = {};
    for (let i = 0; i < task.references.length; i++) {
      const ref = task.references[i];
      const asset = await getAsset(task.owner, ref.assetId);
      if (asset.deleted)
        throw new Error(
          "선택한 소재가 삭제되었습니다. 새 작업에서 참조를 다시 선택하세요.",
        );
      let file = assetPath(task.owner, asset),
        type = asset.type === "audio" ? "audio/mp4" : "video/mp4";
      if (ref.kind === "image") {
        file = path.join(dir, `${i}.jpg`);
        type = "image/jpeg";
        await run("ffmpeg", [
          "-y",
          "-ss",
          String(ref.time || 0),
          "-i",
          assetPath(task.owner, asset),
          "-frames:v",
          "1",
          "-vf",
          "scale=1280:-1",
          file,
        ]);
      }
      if ((await fs.stat(file)).size > 50 * 1024 * 1024)
        throw new Error("플러그인 참조 소재는 파일당 50MB까지 전송합니다.");
      urls[ref.url] = new URL(
        "/share/" + shares.issue(file, type, task.id),
        publicUrl,
      ).href;
    }
    return urls;
  },
});
const codexTaskInput = z.object({
  providerId: z.enum(["runway", "magnific", "heygen", "pixverse"]),
  prompt: z.string().min(3).max(4000),
  mode: z.enum(["none", "f2f", "refs"]).default("none"),
  references: z
    .array(
      z.object({
        assetId: z.string().max(100),
        kind: z.enum(["image", "video", "audio"]),
        time: z.number().nonnegative().optional(),
      }),
    )
    .max(6)
    .default([]),
});
app.get(
  "/api/codex-tasks",
  asyncRoute(async (req, res) => res.json(await codexTasks.list(req.owner))),
);
app.post(
  "/api/codex-tasks",
  asyncRoute(async (req, res) => {
    const input = codexTaskInput.parse(req.body);
    const references = [];
    if (
      input.mode === "f2f" &&
      (input.references.length !== 2 ||
        input.references.some((r) => r.kind !== "image"))
    )
      throw new Error("F2F에는 두 컷의 경계 프레임이 필요합니다.");
    for (const [i, ref] of input.references.entries()) {
      const a = await getAsset(req.owner, ref.assetId);
      if (
        a.deleted ||
        (ref.time || 0) >= a.duration ||
        (ref.kind === "image" && a.type !== "video") ||
        (ref.kind === "audio" && a.type !== "audio")
      )
        throw new Error("사용할 참조 소재와 시간 범위를 확인하세요.");
      references.push({
        ...ref,
        name: a.name,
        url: `moa://ref/${i}`,
        duration: a.duration,
      });
    }
    res.status(202).json(
      await codexTasks.start(req.owner, {
        ...input,
        references,
        providerName: EDITOR_PROVIDERS.find((p) => p.id === input.providerId)
          .name,
      }),
    );
  }),
);
app.get(
  "/api/codex-tasks/:id",
  asyncRoute(async (req, res) =>
    res.json(codexTasks.get(req.owner, req.params.id)),
  ),
);
app.post(
  "/api/codex-tasks/:id/approve",
  asyncRoute(async (req, res) =>
    res.json(await codexTasks.approve(req.owner, req.params.id, req.body)),
  ),
);
app.post(
  "/api/codex-tasks/:id/cancel",
  asyncRoute(async (req, res) => {
    const result = await codexTasks.cancel(req.owner, req.params.id);
    shares.revoke(req.params.id);
    res.json(result);
  }),
);
app.post(
  "/api/codex-tasks/:id/import",
  asyncRoute(async (req, res) => {
    const { outputId } = z
      .object({ outputId: z.string().uuid() })
      .parse(req.body);
    const output = codexTasks.output(req.owner, req.params.id, outputId);
    const job = newJob(req.owner, "plugin-import", async () => {
      const temp = path.join(userDir(req.owner), randomUUID() + ".bin");
      try {
        await downloadOutput(output.url, temp);
        const asset = await ingest(req.owner, temp, "플러그인 생성 결과");
        await codexTasks.imported(req.owner, req.params.id, asset);
        return { asset };
      } finally {
        await fs.rm(temp, { force: true });
      }
    });
    res.status(202).json(publicJob(job));
  }),
);
app.post(
  "/api/connections/codex-login",
  asyncRoute(async (req, res) =>
    res.status(202).json(await codexLogin.start(req.owner)),
  ),
);
app.get(
  "/api/connections/codex-login",
  asyncRoute(async (req, res) => res.json(await codexLogin.status(req.owner))),
);
app.delete(
  "/api/connections/codex-login",
  asyncRoute(async (req, res) => {
    await codexLogin.cancel(req.owner);
    res.json({ state: "idle" });
  }),
);
const savedProjectSchema = projectSchema.extend({
  clips: z.array(projectSchema.shape.clips.element).max(100),
});
const projectLocks = new Map();
const revisionOf = (project) =>
  project
    ? createHash("sha256").update(JSON.stringify(project)).digest("hex")
    : null;
async function readProject(owner) {
  try {
    return JSON.parse(
      await fs.readFile(path.join(userDir(owner), "project.json"), "utf8"),
    );
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}
app.get(
  "/api/project",
  asyncRoute(async (req, res) => {
    const project = await readProject(req.owner);
    res.json({ project, revision: revisionOf(project) });
  }),
);
app.put(
  "/api/project",
  asyncRoute(async (req, res) => {
    const project = savedProjectSchema.parse(req.body.project);
    if (project.clips.length)
      validateAssetBounds(project, await assetsFor(req.owner));
    const previous = projectLocks.get(req.owner) || Promise.resolve();
    const save = previous
      .catch(() => {})
      .then(async () => {
        const current = await readProject(req.owner);
        if (req.body.baseRevision !== revisionOf(current))
          return res.status(409).json({
            error:
              "다른 창에서 프로젝트가 변경되었습니다. 현재 작업을 프로젝트 파일로 저장한 후 새로고침하세요.",
          });
        await atomicJson(
          path.join(userDir(req.owner), "project.json"),
          project,
        );
        res.json({ revision: revisionOf(project) });
      });
    projectLocks.set(req.owner, save);
    await save;
  }),
);
async function readAssets(owner) {
  try {
    return JSON.parse(
      await fs.readFile(path.join(userDir(owner), "assets.json"), "utf8"),
    );
  } catch {
    return [];
  }
}
async function assetsFor(owner) {
  let demo = [];
  try {
    demo = JSON.parse(
      await fs.readFile(path.join(ROOT, "public/demo/assets.json"), "utf8"),
    );
  } catch {}
  let deleted = [];
  try {
    deleted = JSON.parse(
      await fs.readFile(
        path.join(userDir(owner), "library-deleted.json"),
        "utf8",
      ),
    );
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  const hidden = new Set(deleted);
  return [...demo, ...(await readAssets(owner))].map((asset) => ({
    ...asset,
    ...(hidden.has(asset.id) ? { deleted: true } : {}),
  }));
}
const libraryLocks = new Map();
async function hideAssets(owner, ids) {
  const previous = libraryLocks.get(owner) || Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(async () => {
      const assets = await assetsFor(owner);
      if (ids.some((id) => !assets.some((a) => a.id === id)))
        throw Object.assign(new Error("미디어를 찾을 수 없습니다."), {
          status: 404,
        });
      const deleted = [
        ...new Set([
          ...assets.filter((a) => a.deleted).map((a) => a.id),
          ...ids,
        ]),
      ];
      await atomicJson(
        path.join(userDir(owner), "library-deleted.json"),
        deleted,
      );
      return assets.map((a) =>
        deleted.includes(a.id) ? { ...a, deleted: true } : a,
      );
    });
  libraryLocks.set(owner, next);
  return next;
}
app.delete(
  "/api/assets/samples",
  asyncRoute(async (req, res) => {
    const ids = (await assetsFor(req.owner))
      .filter((a) => a.demo)
      .map((a) => a.id);
    res.json({ assets: await hideAssets(req.owner, ids), deletedIds: ids });
  }),
);
app.delete(
  "/api/assets/:id",
  asyncRoute(async (req, res) => {
    res.json({
      assets: await hideAssets(req.owner, [req.params.id]),
      deletedIds: [req.params.id],
    });
  }),
);
const locks = new Map();
async function saveAsset(owner, asset) {
  const previous = locks.get(owner) || Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(async () => {
      const list = await readAssets(owner);
      list.push(asset);
      await fs.mkdir(userDir(owner), { recursive: true });
      await fs.writeFile(
        path.join(userDir(owner), "assets.json"),
        JSON.stringify(list),
      );
    });
  locks.set(owner, next);
  await next;
  return asset;
}
async function getAsset(owner, id) {
  const asset = (await assetsFor(owner)).find((a) => a.id === id);
  if (!asset) throw new Error("미디어를 찾을 수 없습니다.");
  return asset;
}
function assetPath(owner, asset) {
  return asset.demo
    ? path.join(ROOT, "public", asset.url)
    : path.join(userDir(owner), path.basename(asset.url));
}
async function probe(file) {
  const { stdout } = await run("ffprobe", [
    "-v",
    "error",
    "-show_format",
    "-show_streams",
    "-of",
    "json",
    file,
  ]);
  return JSON.parse(stdout);
}
async function ingest(owner, file, name) {
  const meta = await probe(file),
    video = meta.streams.find(
      (s) => s.codec_type === "video" && !s.disposition?.attached_pic,
    ),
    audio = meta.streams.find((s) => s.codec_type === "audio");
  if (!video && !audio)
    throw new Error("지원되는 영상 또는 오디오 파일이 아닙니다.");
  const image = video && !audio && !Number(meta.format.duration),
    id = randomUUID(),
    ext = video ? ".mp4" : ".m4a";
  const target = path.join(userDir(owner), id + ext);
  await fs.mkdir(userDir(owner), { recursive: true });
  const args = [
    "-y",
    ...(image ? ["-loop", "1"] : []),
    "-i",
    file,
    ...(image ? ["-t", "5"] : []),
    "-threads",
    "2",
  ];
  if (video)
    args.push(
      "-vf",
      "scale=trunc(iw/2)*2:trunc(ih/2)*2",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-crf",
      "22",
      "-pix_fmt",
      "yuv420p",
    );
  args.push("-c:a", "aac", "-movflags", "+faststart", target);
  await run("ffmpeg", args, { timeout: 600000 });
  const info = await probe(target),
    d = Number(info.format.duration);
  if (!Number.isFinite(d) || d <= 0)
    throw new Error("미디어 길이를 읽을 수 없습니다.");
  let thumbnail = "";
  if (video) {
    thumbnail = `/media/${id}.jpg`;
    await run("ffmpeg", [
      "-y",
      "-i",
      target,
      "-frames:v",
      "1",
      "-vf",
      "scale=480:-1",
      path.join(userDir(owner), id + ".jpg"),
    ]);
  }
  return saveAsset(owner, {
    id,
    name,
    type: video ? "video" : "audio",
    url: `/media/${id}${ext}`,
    thumbnail,
    duration: d,
    hasAudio: !!audio,
    width: video?.width,
    height: video?.height,
  });
}
const upload = multer({
  dest: path.join(DATA, "uploads"),
  limits: { fileSize: 500 * 1024 * 1024, files: 1 },
});
const transfers = new Map();
const chunkBytes = 512 * 1024;
app.post(
  "/api/uploads",
  asyncRoute(async (req, res) => {
    const input = z
      .object({
        name: z.string().min(1).max(200),
        size: z
          .number()
          .int()
          .positive()
          .max(500 * 1024 * 1024),
      })
      .parse(req.body);
    if (
      [...transfers.values()].filter((x) => x.owner === req.owner).length >= 2
    )
      return res
        .status(429)
        .json({ error: "진행 중인 업로드를 먼저 마쳐 주세요." });
    const id = randomUUID(),
      file = path.join(DATA, "uploads", id + ".part");
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, Buffer.alloc(0));
    const entry = {
      ...input,
      owner: req.owner,
      file,
      offset: 0,
      busy: false,
      finishing: false,
    };
    transfers.set(id, entry);
    entry.timer = setTimeout(() => {
      if (!entry.finishing) {
        transfers.delete(id);
        void fs.rm(file, { force: true }).catch(() => {});
      }
    }, 3600000);
    entry.timer.unref();
    res.status(201).json({ id, chunkBytes });
  }),
);
app.put(
  "/api/uploads/:id",
  express.raw({ type: "application/octet-stream", limit: chunkBytes }),
  asyncRoute(async (req, res) => {
    const entry = transfers.get(req.params.id);
    if (!entry || entry.owner !== req.owner)
      return res.status(404).json({ error: "업로드를 찾을 수 없습니다." });
    if (entry.busy || entry.finishing)
      return res
        .status(409)
        .json({ error: "이전 전송이 완료되기를 기다려 주세요." });
    const offset = Number(req.get("x-upload-offset"));
    if (
      !req.get("x-upload-offset") ||
      !Number.isInteger(offset) ||
      offset !== entry.offset
    )
      return res
        .status(409)
        .json({ error: "전송 순서가 맞지 않습니다. 다시 업로드하세요." });
    if (
      !Buffer.isBuffer(req.body) ||
      !req.body.length ||
      entry.offset + req.body.length > entry.size
    )
      return res
        .status(400)
        .json({ error: "파일 크기와 전송 데이터를 확인하세요." });
    entry.busy = true;
    try {
      await fs.appendFile(entry.file, req.body);
      entry.offset += req.body.length;
      res.json({ received: entry.offset });
    } finally {
      entry.busy = false;
    }
  }),
);
app.post(
  "/api/uploads/:id/complete",
  asyncRoute(async (req, res) => {
    const entry = transfers.get(req.params.id);
    if (!entry || entry.owner !== req.owner)
      return res.status(404).json({ error: "업로드를 찾을 수 없습니다." });
    if (entry.busy || entry.finishing || entry.offset !== entry.size)
      return res
        .status(409)
        .json({ error: "파일 전송이 아직 완료되지 않았습니다." });
    const job = newJob(req.owner, "import", async () => {
      try {
        return { asset: await ingest(req.owner, entry.file, entry.name) };
      } finally {
        clearTimeout(entry.timer);
        transfers.delete(req.params.id);
        await fs.rm(entry.file, { force: true });
      }
    });
    entry.finishing = true;
    res.status(202).json(publicJob(job));
  }),
);
app.delete(
  "/api/uploads/:id",
  asyncRoute(async (req, res) => {
    const entry = transfers.get(req.params.id);
    if (!entry || entry.owner !== req.owner)
      return res.status(404).json({ error: "업로드를 찾을 수 없습니다." });
    if (entry.finishing || entry.busy)
      return res.status(409).json({ error: "파일을 처리 중입니다." });
    clearTimeout(entry.timer);
    transfers.delete(req.params.id);
    await fs.rm(entry.file, { force: true });
    res.json({ ok: true });
  }),
);
app.post(
  "/api/assets",
  upload.single("file"),
  asyncRoute(async (req, res) => {
    if (!req.file)
      return res.status(400).json({ error: "파일을 선택해 주세요." });
    try {
      res.json(
        await ingest(
          req.owner,
          req.file.path,
          decodeFilename(req.file.originalname),
        ),
      );
    } finally {
      await fs.unlink(req.file.path).catch(() => {});
    }
  }),
);
app.get(
  "/api/assets",
  asyncRoute(async (req, res) => res.json(await assetsFor(req.owner))),
);
app.get(
  "/media/:name",
  asyncRoute(async (req, res) => {
    if (!/^[\w-]+\.(mp4|jpg|m4a|mp3|wav)$/.test(req.params.name))
      return res.status(404).json({ error: "요청한 자료를 찾을 수 없습니다." });
    // The authenticated media directory lives beneath .data; only this validated
    // filename in the owner's directory is allowed through Express's dotfile guard.
    res.sendFile(path.join(userDir(req.owner), req.params.name), {
      dotfiles: "allow",
    });
  }),
);
async function availableModule(name) {
  try {
    await run(PYTHON, ["-c", `import ${name}`], { timeout: 20000 });
    return true;
  } catch {
    return false;
  }
}
let features = {
  tts: await availableModule("edge_tts"),
  demucs: await availableModule("demucs"),
};
app.get(
  "/api/status",
  asyncRoute(async (req, res) => {
    const conn = connections.get(req.owner) || {};
    res.json({
      ffmpeg: true,
      tts: features.tts,
      demucs: features.demucs,
      bandit: {
        installed: existsSync(
          path.join(ROOT, ".data/vendor/bandit/inference.py"),
        ),
        ready: existsSync(
          path.join(ROOT, ".data/models/bandit/checkpoint.json"),
        ),
        reason: existsSync(
          path.join(ROOT, ".data/models/bandit/checkpoint.json"),
        )
          ? "로컬 DnR 모델 · 실행 시 무결성 검증"
          : "공식 DnR 가중치 설치 필요",
      },
      codex:
        !!(conn.codexKey || process.env.CODEX_API_KEY) ||
        (await codexLogin.connected(req.owner)),
      codexAuth:
        conn.codexKey || process.env.CODEX_API_KEY
          ? "api-key"
          : (await codexLogin.connected(req.owner))
            ? "chatgpt"
            : null,
      gatewayConfigured: !!process.env.PLUGIN_GATEWAY_URL,
      plugins: conn.plugins || [],
    });
  }),
);
app.post(
  "/api/connections/codex",
  asyncRoute(async (req, res) => {
    const { key } = z
      .object({ key: z.string().min(20).max(500) })
      .parse(req.body);
    const reply = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(20000),
    });
    if (!reply.ok)
      return res.status(400).json({
        error:
          "Codex API 키를 확인할 수 없습니다. 연결 권한과 네트워크를 확인해 주세요.",
      });
    connections.set(req.owner, {
      ...connections.get(req.owner),
      codexKey: key,
    });
    res.json({ ok: true });
  }),
);
async function gateway(owner, route, body) {
  const base = process.env.PLUGIN_GATEWAY_URL;
  if (!base) throw new Error("서버에 PLUGIN_GATEWAY_URL을 설정해 주세요.");
  const url = new URL(base);
  if (
    url.protocol !== "https:" &&
    !(
      process.env.MOA_ALLOW_LOCAL_GATEWAY === "1" &&
      ["localhost", "127.0.0.1"].includes(url.hostname)
    )
  )
    throw new Error("플러그인 게이트웨이는 HTTPS를 사용해야 합니다.");
  const token = connections.get(owner)?.gatewayToken;
  if (!token) throw new Error("플러그인 연결이 필요합니다.");
  const response = await fetch(new URL(route, url), {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok)
    throw new Error(`플러그인 서버 요청이 실패했습니다 (${response.status}).`);
  return response.json();
}
app.post(
  "/api/connections/gateway",
  asyncRoute(async (req, res) => {
    const { token } = z
      .object({ token: z.string().min(1).max(2000) })
      .parse(req.body);
    const old = connections.get(req.owner) || {};
    connections.set(req.owner, { ...old, gatewayToken: token });
    try {
      const manifest = await gateway(req.owner, "/v1/capabilities");
      const plugins = z
        .array(
          z.object({
            id: z.string().regex(/^[a-zA-Z0-9_-]+$/),
            name: z.string().max(100),
            description: z.string().max(200),
            capabilities: z.array(
              z.enum([
                "video-generation",
                "image-generation",
                "tts",
                "sound-effects",
                "audio-separation",
              ]),
            ),
            modes: z.array(z.enum(["f2f", "omni"])).optional(),
            stems: z.array(z.string()).optional(),
          }),
        )
        .parse(manifest.plugins);
      connections.set(req.owner, {
        ...old,
        gatewayToken: token,
        plugins: plugins.map((p) => ({ ...p, connected: true })),
      });
      res.json({ ok: true });
    } catch (e) {
      connections.set(req.owner, old);
      throw e;
    }
  }),
);
app.delete(
  "/api/connections",
  asyncRoute(async (req, res) => {
    connections.delete(req.owner);
    accountApps.clear(req.owner);
    clearEditorInventory(codexLogin.home(req.owner));
    await codexTasks.cancelAll(req.owner);
    await codexLogin.disconnect(req.owner);
    res.json({ ok: true });
  }),
);
function newJob(owner, type, task) {
  if (
    [...jobs.values()].filter((j) => ["queued", "running"].includes(j.status))
      .length >= Number(process.env.MOA_MAX_JOBS || 2)
  ) {
    const error = new Error(
      "서버가 다른 작업을 처리 중입니다. 잠시 후 다시 시도해 주세요.",
    );
    error.status = 429;
    throw error;
  }
  if (
    [...jobs.values()].some(
      (j) => j.owner === owner && ["queued", "running"].includes(j.status),
    )
  )
    throw new Error("진행 중인 작업이 끝난 후 다시 시도해 주세요.");
  const job = {
    id: randomUUID(),
    owner,
    type,
    status: "queued",
    progress: 0,
    created: Date.now(),
  };
  jobs.set(job.id, job);
  queueMicrotask(async () => {
    job.status = "running";
    try {
      job.result = await task(job);
      job.status = "completed";
      job.progress = 100;
    } catch (error) {
      job.status = "failed";
      job.error = error.message;
    }
    setTimeout(() => jobs.delete(job.id), 3600000).unref();
  });
  return job;
}
const publicJob = ({ owner, ...job }) => job;
app.get("/api/jobs/:id", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job || job.owner !== req.owner)
    return res.status(404).json({ error: "요청한 자료를 찾을 수 없습니다." });
  res.json(publicJob(job));
});
async function exportProject(owner, project, job) {
  const assets = await assetsFor(owner);
  validateAssetBounds(project, assets);
  const work = path.join(userDir(owner), "render-" + job.id);
  await fs.mkdir(work, { recursive: true });
  const [w, h] =
    project.ratio === "9:16"
      ? [720, 1280]
      : project.ratio === "1:1"
        ? [1080, 1080]
        : [1280, 720];
  try {
    for (let i = 0; i < project.clips.length; i++) {
      const c = project.clips[i],
        a = assets.find((a) => a.id === c.assetId),
        d = (c.out - c.in) / c.speed;
      const filters = `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24,setpts=PTS/${c.speed},eq=brightness=${c.brightness}:saturation=${c.saturation}`;
      const args = [
        "-y",
        "-ss",
        String(c.in),
        "-t",
        String(c.out - c.in),
        "-i",
        assetPath(owner, a),
      ];
      if (!a.hasAudio)
        args.push("-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo");
      args.push(
        "-vf",
        filters,
        "-map",
        "0:v:0",
        "-map",
        a.hasAudio ? "0:a:0" : "1:a:0",
        "-af",
        `${tempoFilters(c.speed)},volume=${c.volume},aformat=sample_rates=48000:channel_layouts=stereo`,
        "-t",
        String(d),
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-threads",
        "2",
        "-crf",
        "21",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-ar",
        "48000",
        path.join(work, `${i}.mp4`),
      );
      await run("ffmpeg", args, { timeout: 600000 });
      job.progress = Math.round(((i + 1) / project.clips.length) * 65);
    }
    await fs.writeFile(
      path.join(work, "concat.txt"),
      project.clips.map((_, i) => `file '${i}.mp4'`).join("\n"),
    );
    await run(
      "ffmpeg",
      [
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        path.join(work, "concat.txt"),
        "-c",
        "copy",
        path.join(work, "joined.mp4"),
      ],
      { timeout: 600000 },
    );
    const args = ["-y", "-i", path.join(work, "joined.mp4")];
    for (const a of project.audio)
      args.push(
        "-t",
        String(a.duration),
        "-i",
        assetPath(
          owner,
          assets.find((x) => x.id === a.assetId),
        ),
      );
    let filter = "",
      audioLabels = "[0:a]";
    project.audio.forEach((a, i) => {
      filter += `[${i + 1}:a]volume=${a.volume},adelay=${Math.round(a.start * 1000)}:all=1[a${i}];`;
      audioLabels += `[a${i}]`;
    });
    filter += `${audioLabels}amix=inputs=${project.audio.length + 1}:duration=first:normalize=0${project.normalize ? ",loudnorm=I=-16:TP=-1.5:LRA=11" : ""}[outa]`;
    const titles = [];
    for (let i = 0; i < project.titles.length; i++) {
      const t = project.titles[i];
      if (t.end <= t.start) continue;
      const textfile = path.join(work, `title${i}.txt`);
      await fs.writeFile(textfile, t.text);
      titles.push(
        `drawtext=fontfile=/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc:textfile='${textfile}':expansion=none:fontsize=${Math.round(w * 0.047)}:fontcolor=white:shadowcolor=black@0.4:shadowx=2:shadowy=2:x=(w-tw)/2:y=h*0.78:enable='between(t,${t.start},${t.end})'`,
      );
    }
    if (titles.length) filter += `;[0:v]${titles.join(",")}[outv]`;
    const id = randomUUID(),
      out = path.join(userDir(owner), id + ".mp4");
    args.push(
      "-filter_complex",
      filter,
      "-map",
      titles.length ? "[outv]" : "0:v",
      "-map",
      "[outa]",
      "-t",
      String(duration(project)),
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-threads",
      "2",
      "-c:a",
      "aac",
      "-movflags",
      "+faststart",
      out,
    );
    job.progress = 80;
    await run("ffmpeg", args, { timeout: 600000 });
    return {
      url: `/media/${id}.mp4`,
      name: project.name + ".mp4",
      duration: duration(project),
    };
  } finally {
    await fs.rm(work, { recursive: true, force: true });
  }
}
app.post(
  "/api/export",
  asyncRoute(async (req, res) => {
    const project = projectSchema.parse(req.body);
    validateAssetBounds(project, await assetsFor(req.owner));
    const job = newJob(req.owner, "export", (j) =>
      exportProject(req.owner, project, j),
    );
    res.status(202).json(publicJob(job));
  }),
);
app.get("/api/styles", (req, res) => res.json(styles));
app.post(
  "/api/audio/separate-local",
  asyncRoute(async (req, res) => {
    const { assetId } = z.object({ assetId: z.string() }).parse(req.body),
      asset = await getAsset(req.owner, assetId);
    if (!asset.hasAudio)
      throw new Error("이 영상에는 분리할 오디오가 없습니다.");
    if (!existsSync(path.join(ROOT, ".data/models/bandit/checkpoint.json")))
      return res.status(503).json({
        error:
          "BandIt DnR 공식 가중치를 설치해야 합니다. README의 로컬 음원 분리 설정을 참고하세요.",
      });
    const job = newJob(req.owner, "separate-local", async (j) => {
      const work = path.join(userDir(req.owner), "bandit-" + j.id);
      await fs.mkdir(work, { recursive: true });
      try {
        const input = path.join(work, "input.wav");
        await run(
          "ffmpeg",
          [
            "-y",
            "-i",
            assetPath(req.owner, asset),
            "-vn",
            "-ar",
            "44100",
            "-ac",
            "2",
            input,
          ],
          { timeout: 600000 },
        );
        j.progress = 10;
        await run(
          PYTHON,
          [
            path.join(ROOT, "scripts/bandit-runner.py"),
            "--input",
            input,
            "--output",
            path.join(work, "out"),
          ],
          { timeout: 1800000 },
        );
        j.progress = 85;
        const outputs = [];
        for (const [stem, label] of [
          ["speech", "보이스"],
          ["music", "BGM"],
          ["effects", "효과음"],
        ])
          outputs.push({
            ...(await ingest(
              req.owner,
              path.join(work, "out", stem + ".wav"),
              asset.name + " · " + label,
            )),
            stem,
          });
        return { assets: outputs, engine: "BandIt DnR", generationCredits: 0 };
      } finally {
        await fs.rm(work, { recursive: true, force: true });
      }
    });
    res.status(202).json(publicJob(job));
  }),
);
app.post(
  "/api/auto-edit",
  asyncRoute(async (req, res) => {
    const input = autoSchema.parse(req.body),
      project = projectSchema.parse(input.project),
      assets = await assetsFor(req.owner);
    validateAssetBounds(project, assets);
    const style = styles.find((s) => s.id === input.style),
      key = connections.get(req.owner)?.codexKey || process.env.CODEX_API_KEY;
    if (
      input.engine === "codex" &&
      !key &&
      !(await codexLogin.connected(req.owner))
    )
      return res.status(409).json({
        error: "Codex를 연결하거나 크레딧 없는 로컬 자동편집을 선택해 주세요.",
      });
    const job = newJob(req.owner, "auto-edit", async (job) => {
      const analysis = [],
        frames = [],
        work = path.join(userDir(req.owner), "auto-" + job.id);
      await fs.mkdir(work, { recursive: true });
      try {
        for (let i = 0; i < project.clips.length; i++) {
          const c = project.clips[i],
            a = assets.find((a) => a.id === c.assetId);
          let silences = [];
          if (input.removeSilence && a.hasAudio) {
            const { stderr } = await run(
              "ffmpeg",
              [
                "-hide_banner",
                "-i",
                assetPath(req.owner, a),
                "-af",
                "silencedetect=noise=-35dB:d=0.5",
                "-vn",
                "-f",
                "null",
                "-",
              ],
              { timeout: 600000 },
            );
            silences = silenceIntervals(stderr, a.duration);
          }
          analysis.push({
            clipId: c.id,
            name: c.name,
            in: c.in,
            out: c.out,
            duration: a.duration,
            hasAudio: a.hasAudio,
            silences,
          });
          if (input.engine === "codex" && i < 18) {
            const frame = path.join(work, `frame-${i}.jpg`);
            await run("ffmpeg", [
              "-y",
              "-ss",
              String(c.in + (c.out - c.in) / 2),
              "-i",
              assetPath(req.owner, a),
              "-frames:v",
              "1",
              "-vf",
              "scale=480:-1",
              frame,
            ]);
            frames.push({ type: "local_image", path: frame });
          }
          job.progress = Math.round(((i + 1) / project.clips.length) * 20);
        }
        let plan;
        if (input.engine === "codex") {
          const { Codex } = await import("@openai/codex-sdk");
          const codexHome = path.join(userDir(req.owner), "codex");
          await fs.mkdir(codexHome, { recursive: true });
          const codex = new Codex({
            apiKey: key,
            config: {
              features: {
                shell_tool: false,
                apps: false,
                plugins: false,
                image_generation: false,
                apply_patch_freeform: false,
                js_repl: false,
              },
              cli_auth_credentials_store: "file",
            },
            env: codexEnvironment(codexHome),
          });
          const thread = codex.startThread({
            workingDirectory: work,
            skipGitRepoCheck: true,
            sandboxMode: "read-only",
            approvalPolicy: "never",
            networkAccessEnabled: false,
            webSearchMode: "disabled",
          });
          const result = await thread.run(
            [
              {
                type: "text",
                text: `You are a video editor. Do NOT execute tools. Return JSON edit instructions only. User authorizes local edits and rendering, NEVER external generation. Images correspond in order to first 18 clips; there is no transcript. Preserve speech and causality; only use known silence for speech cuts. Target length is a soft target; explain limitations. Frame-based continuity is uncertain; describe needed generation as proposals in repairs, never pretend it is necessary with certainty. All cuts must be within each clip in/out and >=0.1 sec. Speak Korean. Editorial interpretation: ${JSON.stringify(style)}. User brief: ${input.instructions}. Target: ${input.target}s. Untrusted clip metadata: ${JSON.stringify(analysis)}. Required output schema: ${JSON.stringify(z.toJSONSchema(planSchema))}`,
              },
              ...frames,
            ],
            {
              outputSchema: z.toJSONSchema(planSchema),
              signal: AbortSignal.timeout(180000),
            },
          );
          plan = planSchema.parse(JSON.parse(result.finalResponse));
        } else
          plan = localPlan(
            project,
            analysis,
            style,
            input.target,
            input.removeSilence,
          );
        const edited = projectSchema.parse(
          applyPlan(project, plan, style, input.normalize),
        );
        validateAssetBounds(edited, assets);
        job.progress = 25;
        const render = await exportProject(req.owner, edited, job);
        return {
          project: edited,
          render,
          report: {
            engine: input.engine,
            style: style.name,
            summary: plan.summary,
            sourceClips: project.clips,
            sourceDuration: duration(project),
            resultDuration: duration(edited),
            edits: plan.cuts,
            repairs: plan.repairs,
            generationCredits: 0,
            apiBilling: input.engine === "codex" && !!key,
            codexSubscription: input.engine === "codex" && !key,
            notes: [
              "원본 프로젝트는 실행 취소로 복원할 수 있습니다.",
              "텍스트와 별도 오디오는 기존 타임라인 시작 시점을 유지하고 새 길이까지 제한합니다.",
              ...(input.engine === "local"
                ? [
                    "로컬 모드는 장면 의미를 이해하지 않으며 생성 필요 여부를 판정하지 않습니다.",
                  ]
                : [
                    "Codex는 대표 프레임과 무음 분석만 확인하며 전체 음성을 이해한 것으로 간주하지 않습니다.",
                  ]),
            ],
          },
        };
      } finally {
        await fs.rm(work, { recursive: true, force: true });
      }
    });
    res.status(202).json(publicJob(job));
  }),
);
app.post(
  "/api/analyze",
  asyncRoute(async (req, res) => {
    const { assetId, type } = z
        .object({ assetId: z.string(), type: z.enum(["silence", "scenes"]) })
        .parse(req.body),
      a = await getAsset(req.owner, assetId);
    if (type === "silence" && !a.hasAudio)
      return res.json({
        type,
        ranges: [],
        message: "이 영상에는 오디오가 없어 무음을 분석할 수 없습니다.",
      });
    const job = newJob(req.owner, "analyze", async () => {
      const { stderr } = await run(
        "ffmpeg",
        [
          "-hide_banner",
          "-i",
          assetPath(req.owner, a),
          ...(type === "silence"
            ? ["-af", "silencedetect=noise=-35dB:d=0.5", "-vn"]
            : ["-vf", "select='gt(scene,0.32)',showinfo", "-an"]),
          "-f",
          "null",
          "-",
        ],
        { timeout: 600000 },
      );
      if (type === "silence") {
        const silence = silenceIntervals(stderr, a.duration);
        return {
          type,
          silence,
          ranges: keepRanges(a.duration, silence),
          assetId: a.id,
        };
      }
      return {
        type,
        cuts: [...stderr.matchAll(/pts_time:([\d.]+)/g)].map((m) =>
          Number(m[1]),
        ),
        assetId: a.id,
      };
    });
    res.status(202).json(publicJob(job));
  }),
);
app.post(
  "/api/tts",
  asyncRoute(async (req, res) => {
    const { text, voice, rate } = z
      .object({
        text: z.string().min(1).max(3000),
        voice: z.enum([
          "ko-KR-SunHiNeural",
          "ko-KR-InJoonNeural",
          "en-US-JennyNeural",
        ]),
        rate: z.number().int().min(-30).max(30),
      })
      .parse(req.body);
    if (!features.tts)
      return res.status(503).json({
        error:
          "Microsoft TTS 런타임을 설치해 주세요. README의 TTS 설정을 참고하세요.",
      });
    const job = newJob(req.owner, "tts", async () => {
      await fs.mkdir(userDir(req.owner), { recursive: true });
      const temp = path.join(userDir(req.owner), randomUUID() + ".mp3");
      try {
        await run(
          PYTHON,
          [
            path.join(ROOT, "scripts/tts.py"),
            "--text",
            text,
            "--voice",
            voice,
            `--rate=${rate >= 0 ? "+" : ""}${rate}%`,
            "--output",
            temp,
          ],
          { timeout: 120000 },
        );
        return {
          asset: await ingest(
            req.owner,
            temp,
            `내레이션 · ${text.slice(0, 18)}`,
          ),
        };
      } catch {
        throw new Error(
          "Microsoft 음성 서비스에 연결하지 못했습니다. 네트워크를 확인하거나 연결된 TTS 플러그인을 사용해 주세요.",
        );
      } finally {
        await fs.unlink(temp).catch(() => {});
      }
    });
    res.status(202).json(publicJob(job));
  }),
);
app.post(
  "/api/audio/extract",
  asyncRoute(async (req, res) => {
    const { assetId } = z.object({ assetId: z.string() }).parse(req.body),
      a = await getAsset(req.owner, assetId);
    if (!a.hasAudio) throw new Error("이 영상에는 오디오 트랙이 없습니다.");
    const job = newJob(req.owner, "extract", async () => {
      const temp = path.join(userDir(req.owner), randomUUID() + ".wav");
      await fs.mkdir(userDir(req.owner), { recursive: true });
      try {
        await run("ffmpeg", ["-y", "-i", assetPath(req.owner, a), "-vn", temp]);
        return {
          asset: await ingest(req.owner, temp, a.name + " · 원본 오디오"),
        };
      } finally {
        await fs.unlink(temp).catch(() => {});
      }
    });
    res.status(202).json(publicJob(job));
  }),
);

// Only the server-held, immutable proposal is executed after explicit approval.
const proposals = new Map();
const proposalSchema = z.object({
  pluginId: z.string(),
  capability: z.enum([
    "video-generation",
    "image-generation",
    "sound-effects",
    "audio-separation",
    "tts",
  ]),
  mode: z.enum(["f2f", "omni"]).optional(),
  prompt: z.string().max(3000),
  assetIds: z.array(z.string()).max(6),
  frameRefs: z
    .array(z.object({ assetId: z.string(), time: z.number().min(0) }))
    .length(2)
    .optional(),
  duration: z.number().min(1).max(10).default(3),
  boundary: z
    .object({ leftClipId: z.string(), rightClipId: z.string() })
    .optional(),
});
app.post(
  "/api/proposals",
  asyncRoute(async (req, res) => {
    const input = proposalSchema.parse(req.body),
      plugin = connections
        .get(req.owner)
        ?.plugins?.find((p) => p.id === input.pluginId);
    if (!plugin || !plugin.capabilities.includes(input.capability))
      throw new Error("이 기능을 지원하는 플러그인을 연결해 주세요.");
    if (input.mode && !plugin.modes?.includes(input.mode))
      throw new Error("플러그인이 이 생성 방식을 지원하지 않습니다.");
    if (
      input.capability === "video-generation" &&
      input.mode === "f2f" &&
      input.assetIds.length !== 2
    )
      throw new Error("F2F에는 앞뒤 두 영상이 필요합니다.");
    if (
      input.capability === "audio-separation" &&
      !["voice", "sfx", "bgm"].every((s) => plugin.stems?.includes(s))
    )
      throw new Error(
        "이 플러그인은 보이스·효과음·BGM 3종 분리를 지원하지 않습니다.",
      );
    const assets = await Promise.all(
      input.assetIds.map((id) => getAsset(req.owner, id)),
    );
    if (input.mode === "f2f") {
      if (
        !input.frameRefs ||
        input.frameRefs.some(
          (f, i) =>
            f.assetId !== input.assetIds[i] || f.time >= assets[i].duration,
        )
      )
        throw new Error("F2F에 사용할 정확한 두 프레임을 지정해 주세요.");
    }
    const quote = await gateway(req.owner, "/v1/quote", {
      ...input,
      assets: assets.map((a) => ({
        id: a.id,
        name: a.name,
        duration: a.duration,
      })),
    });
    const pricing = z
      .object({
        id: z.string().min(1),
        cost: z.number().nonnegative(),
        currency: z.string().max(10),
      })
      .parse(quote);
    const proposal = {
      id: randomUUID(),
      owner: req.owner,
      status: "pending",
      input,
      quote: pricing,
      assets: assets.map((a) => ({ id: a.id, name: a.name })),
      expiresAt: Date.now() + 10 * 60000,
    };
    proposals.set(proposal.id, proposal);
    res.json({ ...proposal, owner: undefined });
  }),
);
async function executeProposal(owner, p) {
  const assets = [];
  for (const id of p.input.assetIds) {
    const a = await getAsset(owner, id);
    const file = assetPath(owner, a);
    if (p.input.mode === "f2f") {
      const frame = p.input.frameRefs[assets.length],
        temp = path.join(userDir(owner), randomUUID() + ".jpg");
      await fs.mkdir(userDir(owner), { recursive: true });
      try {
        await run("ffmpeg", [
          "-y",
          "-ss",
          String(frame.time),
          "-i",
          file,
          "-frames:v",
          "1",
          "-vf",
          "scale=1280:-1",
          temp,
        ]);
        assets.push({
          id,
          name: a.name + " · " + frame.time.toFixed(2) + "s",
          mime: "image/jpeg",
          data: (await fs.readFile(temp)).toString("base64"),
          position: assets.length === 0 ? "first" : "last",
        });
      } finally {
        await fs.unlink(temp).catch(() => {});
      }
      continue;
    }
    const stat = await fs.stat(file);
    if (stat.size > 50 * 1024 * 1024)
      throw new Error("플러그인 전송은 소스당 50MB까지 지원합니다.");
    assets.push({
      id,
      name: a.name,
      mime: a.type === "audio" ? "audio/mp4" : "video/mp4",
      data: (await fs.readFile(file)).toString("base64"),
    });
  }
  const remote = await gateway(owner, "/v1/jobs", {
    ...p.input,
    quoteId: p.quote.id,
    idempotencyKey: p.id,
    assets,
  });
  const id = z
    .string()
    .regex(/^[a-zA-Z0-9_-]+$/)
    .parse(remote.id);
  let result = remote;
  for (
    let i = 0;
    i < 120 && !["completed", "failed"].includes(result.status);
    i++
  ) {
    await new Promise((r) => setTimeout(r, 3000));
    result = await gateway(owner, `/v1/jobs/${id}`);
  }
  if (result.status !== "completed")
    throw new Error(
      result.status === "failed"
        ? "플러그인 생성에 실패했습니다."
        : "플러그인 작업 시간이 초과되었습니다. 제공업체 작업 내역을 확인해 주세요.",
    );
  const outputs = z
    .array(
      z.object({
        name: z.string().max(200),
        data: z.string().max(80_000_000),
        stem: z.string().optional(),
      }),
    )
    .min(1)
    .max(6)
    .parse(result.outputs);
  const imported = [];
  for (const output of outputs) {
    await fs.mkdir(userDir(owner), { recursive: true });
    const temp = path.join(userDir(owner), randomUUID() + ".bin");
    try {
      await fs.writeFile(temp, Buffer.from(output.data, "base64"));
      imported.push({
        ...(await ingest(owner, temp, output.name)),
        stem: output.stem,
      });
    } finally {
      await fs.unlink(temp).catch(() => {});
    }
  }
  return { assets: imported, boundary: p.input.boundary };
}
app.post(
  "/api/proposals/:id/approve",
  asyncRoute(async (req, res) => {
    const p = proposals.get(req.params.id);
    if (!p || p.owner !== req.owner)
      return res.status(404).json({ error: "요청한 자료를 찾을 수 없습니다." });
    if (p.status !== "pending" || p.expiresAt < Date.now())
      return res.status(409).json({
        error: "만료되었거나 이미 처리된 제안입니다. 다시 견적을 받아 주세요.",
      });
    if (req.body.approved !== true)
      return res
        .status(400)
        .json({ error: "명시적인 사용자 승인이 필요합니다." });
    const job = newJob(req.owner, p.input.capability, () =>
      executeProposal(req.owner, p),
    );
    p.status = "approved";
    res.status(202).json(publicJob(job));
  }),
);
app.post("/api/proposals/:id/reject", (req, res) => {
  const p = proposals.get(req.params.id);
  if (!p || p.owner !== req.owner)
    return res.status(404).json({ error: "요청한 자료를 찾을 수 없습니다." });
  if (p.status !== "pending")
    return res.status(409).json({ error: "이미 처리된 제안입니다." });
  p.status = "rejected";
  res.json({ ok: true });
});
const batches = new Map();
app.post(
  "/api/proposal-batches",
  asyncRoute(async (req, res) => {
    const { ids } = z
      .object({ ids: z.array(z.string()).min(1).max(12) })
      .parse(req.body);
    if (new Set(ids).size !== ids.length)
      throw new Error("중복된 작업이 있습니다.");
    const items = ids.map((id) => proposals.get(id));
    if (
      items.some(
        (p) =>
          !p ||
          p.owner !== req.owner ||
          p.status !== "pending" ||
          p.expiresAt < Date.now(),
      )
    )
      return res.status(409).json({
        error: "만료된 작업이 있습니다. 전체 견적을 다시 확인해 주세요.",
      });
    const totals = {};
    for (const p of items)
      totals[p.quote.currency] = (totals[p.quote.currency] || 0) + p.quote.cost;
    const batch = {
      id: randomUUID(),
      owner: req.owner,
      ids,
      totals,
      status: "pending",
      expiresAt: Math.min(...items.map((p) => p.expiresAt)),
    };
    batches.set(batch.id, batch);
    res.json({
      ...batch,
      owner: undefined,
      items: items.map((p) => ({ ...p, owner: undefined })),
    });
  }),
);
app.post(
  "/api/proposal-batches/:id/approve",
  asyncRoute(async (req, res) => {
    const batch = batches.get(req.params.id);
    if (!batch || batch.owner !== req.owner)
      return res.status(404).json({ error: "요청한 자료를 찾을 수 없습니다." });
    const items = batch.ids.map((id) => proposals.get(id));
    if (req.body.approved !== true)
      return res
        .status(400)
        .json({ error: "전체 작업에 대한 명시적 승인이 필요합니다." });
    if (
      batch.status !== "pending" ||
      batch.expiresAt < Date.now() ||
      items.some((p) => p.status !== "pending")
    )
      return res.status(409).json({ error: "만료되었거나 처리된 견적입니다." });
    const job = newJob(req.owner, "generation-batch", async (j) => {
      const results = [];
      for (let i = 0; i < items.length; i++) {
        const p = items[i];
        try {
          const result = await executeProposal(req.owner, p);
          results.push({ id: p.id, status: "completed", ...result });
        } catch (e) {
          results.push({ id: p.id, status: "failed", error: e.message });
          for (const rest of items.slice(i + 1)) {
            rest.status = "not-started";
            results.push({ id: rest.id, status: "not-started" });
          }
          break;
        }
        j.progress = Math.round(((i + 1) / items.length) * 100);
      }
      return { results, assets: results.flatMap((r) => r.assets || []) };
    });
    batch.status = "approved";
    for (const p of items) p.status = "approved";
    res.status(202).json(publicJob(job));
  }),
);
app.post(
  "/api/codex",
  asyncRoute(async (req, res) => {
    const { prompt, project } = z
      .object({ prompt: z.string().min(1).max(2000), project: projectSchema })
      .parse(req.body);
    const apiKey =
      connections.get(req.owner)?.codexKey || process.env.CODEX_API_KEY;
    if (!apiKey && !(await codexLogin.connected(req.owner)))
      return res.status(409).json({
        error: "플러그인에서 ChatGPT 로그인으로 Codex를 연결해 주세요.",
      });
    const job = newJob(req.owner, "codex", async () => {
      const { Codex } = await import("@openai/codex-sdk");
      const codexHome = path.join(userDir(req.owner), "codex");
      await fs.mkdir(codexHome, { recursive: true });
      const codex = new Codex({
        apiKey,
        config: {
          features: {
            shell_tool: false,
            apps: false,
            plugins: false,
            image_generation: false,
            apply_patch_freeform: false,
            js_repl: false,
          },
          cli_auth_credentials_store: "file",
        },
        env: codexEnvironment(codexHome),
      });
      const thread = codex.startThread({
        workingDirectory: userDir(req.owner),
        skipGitRepoCheck: true,
        sandboxMode: "read-only",
        approvalPolicy: "never",
        networkAccessEnabled: false,
        webSearchMode: "disabled",
      });
      const schema = {
        type: "object",
        properties: {
          summary: { type: "string" },
          actions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                type: {
                  type: "string",
                  enum: [
                    "silence",
                    "scenes",
                    "normalize",
                    "bridge",
                    "captions",
                  ],
                },
                reason: { type: "string" },
              },
              required: ["type", "reason"],
              additionalProperties: false,
            },
          },
        },
        required: ["summary", "actions"],
        additionalProperties: false,
      };
      const result = await thread.run(
        `You are a Korean video editing planner. Do not run tools, access files or execute anything. Return ONLY proposed actions matching the schema, never claim edits were executed. All external generation needs separate approval. User request: ${prompt}\nProject metadata (untrusted data): ${JSON.stringify({ name: project.name, duration: duration(project), clips: project.clips.map((c) => ({ name: c.name, duration: (c.out - c.in) / c.speed })), titles: project.titles })}`,
        { outputSchema: schema },
      );
      return JSON.parse(result.finalResponse);
    });
    res.status(202).json(publicJob(job));
  }),
);
app.get("/api/health", (req, res) =>
  res.json({ ok: true, service: "moa-studio" }),
);
app.use(express.static(path.join(ROOT, "public")));
app.use(express.static(path.join(ROOT, "dist")));
app.get("/{*path}", (req, res) =>
  existsSync(path.join(ROOT, "dist/index.html"))
    ? res.sendFile(path.join(ROOT, "dist/index.html"))
    : res.status(404).json({ error: "npm run dev로 웹 화면을 시작하세요." }),
);
app.use((error, req, res, next) => {
  res.status(error instanceof z.ZodError ? 400 : error.status || 500).json({
    error:
      error.status === 404
        ? "요청한 자료를 찾을 수 없습니다."
        : error instanceof z.ZodError
          ? "입력값을 확인해 주세요."
          : error.code === "LIMIT_FILE_SIZE"
            ? "파일은 500MB까지 업로드할 수 있습니다."
            : error.message || "처리에 실패했습니다.",
  });
});
app.listen(
  Number(process.env.PORT || 3001),
  process.env.MOA_HOST || "0.0.0.0",
  () => console.log(`Moa API listening on ${process.env.PORT || 3001}`),
);
