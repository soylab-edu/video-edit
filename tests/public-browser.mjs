import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { run } from "../server/core.mjs";

const base = process.env.MOA_TEST_URL;
const inviteFile = process.env.MOA_TEST_INVITE_FILE;
if (!base?.startsWith("https://") || !inviteFile)
  throw new Error("MOA_TEST_URL and isolated test workspace invite required");
const password = randomBytes(24).toString("base64url");
const invite = await fs.readFile(inviteFile, "utf8");
const proxy = process.env.HTTPS_PROXY && new URL(process.env.HTTPS_PROXY);
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
  ...(proxy
    ? {
        proxy: {
          server: proxy.origin,
          ...(proxy.username
            ? {
                username: decodeURIComponent(proxy.username),
                password: decodeURIComponent(proxy.password),
              }
            : {}),
        },
      }
    : {}),
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 960 },
  acceptDownloads: true,
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("requestfailed", (r) =>
  console.log(
    "Request failed: " +
      r.method() +
      " " +
      new URL(r.url()).pathname +
      " " +
      r.failure()?.errorText,
  ),
);
page.on("response", async (r) => {
  if (
    new URL(r.url()).pathname === "/api/assets" &&
    r.request().method() === "POST"
  )
    console.log(
      "Upload response: " + r.status() + " " + (await r.text()).slice(0, 800),
    );
});
await fs.mkdir("test-results", { recursive: true });
try {
  await page.goto(base + "/#invite=" + invite, { waitUntil: "networkidle" });
  await page.getByLabel("작업실 비밀번호", { exact: true }).fill(password);
  await page.getByLabel("비밀번호 확인", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "비밀번호 설정하고 시작", exact: true })
    .click();
  await page.locator(".timeline-clip").first().waitFor({ timeout: 30000 });
  assert.equal(await page.locator(".timeline-clip").count(), 3);
  console.log("HTTPS setup/login and initial editor loaded");
  await page.getByLabel("프로젝트 이름").fill("HTTPS 실제 편집 검증");
  await page
    .locator('input[type=file][accept="video/*,audio/*,image/*"]')
    .setInputFiles({
      name: "사용자 영상.mp4",
      mimeType: "video/mp4",
      buffer: await fs.readFile("public/demo/scene-0.mp4"),
    });
  const add = page.getByRole("button", {
    name: "사용자 영상.mp4 타임라인에 추가",
    exact: true,
  });
  await add.waitFor({ timeout: 60000 });
  await add.click();
  assert.equal(await page.locator(".timeline-clip").count(), 4);
  await page.getByRole("button", { name: "재생", exact: true }).click();
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "일시 정지", exact: true }).click();
  const playTime = await page
    .locator(".stage video")
    .evaluate((v) => v.currentTime);
  assert.ok(playTime > 0.2, "public video must play");
  await page
    .getByRole("button", { name: "클립 나누기 (S)", exact: true })
    .click();
  assert.equal(await page.locator(".timeline-clip").count(), 5);
  await page.getByText("작업실에 저장됨", { exact: true }).waitFor();
  console.log(
    "HTTPS Korean filename upload, playback, split, and server save passed",
  );
  await page.getByRole("button", { name: "내보내기", exact: true }).click();
  await page
    .getByRole("button", { name: "영상 내보내기", exact: true })
    .click();
  const link = page.getByRole("link", {
    name: "완성된 영상 다운로드",
    exact: true,
  });
  await link.waitFor({ timeout: 120000 });
  const downloaded = page.waitForEvent("download");
  await link.click();
  const download = await downloaded;
  await download.saveAs("test-results/https-edited.mp4");
  const { stdout } = await run("ffprobe", [
    "-v",
    "error",
    "-show_format",
    "-show_streams",
    "-of",
    "json",
    "test-results/https-edited.mp4",
  ]);
  const probe = JSON.parse(stdout);
  assert.ok(Number(probe.format.duration) > 20);
  assert.ok(
    probe.streams.some((s) => s.codec_type === "video" && s.width === 1280),
  );
  assert.ok(probe.streams.some((s) => s.codec_type === "audio"));
  console.log(
    "HTTPS MP4 downloaded and probed: " +
      Number(probe.format.duration) +
      "s, 1280px, audio present",
  );
  await page.getByRole("button", { name: "닫기", exact: true }).click();
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await page.locator(".timeline-clip").first().waitFor();
  assert.equal(
    await page.getByLabel("프로젝트 이름").inputValue(),
    "HTTPS 실제 편집 검증",
  );
  assert.equal(await page.locator(".timeline-clip").count(), 5);
  await page.getByRole("button", { name: "플러그인", exact: true }).click();
  await page
    .getByRole("button", { name: "ChatGPT 계정으로 Codex 연결", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "ChatGPT 계정으로 Codex 연결", exact: true })
    .click();
  await page.locator(".device-code").waitFor({ timeout: 30000 });
  assert.match(
    await page.locator(".device-code").innerText(),
    /^[A-Z0-9]{4,5}-[A-Z0-9]{4,5}$/,
  );
  assert.equal(
    await page
      .getByRole("link", { name: "OpenAI 인증 페이지 열기 ↗" })
      .getAttribute("href"),
    "https://auth.openai.com/codex/device",
  );
  await page.screenshot({
    path: "test-results/public-plugins.png",
    mask: [page.locator(".device-code")],
  });
  await page.getByRole("button", { name: "로그인 취소", exact: true }).click();
  console.log(
    "HTTPS ChatGPT device authorization flow issued a real code; canceled without signing in or consuming AI usage",
  );
  await page.getByRole("button", { name: "닫기", exact: true }).click();
  await page.getByRole("button", { name: "미디어", exact: true }).click();
  await page.screenshot({ path: "test-results/public-editor.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/public-mobile.png",
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  page.on("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await page
    .getByRole("button", { name: "편집기 열기", exact: true })
    .waitFor();
  await page.getByLabel("작업실 비밀번호", { exact: true }).fill(password);
  await page.getByRole("button", { name: "편집기 열기", exact: true }).click();
  await page.locator(".timeline-clip").first().waitFor();
  assert.equal(
    await page.getByLabel("프로젝트 이름").inputValue(),
    "HTTPS 실제 편집 검증",
  );
  assert.deepEqual(errors, []);
  console.log(
    "HTTPS server restore without browser storage, ChatGPT connection UI, mobile layout, logout/login passed; no JS errors",
  );
} catch (error) {
  await page.screenshot({
    path: "test-results/public-failure.png",
    fullPage: true,
  });
  throw error;
} finally {
  await browser.close();
}
