// Explicit opt-in validation: synthetic text to free Microsoft Edge TTS and
// local BandIt inference. No Codex inference or paid provider calls.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { run } from "../server/core.mjs";
const base = process.env.MOA_TEST_URL || "http://127.0.0.1:3011";
if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(base).hostname))
  throw new Error("Audio validation requires a local disposable test server.");
const resultDir = path.resolve("test-results");
await fs.mkdir(resultDir, { recursive: true });
let cookie = "";
async function request(route, body) {
  const response = await fetch(base + route, {
    method: body ? "POST" : "GET",
    headers: {
      Cookie: cookie,
      ...(body && !(body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {}),
    },
    body:
      body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  cookie ||= response.headers.get("set-cookie")?.split(";")[0] || "";
  const data = await response.json();
  assert.ok(response.ok, JSON.stringify(data));
  return data;
}
async function finish(job, timeout = 1800000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const current = await request(`/api/jobs/${job.id}`);
    if (current.status === "failed") throw new Error(current.error);
    if (current.status === "completed") return current.result;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("Local audio job timed out.");
}
async function download(url, file) {
  const response = await fetch(base + url, { headers: { Cookie: cookie } });
  assert.ok(response.ok);
  await fs.writeFile(file, Buffer.from(await response.arrayBuffer()));
}
const status = await request("/api/status");
assert.equal(status.tts, true);
assert.equal(status.bandit.ready, true);
const tts = await finish(
  await request("/api/tts", {
    text: "모아 스튜디오에서 윈도우 영상 편집을 확인합니다.",
    voice: "ko-KR-SunHiNeural",
    rate: 0,
  }),
);
const speech = path.join(resultDir, "windows-tts-api.m4a");
await download(tts.asset.url, speech);
console.log(
  "Microsoft TTS API: real Korean speech imported to the media library.",
);
const mixture = path.join(resultDir, "windows-bandit-mixture.wav");
await run("ffmpeg", [
  "-y",
  "-i",
  speech,
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=220:sample_rate=44100:duration=3",
  "-filter_complex",
  "[0:a]aresample=44100[a];[1:a]volume=0.25[b];[a][b]amix=inputs=2:duration=shortest:normalize=0[out]",
  "-map",
  "[out]",
  "-t",
  "3",
  "-ac",
  "2",
  "-c:a",
  "pcm_s24le",
  mixture,
]);
const form = new FormData();
form.append(
  "file",
  new Blob([await fs.readFile(mixture)], { type: "audio/wav" }),
  "한글 혼합음.wav",
);
const imported = await request("/api/assets", form);
const separation = await finish(
  await request("/api/audio/separate-local", { assetId: imported.id }),
);
assert.equal(separation.engine, "BandIt DnR");
assert.equal(separation.generationCredits, 0);
assert.deepEqual(
  separation.assets.map((asset) => asset.stem),
  ["speech", "music", "effects"],
);
const outputs = [];
for (const asset of separation.assets) {
  const file = path.join(resultDir, `windows-bandit-${asset.stem}.m4a`);
  await download(asset.url, file);
  const { stdout } = await run("ffprobe", [
    "-v",
    "error",
    "-show_streams",
    "-show_format",
    "-of",
    "json",
    file,
  ]);
  const probe = JSON.parse(stdout);
  assert.equal(probe.streams[0].sample_rate, "44100");
  assert.equal(probe.streams[0].channels, 2);
  assert.ok(Math.abs(Number(probe.format.duration) - 3) < 0.1);
  await run("ffmpeg", ["-v", "error", "-i", file, "-f", "null", "-"]);
  outputs.push({
    stem: asset.stem,
    file,
    duration: probe.format.duration,
    channels: 2,
    sampleRate: 44100,
  });
}
await fs.writeFile(
  path.join(resultDir, "windows-audio.json"),
  JSON.stringify(
    {
      tts: {
        engine: "Microsoft Edge TTS",
        file: speech,
        duration: tts.asset.duration,
      },
      bandit: { engine: separation.engine, outputs },
      paidGenerationCalls: 0,
    },
    null,
    2,
  ),
);
console.log(
  "BandIt API: speech/music/effects imported, downloaded, probed and fully decoded. Paid generation: 0.",
);
