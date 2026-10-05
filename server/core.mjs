import { z } from "zod";
import { spawn } from "node:child_process";

export function decodeFilename(name) {
  // Browsers send UTF-8 multipart filenames; Busboy may decode headers as Latin-1.
  if ([...name].some((character) => character.charCodeAt(0) > 255)) return name;
  const decoded = Buffer.from(name, 'latin1').toString('utf8');
  return decoded.includes('\ufffd') ? name : decoded;
}

export const clipSchema = z
  .object({
    id: z.string().max(100),
    assetId: z.string().max(100),
    name: z.string().max(200),
    in: z.number().min(0),
    out: z.number().positive(),
    speed: z.number().min(0.25).max(4),
    volume: z.number().min(0).max(2),
    brightness: z.number().min(-0.5).max(0.5),
    saturation: z.number().min(0).max(2),
  })
  .refine((c) => c.out - c.in >= 0.1, "클립은 0.1초 이상이어야 합니다.");
export const projectSchema = z.object({
  name: z.string().min(1).max(100),
  ratio: z.enum(["16:9", "9:16", "1:1"]),
  clips: z.array(clipSchema).min(1).max(100),
  audio: z
    .array(
      z.object({
        id: z.string(),
        assetId: z.string(),
        start: z.number().min(0),
        volume: z.number().min(0).max(2),
        duration: z.number().positive(),
      }),
    )
    .max(30),
  titles: z
    .array(
      z.object({
        id: z.string(),
        text: z.string().max(250),
        start: z.number().min(0),
        end: z.number().positive(),
      }),
    )
    .max(100),
  normalize: z.boolean(),
});

export function run(
  command,
  args,
  { timeout = 120000, maxOutput = 4_000_000, ...options } = {},
) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "",
      stderr = "",
      settled = false;
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(
        new Error(
          "처리 시간이 초과되었습니다. 더 짧은 클립으로 다시 시도해 주세요.",
        ),
      );
    }, timeout);
    function finish(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      error ? reject(error) : resolve({ stdout, stderr });
    }
    child.stdout.on("data", (b) => {
      stdout = (stdout + b).slice(-maxOutput);
    });
    child.stderr.on("data", (b) => {
      stderr = (stderr + b).slice(-maxOutput);
    });
    child.on("error", finish);
    child.on("close", (code) =>
      finish(
        code === 0
          ? null
          : new Error(`${command} 실패 (${code}): ${stderr.slice(-1800)}`),
      ),
    );
  });
}
export function duration(project) {
  return project.clips.reduce((s, c) => s + (c.out - c.in) / c.speed, 0);
}
export function silenceIntervals(log, total) {
  const intervals = [];
  let start = null;
  for (const match of log.matchAll(/silence_(start|end):\s*([\d.]+)/g)) {
    if (match[1] === "start") start = Number(match[2]);
    else if (start !== null) {
      intervals.push([start, Math.min(total, Number(match[2]))]);
      start = null;
    }
  }
  if (start !== null) intervals.push([start, total]);
  return intervals;
}
export function keepRanges(total, silences, padding = 0.12) {
  let cursor = 0;
  const ranges = [];
  for (const [a, b] of silences) {
    const end = Math.max(0, a + padding);
    if (end - cursor >= 0.15) ranges.push([cursor, end]);
    cursor = Math.min(total, b - padding);
  }
  if (total - cursor >= 0.15) ranges.push([cursor, total]);
  return ranges;
}
export function validateAssetBounds(project, assets) {
  for (const c of project.clips) {
    const a = assets.find((a) => a.id === c.assetId);
    if (!a || a.type === "audio")
      throw new Error("사용할 수 없는 영상 소스입니다.");
    if (c.out > a.duration + 0.05)
      throw new Error("클립 범위가 원본 길이를 초과합니다.");
  }
  for (const c of project.audio) {
    const a = assets.find((a) => a.id === c.assetId);
    if (!a || a.type !== "audio" || c.duration > a.duration + 0.05)
      throw new Error("사용할 수 없는 오디오 범위입니다.");
  }
  if (duration(project) > 600)
    throw new Error("현재 버전은 프로젝트당 최대 10분을 지원합니다.");
}
export function tempoFilters(speed) {
  const filters = [];
  while (speed > 2) {
    filters.push("atempo=2");
    speed /= 2;
  }
  while (speed < 0.5) {
    filters.push("atempo=0.5");
    speed /= 0.5;
  }
  filters.push(`atempo=${speed}`);
  return filters.join(",");
}
