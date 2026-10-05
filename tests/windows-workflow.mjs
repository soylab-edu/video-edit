// Real local browser/FFmpeg workflow. All media is synthetic and all workspace
// data is disposable; no account login, provider upload or paid generation.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { chromium } from "playwright";
import { run } from "../server/core.mjs";

const resultDir = path.resolve("test-results");
await fs.mkdir(resultDir, { recursive: true });
const work = await fs.mkdtemp(path.join(os.tmpdir(), "moa-한글 경로's-"));
const reservation = http.createServer();
await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
const port = reservation.address().port;
await new Promise((resolve) => reservation.close(resolve));
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["server/index.mjs"], {
  env: {
    ...process.env,
    PORT: String(port),
    NODE_ENV: "development",
    MOA_HOST: "127.0.0.1",
    MOA_DATA_DIR: path.join(work, ".data"),
  },
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
server.stdout.on("data", (bytes) => {
  serverLog += bytes;
});
server.stderr.on("data", (bytes) => {
  serverLog += bytes;
});
let browser;
try {
  let ready = false;
  for (let i = 0; i < 300; i++) {
    try {
      if ((await fetch(base + "/api/health")).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, serverLog);
  const source = path.join(work, "윈도우 검증 영상.mp4");
  await run("ffmpeg", [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=640x360:rate=24:duration=4",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=44100:duration=4",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-threads",
    "2",
    "-c:a",
    "aac",
    "-shortest",
    source,
  ]);
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 960 },
    acceptDownloads: true,
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base);
  await page
    .getByRole("button", { name: "01 · 길 위의 시작 클립 선택", exact: true })
    .waitFor();
  await page.getByLabel("프로젝트 이름").fill("Windows 실제 검증");
  const chooserEvent = page.waitForEvent("filechooser");
  await page
    .getByRole("button", { name: "미디어 가져오기 ⌘ I", exact: true })
    .click();
  await (await chooserEvent).setFiles(source);
  await page
    .getByRole("button", {
      name: "윈도우 검증 영상.mp4 타임라인에 추가",
      exact: true,
    })
    .waitFor();
  await page
    .getByRole("button", {
      name: "윈도우 검증 영상.mp4 타임라인에 추가",
      exact: true,
    })
    .click();
  for (const name of [
    "01 · 길 위의 시작",
    "02 · 느리게 흘러가는 시간",
    "03 · 새로운 풍경",
  ]) {
    await page
      .getByRole("button", { name: `${name} 클립 선택`, exact: true })
      .click();
    await page
      .getByRole("button", { name: "선택한 클립 삭제 (Delete)", exact: true })
      .click();
  }
  await page
    .getByRole("button", {
      name: "윈도우 검증 영상.mp4 클립 선택",
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: "속성", exact: true }).click();
  await page.getByLabel("클립 시작 시간").fill("0.5");
  await page.getByLabel("클립 끝 시간").fill("3.5");
  await page
    .getByRole("button", { name: "처음으로 이동", exact: true })
    .click();
  await page.getByRole("button", { name: "재생", exact: true }).click();
  await page.waitForTimeout(700);
  await page.getByRole("button", { name: "일시 정지", exact: true }).click();
  assert.ok(
    await page
      .locator(".stage video")
      .evaluate((video) => video.currentTime > 0.8),
  );
  await page
    .getByRole("button", { name: "클립 나누기 (S)", exact: true })
    .click();
  assert.equal(await page.locator(".timeline-clip").count(), 2);
  await page
    .getByRole("button", { name: "실행 취소 (⌘ Z)", exact: true })
    .click();
  assert.equal(await page.locator(".timeline-clip").count(), 1);
  await page
    .getByRole("button", { name: "다시 실행 (⌘ ⇧ Z)", exact: true })
    .click();
  assert.equal(await page.locator(".timeline-clip").count(), 2);
  await page.getByRole("button", { name: "텍스트", exact: true }).click();
  await page
    .locator(".title-editor textarea")
    .fill("한글 자막 · Windows 저장과 내보내기 검증");
  await page.getByLabel("시작 (초)").fill("0");
  await page.getByLabel("끝 (초)").fill("3");
  await page
    .getByRole("button", { name: "처음으로 이동", exact: true })
    .click();
  await page.getByText("작업실에 저장됨", { exact: true }).waitFor();
  await page.screenshot({ path: path.join(resultDir, "windows-editor.png") });
  await page.getByRole("button", { name: "미디어", exact: true }).click();
  const downloadEvent = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "프로젝트 저장", exact: true })
    .click();
  const projectFile = path.join(resultDir, "windows-project.moa.json");
  await (await downloadEvent).saveAs(projectFile);
  const project = JSON.parse(await fs.readFile(projectFile, "utf8"));
  assert.equal(project.name, "Windows 실제 검증");
  assert.equal(project.clips.length, 2);
  assert.equal(
    project.titles[0].text,
    "한글 자막 · Windows 저장과 내보내기 검증",
  );
  assert.ok(
    Math.abs(
      project.clips.reduce((sum, clip) => sum + clip.out - clip.in, 0) - 3,
    ) < 0.01,
  );
  await page.getByLabel("프로젝트 이름").fill("다시 열기 전 임시 이름");
  const projectChooserEvent = page.waitForEvent("filechooser");
  await page
    .getByRole("button", { name: "프로젝트 파일 열기", exact: true })
    .click();
  await (await projectChooserEvent).setFiles(projectFile);
  await page.getByText("프로젝트를 열었습니다.", { exact: true }).waitFor();
  assert.equal(
    await page.getByLabel("프로젝트 이름").inputValue(),
    project.name,
  );
  await page.getByText("작업실에 저장됨", { exact: true }).waitFor();
  await page.reload();
  await page
    .getByRole("button", {
      name: "윈도우 검증 영상.mp4 클립 선택",
      exact: true,
    })
    .first()
    .waitFor();
  assert.equal(await page.locator(".timeline-clip").count(), 2);
  assert.equal(
    await page.getByLabel("프로젝트 이름").inputValue(),
    project.name,
  );
  // Same authenticated cookie, fresh browser storage: restore from the server.
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.locator(".timeline-clip").first().waitFor();
  assert.equal(await page.locator(".timeline-clip").count(), 2);
  assert.equal(
    await page.getByLabel("프로젝트 이름").inputValue(),
    project.name,
  );
  await page.getByRole("button", { name: "내보내기", exact: true }).click();
  await page
    .getByRole("button", { name: "영상 내보내기", exact: true })
    .click();
  await page
    .getByRole("link", { name: "완성된 영상 다운로드", exact: true })
    .waitFor({ timeout: 90000 });
  await page.screenshot({ path: path.join(resultDir, "windows-export.png") });
  const exportEvent = page.waitForEvent("download");
  await page
    .getByRole("link", { name: "완성된 영상 다운로드", exact: true })
    .click();
  const output = path.join(resultDir, "windows-edited.mp4");
  await (await exportEvent).saveAs(output);
  const { stdout } = await run("ffprobe", [
    "-v",
    "error",
    "-show_streams",
    "-show_format",
    "-of",
    "json",
    output,
  ]);
  const probe = JSON.parse(stdout);
  const video = probe.streams.find((stream) => stream.codec_type === "video");
  const audio = probe.streams.find((stream) => stream.codec_type === "audio");
  assert.equal(video.codec_name, "h264");
  assert.equal(video.width, 1280);
  assert.equal(video.height, 720);
  assert.equal(video.r_frame_rate, "24/1");
  assert.equal(audio.codec_name, "aac");
  assert.ok(Math.abs(Number(probe.format.duration) - 3) < 0.15);
  await run("ffmpeg", ["-v", "error", "-i", output, "-f", "null", "-"]);
  await run("ffmpeg", [
    "-y",
    "-ss",
    "1",
    "-i",
    output,
    "-frames:v",
    "1",
    path.join(resultDir, "windows-export-frame.png"),
  ]);
  assert.deepEqual(errors, []);
  await fs.writeFile(
    path.join(resultDir, "windows-workflow.json"),
    JSON.stringify(
      {
        platform: process.platform,
        node: process.version,
        importedFilename: path.basename(source),
        checks: [
          "upload",
          "playback",
          "trim",
          "split",
          "undo",
          "redo",
          "Korean captions",
          "project download",
          "project reopen",
          "reload",
          "server restore without localStorage",
          "MP4 download",
          "full decode",
        ],
        output: {
          file: output,
          video: video.codec_name,
          audio: audio.codec_name,
          width: video.width,
          height: video.height,
          fps: video.r_frame_rate,
          duration: probe.format.duration,
        },
        browserErrors: errors,
        paidGenerationCalls: 0,
      },
      null,
      2,
    ),
  );
  console.log(
    "Windows workflow passed: real upload, edit, save/reopen/server restore, Korean captions, MP4 download and FFprobe/full decode. Paid generation: 0.",
  );
} finally {
  await browser?.close();
  const closed = new Promise((resolve) => server.once("close", resolve));
  server.kill();
  await closed;
  assert.equal(path.dirname(path.resolve(work)), path.resolve(os.tmpdir()));
  await fs.rm(work, { recursive: true, force: true });
}
