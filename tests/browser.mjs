import assert from "node:assert/strict";
import { chromium } from "playwright";
import fs from "node:fs/promises";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } }),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await fs.mkdir("test-results", { recursive: true });
try {
  await page.goto(process.env.MOA_TEST_URL || "http://127.0.0.1:5173");
  await page.locator(".timeline-clip").first().waitFor();
  assert.equal(await page.locator(".timeline-clip").count(), 3);
  await page.getByRole("button", { name: "재생", exact: true }).click();
  await page.waitForTimeout(700);
  await page.getByRole("button", { name: "일시 정지", exact: true }).click();
  assert.ok(
    (await page.locator(".stage video").evaluate((v) => v.currentTime)) > 0.3,
  );
  await page
    .getByRole("button", { name: "클립 나누기 (S)", exact: true })
    .click();
  assert.equal(await page.locator(".timeline-clip").count(), 4);
  await page
    .getByRole("button", { name: "실행 취소 (⌘ Z)", exact: true })
    .click();
  assert.equal(await page.locator(".timeline-clip").count(), 3);
  await page
    .getByRole("button", { name: "다시 실행 (⌘ ⇧ Z)", exact: true })
    .click();
  assert.equal(await page.locator(".timeline-clip").count(), 4);
  await page
    .getByRole("button", { name: "실행 취소 (⌘ Z)", exact: true })
    .click();
  await page.getByRole("button", { name: "속성", exact: true }).click();
  await page.getByLabel("클립 끝 시간").fill("5");
  assert.equal(await page.getByLabel("클립 끝 시간").inputValue(), "5");
  await page
    .getByRole("button", { name: "실행 취소 (⌘ Z)", exact: true })
    .click();
  assert.equal(await page.getByLabel("클립 끝 시간").inputValue(), "8");
  await page.getByRole("button", { name: "AI 도우미", exact: true }).click();
  await page
    .getByRole("button", { name: "AI 자동편집", exact: false })
    .first()
    .click();
  await page.getByRole("button", { name: "웨스 앤더슨", exact: false }).click();
  await page.getByLabel("목표 길이 (초)").fill("6");
  await page
    .getByRole("button", { name: "크레딧 없이 1차 편집하기", exact: true })
    .click();
  await page
    .getByText("1차 편집본이 완성됐어요", { exact: true })
    .waitFor({ timeout: 90000 });
  await page.screenshot({ path: "test-results/auto-report.png" });
  await page
    .getByRole("button", { name: "이 편집본으로 계속하기", exact: true })
    .click();
  assert.match(await page.getByLabel("프로젝트 이름").inputValue(), /1차 편집/);
  await page
    .getByRole("button", { name: "실행 취소 (⌘ Z)", exact: true })
    .click();
  assert.equal(
    await page.getByLabel("프로젝트 이름").inputValue(),
    "어디든, 나답게",
  );
  await page.getByRole("button", { name: "플러그인", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByText("Microsoft TTS", { exact: false })
    .waitFor();
  await page.getByRole("button", { name: "닫기", exact: true }).click();
  await page.getByRole("button", { name: "오디오", exact: true }).click();
  await page.getByRole("button", { name: "사운드 분리", exact: false }).click();
  assert.ok(
    await page.getByText("BandIt DnR · 로컬 분리", { exact: true }).isVisible(),
  );
  await page.getByRole("button", { name: "닫기", exact: true }).click();
  await page.getByRole("button", { name: "미디어", exact: true }).click();
  await page.screenshot({ path: "test-results/editor-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/editor-mobile.png",
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
    false,
    "mobile must not overflow horizontally",
  );
  assert.deepEqual(errors, []);
  console.log(
    "Browser checks passed: playback, split, undo/redo, trim, local auto render/apply, plugins, BandIt, mobile layout.",
  );
} finally {
  await browser.close();
}
