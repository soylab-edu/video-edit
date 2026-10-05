import assert from "node:assert/strict";
import { chromium } from "playwright";
import fs from "node:fs/promises";
const base = process.env.MOA_TEST_URL || "http://127.0.0.1:3021";
if (!["127.0.0.1", "localhost"].includes(new URL(base).hostname))
  throw new Error("Fixture test requires a local isolated test workspace.");
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let connected = true,
    approvals = 0,
    starts = 0,
    imports = 0;
  const apps = [
    {
      id: "runway",
      name: "Runway",
      authentication: "reauthentication",
      enabled: true,
      executionReady: false,
    },
    {
      id: "magnific",
      name: "Magnific",
      authentication: "verified",
      enabled: true,
      executionReady: true,
    },
    {
      id: "heygen",
      name: "HeyGen",
      authentication: "reauthentication",
      enabled: true,
      executionReady: false,
    },
    {
      id: "pixverse",
      name: "PixVerse",
      authentication: "unverified",
      enabled: false,
      executionReady: false,
    },
    { id: "gmail", name: "Gmail", enabled: true, executionReady: true },
  ];
  const report = {
    id: "report-fixture",
    summary: "두 컷 연결 영상 한 개를 생성합니다.",
    status: "pending",
    expiresAt: Date.now() + 600000,
    calls: [
      {
        tool: "editor_magnific_video_generate",
        arguments: { prompt: "Test", duration: 3 },
        purpose: "컷 연결",
        estimatedCredits: null,
        pricingSource: "확정 견적 없음",
      },
    ],
    followUp: "추가 생성은 별도 승인",
  };
  let task = {
    id: "task-fixture",
    providerId: "magnific",
    state: "awaiting-approval",
    activities: [],
    outputs: [],
    references: [],
    report,
  };
  const reply = (route, json) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(json),
    });
  await page.route("**/api/status", async (route) => {
    const response = await route.fetch();
    return reply(route, {
      ...(await response.json()),
      codex: connected,
      codexAuth: connected ? "chatgpt" : null,
      plugins: [],
    });
  });
  await page.route("**/api/connections/codex-login", (route) =>
    reply(route, { state: connected ? "connected" : "idle" }),
  );
  await page.route("**/api/connections/codex-apps", (route) =>
    reply(route, { state: "ready", apps, checkedAt: new Date().toISOString() }),
  );
  await page.route("**/api/codex-tasks", async (route) => {
    if (route.request().method() === "GET") return reply(route, []);
    starts++;
    const body = route.request().postDataJSON();
    assert.equal(body.providerId, "magnific");
    assert.equal(body.mode, "f2f");
    assert.equal(body.references.length, 2);
    assert.ok(body.references[0].time > 0);
    return reply(route, task);
  });
  await page.route("**/api/codex-tasks/task-fixture", (route) =>
    reply(route, task),
  );
  await page.route("**/api/codex-tasks/task-fixture/approve", (route) => {
    const body = route.request().postDataJSON();
    assert.equal(body.approved, true);
    assert.equal(body.acknowledgeEstimatedCost, true);
    assert.equal(body.reportId, report.id);
    approvals++;
    task = {
      ...task,
      state: "completed",
      message: "생성 결과를 확인하세요.",
      report: { ...report, status: "approved" },
      outputs: [
        {
          id: "output-fixture",
          url: "https://example.com/video.mp4",
          tool: "Video",
        },
      ],
    };
    return reply(route, task);
  });
  await page.route("**/api/codex-tasks/task-fixture/import", (route) => {
    imports++;
    return reply(route, { id: "job-fixture" });
  });
  await page.route("**/api/jobs/job-fixture", (route) =>
    reply(route, { id: "job-fixture", status: "completed", result: {} }),
  );
  await page.goto(base);
  await page.locator(".asset-card").first().waitFor();
  await page.getByRole("button", { name: "플러그인", exact: true }).click();
  const region = page.getByRole("region", { name: "편집 플러그인" });
  await region
    .getByRole("heading", { name: "Magnific", exact: true })
    .waitFor();
  assert.equal(await region.locator(".account-app-card").count(), 4);
  assert.equal(await region.getByText("Gmail", { exact: true }).count(), 0);
  assert.equal(
    await region.getByText("Higgsfield", { exact: true }).count(),
    0,
  );
  assert.equal(
    await region.getByText("제공업체 재인증 필요", { exact: true }).count(),
    2,
  );
  await region.getByRole("button", { name: "Codex로 작업하기 →" }).click();
  await region
    .getByLabel("플러그인 작업 요청")
    .fill("두 컷 사이를 자연스럽게 이어줘");
  await region.getByLabel("참조 방식").selectOption("f2f");
  await region.getByRole("button", { name: "Codex에 작업 계획 요청" }).click();
  await region
    .getByText("전체 작업 보고서 · 승인 대기", { exact: false })
    .waitFor();
  assert.equal(starts, 1);
  assert.equal(approvals, 0);
  assert.equal(
    await region
      .getByRole("button", { name: "승인한 작업만 실행" })
      .isDisabled(),
    true,
  );
  await region.locator(".task-consent input").check();
  await region.getByRole("button", { name: "승인한 작업만 실행" }).click();
  await region.getByRole("link", { name: "결과 1 열기 ↗" }).waitFor();
  assert.equal(approvals, 1);
  await region
    .getByRole("button", { name: "미디어로 가져오기", exact: true })
    .click();
  await page
    .getByText("생성 결과를 미디어 보관함에 추가했습니다.", { exact: true })
    .waitFor();
  assert.equal(imports, 1);
  await fs.mkdir("test-results", { recursive: true });
  await page.screenshot({ path: "test-results/editor-plugin-execution.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "test-results/editor-plugin-mobile.png" });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.getByRole("button", { name: "닫기", exact: true }).click();
  await page.getByRole("button", { name: "미디어", exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  const initial = await page.locator(".asset-card").count();
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator(".asset-delete").first().click();
  await page.waitForFunction(
    (n) => document.querySelectorAll(".asset-card").length === n,
    initial - 1,
  );
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "샘플 모두 삭제", exact: true })
    .click();
  await page.waitForFunction(
    () => document.querySelectorAll(".asset-card").length === 0,
  );
  assert.equal(await page.locator(".timeline-clip").count(), 0);
  await page.getByText("작업실에 저장됨", { exact: true }).waitFor();
  await page.reload();
  await page.getByText("작업실에 저장됨", { exact: true }).waitFor();
  assert.equal(await page.locator(".asset-card").count(), 0);
  assert.equal(await page.locator(".timeline-clip").count(), 0);
  assert.deepEqual(errors, []);
  console.log(
    "Browser passed: only four providers, reauth status, Codex F2F plan, explicit credit approval, result import, mobile, sample video/audio deletion and persistence.",
  );
} finally {
  await browser.close();
}
