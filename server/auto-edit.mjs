import { randomUUID } from "node:crypto";
import { z } from "zod";
import { duration, keepRanges } from "./core.mjs";

export const autoSchema = z.object({
  project: z.any(),
  engine: z.enum(["local", "codex"]),
  style: z.enum(["none", "nolan", "spielberg", "bong", "wes"]),
  target: z.number().min(3).max(600),
  instructions: z.string().max(3000),
  removeSilence: z.boolean(),
  normalize: z.boolean(),
});
export const planSchema = z.object({
  summary: z.string(),
  cuts: z
    .array(
      z.object({
        clipId: z.string(),
        in: z.number().min(0),
        out: z.number().positive(),
        reason: z.string(),
      }),
    )
    .min(1)
    .max(100),
  repairs: z
    .array(
      z.object({
        type: z.enum(["video-generation", "image-generation", "sound-effects"]),
        afterClipId: z.string(),
        reason: z.string(),
        prompt: z.string(),
        mode: z.enum(["f2f", "omni"]),
        duration: z.number().min(1).max(10),
      }),
    )
    .max(12),
});

export function localPlan(project, analysis, style, target, removeSilence) {
  const targetRatio = Math.min(1, target / duration(project));
  const cuts = [];
  for (let i = 0; i < project.clips.length; i++) {
    const c = project.clips[i],
      a = analysis.find((a) => a.clipId === c.id),
      weight =
        style.pace[
          style.id === "nolan"
            ? Math.min(
                style.pace.length - 1,
                Math.floor(
                  (i / Math.max(1, project.clips.length)) * style.pace.length,
                ),
              )
            : i % style.pace.length
        ];
    const ranges =
      removeSilence && a?.silences?.length
        ? keepRanges(a.duration, a.silences)
            .map(([x, y]) => [Math.max(c.in, x), Math.min(c.out, y)])
            .filter(([x, y]) => y - x >= 0.2)
        : [[c.in, c.out]];
    // Do not cut words just to hit a duration. Tightening of voiced media is silence-only.
    for (const [start, end] of ranges) {
      const desired = a?.hasAudio
        ? end - start
        : Math.min(
            end - start,
            Math.max(
              0.35,
              (style.id === "wes"
                ? target / project.clips.length
                : (end - start) * targetRatio) * weight,
            ),
          );
      cuts.push({
        clipId: c.id,
        in: start,
        out: start + desired,
        reason: a?.hasAudio
          ? "대사를 보존하고 감지된 무음만 정리"
          : "요청 길이와 선택한 리듬에 맞춰 구간 정리",
      });
    }
  }
  if (!cuts.length)
    throw new Error(
      "전체 구간이 무음으로 감지되어 원본을 보존했습니다. 무음 정리를 끄고 다시 실행해 주세요.",
    );
  return {
    summary:
      "로컬 FFmpeg 분석 결과를 바탕으로 원본 순서와 대사를 보존해 1차 편집했습니다.",
    cuts,
    repairs: [],
  };
}
export function applyPlan(project, plan, style, normalize) {
  const clips = plan.cuts.map((c) => {
    const source = project.clips.find((s) => s.id === c.clipId);
    if (
      !source ||
      c.in < source.in - 0.001 ||
      c.out > source.out + 0.001 ||
      c.out - c.in < 0.1
    )
      throw new Error(
        "AI가 제안한 컷 범위가 원본 범위를 벗어났습니다. 원본은 보존됩니다.",
      );
    return {
      ...source,
      id: randomUUID(),
      in: c.in,
      out: c.out,
      saturation: Math.min(2, source.saturation * style.saturation),
      brightness: Math.max(
        -0.5,
        Math.min(0.5, source.brightness + style.brightness),
      ),
    };
  });
  const result = {
    ...project,
    name: project.name + " · 1차 편집",
    clips,
    normalize,
  };
  const d = duration(result);
  result.audio = project.audio
    .filter((a) => a.start < d)
    .map((a) => ({ ...a, duration: Math.min(a.duration, d - a.start) }));
  result.titles = project.titles
    .filter((t) => t.start < d)
    .map((t) => ({ ...t, end: Math.min(t.end, d) }));
  return result;
}
