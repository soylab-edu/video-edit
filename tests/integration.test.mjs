import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { run } from "../server/core.mjs";

test(
  "media pipeline, local auto edit, tenant isolation and paid generation approval",
  { timeout: 120000 },
  async (t) => {
    const work = await fs.mkdtemp(path.join(os.tmpdir(), "moa-integration-"));
    let remoteJobs = 0;
    const payloads = [];
    const sample = path.join(work, "sample.mp4");
    await run("ffmpeg", [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=160x90:rate=24:duration=4",
      "-f",
      "lavfi",
      "-i",
      "aevalsrc=if(between(t\\,1\\,2)\\,0\\,0.1*sin(2*PI*440*t)):s=48000:d=4",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-threads",
      "2",
      "-c:a",
      "aac",
      "-shortest",
      sample,
    ]);
    const base64 = (await fs.readFile(sample)).toString("base64");
    const mock = http.createServer(async (req, res) => {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const body = raw ? JSON.parse(raw) : {};
      res.setHeader("Content-Type", "application/json");
      if (req.url === "/v1/capabilities")
        return res.end(
          JSON.stringify({
            plugins: [
              {
                id: "test-provider",
                name: "Test provider",
                description: "Explicit test fixture",
                capabilities: [
                  "video-generation",
                  "sound-effects",
                  "audio-separation",
                ],
                modes: ["f2f", "omni"],
                stems: ["voice", "sfx", "bgm"],
              },
            ],
          }),
        );
      if (req.url === "/v1/quote") {
        assert.ok(
          !body.assets.some((a) => a.data),
          "quotes must not include media",
        );
        return res.end(
          JSON.stringify({
            id: "q-" + Date.now(),
            cost: 1.5,
            currency: "credits",
          }),
        );
      }
      if (req.url === "/v1/jobs") {
        remoteJobs++;
        payloads.push(body);
        return res.end(
          JSON.stringify({
            id: "job-" + remoteJobs,
            status: "completed",
            outputs: [{ name: "Test generated video", data: base64 }],
          }),
        );
      }
      res.writeHead(404).end("{}");
    });
    await new Promise((r) => mock.listen(0, "127.0.0.1", r));
    const gatewayPort = mock.address().port;
    const reservation = http.createServer();
    await new Promise((r) => reservation.listen(0, "127.0.0.1", r));
    const port = reservation.address().port;
    await new Promise((r) => reservation.close(r));
    const server = spawn(process.execPath, ["server/index.mjs"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(port),
        MOA_DATA_DIR: path.join(work, ".data"),
        PLUGIN_GATEWAY_URL: `http://127.0.0.1:${gatewayPort}`,
        MOA_ALLOW_LOCAL_GATEWAY: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let log = "";
    server.stdout.on("data", (x) => (log += x));
    server.stderr.on("data", (x) => (log += x));
    t.after(async () => {
      server.kill();
      await new Promise((r) => server.once("close", r));
      await new Promise((r) => mock.close(r));
      await fs.rm(work, { recursive: true, force: true });
    });
    const base = `http://127.0.0.1:${port}`;
    let ready = false;
    for (let i = 0; i < 80; i++) {
      try {
        const response = await fetch(base + "/api/health");
        if (response.ok) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(ready, log);
    let cookie = "";
    async function request(route, body, otherCookie) {
      const response = await fetch(base + route, {
        method: body ? "POST" : "GET",
        headers: {
          ...(body instanceof FormData
            ? {}
            : body
              ? { "Content-Type": "application/json" }
              : {}),
          Cookie: otherCookie ?? cookie,
        },
        body:
          body instanceof FormData
            ? body
            : body
              ? JSON.stringify(body)
              : undefined,
      });
      if (!cookie && response.headers.get("set-cookie"))
        cookie = response.headers.get("set-cookie").split(";")[0];
      const data = await response.json();
      return { response, data };
    }
    async function finish(job) {
      for (let i = 0; i < 160; i++) {
        const { data } = await request("/api/jobs/" + job.id);
        if (data.status === "failed") throw new Error(data.error);
        if (data.status === "completed") return data.result;
        await new Promise((r) => setTimeout(r, 150));
      }
      throw new Error("job timed out");
    }
    const { data: assets } = await request("/api/assets");
    const { data: unconnectedStatus } = await request("/api/status");
    assert.deepEqual(
      unconnectedStatus.plugins,
      [],
      "example providers must not appear as disconnected account apps",
    );
    const { data: accountApps } = await request("/api/connections/codex-apps");
    assert.deepEqual(accountApps, {
      state: "not-connected",
      apps: [],
      checkedAt: null,
    });
    assert.equal(assets.filter((a) => a.type === "video").length, 3);
    const form = new FormData();
    form.append(
      "file",
      new Blob([await fs.readFile(sample)], { type: "video/mp4" }),
      "한글 fixture.mp4",
    );
    const { data: asset, response: upload } = await request(
      "/api/assets",
      form,
    );
    assert.equal(upload.status, 200, JSON.stringify(asset));
    assert.ok(asset.hasAudio);
    assert.equal(asset.name, "한글 fixture.mp4");
    const ownMedia = await fetch(base + asset.url, {
      headers: { Cookie: cookie },
    });
    assert.equal(ownMedia.status, 200);
    assert.match(ownMedia.headers.get("content-type"), /video\/mp4/);
    assert.ok((await ownMedia.arrayBuffer()).byteLength > 1000);
    const binary = await fs.readFile(sample);
    const { data: transfer } = await request("/api/uploads", {
      name: "분할 전송.mp4",
      size: binary.length,
    });
    const sendChunk = (offset, body, session = cookie) =>
      fetch(`${base}/api/uploads/${transfer.id}`, {
        method: "PUT",
        headers: {
          Cookie: session,
          "Content-Type": "application/octet-stream",
          "x-upload-offset": String(offset),
        },
        body,
      });
    assert.equal((await sendChunk(1, binary.subarray(0, 10))).status, 409);
    assert.equal(
      (
        await sendChunk(
          0,
          binary.subarray(0, 10),
          "moa_session=11111111-1111-4111-8111-111111111111",
        )
      ).status,
      404,
    );
    const middle = Math.floor(binary.length / 2);
    assert.equal((await sendChunk(0, binary.subarray(0, middle))).status, 200);
    assert.equal(
      (await request(`/api/uploads/${transfer.id}/complete`, {})).response
        .status,
      409,
    );
    assert.equal(
      (await sendChunk(middle, binary.subarray(middle))).status,
      200,
    );
    const { data: importedJob } = await request(
      `/api/uploads/${transfer.id}/complete`,
      {},
    );
    const imported = await finish(importedJob);
    assert.equal(imported.asset.name, "분할 전송.mp4");
    assert.ok(imported.asset.duration >= 4);
    assert.equal(
      (await request(`/api/uploads/${transfer.id}/complete`, {})).response
        .status,
      404,
    );
    const isolated = await fetch(base + asset.url, {
      headers: { Cookie: "moa_session=11111111-1111-4111-8111-111111111111" },
    });
    assert.equal(isolated.status, 404);
    const { data: analysisJob } = await request("/api/analyze", {
      assetId: asset.id,
      type: "silence",
    });
    const analysis = await finish(analysisJob);
    assert.equal(analysis.silence.length, 1);
    assert.ok(analysis.silence[0][0] > 0.9 && analysis.silence[0][1] < 2.1);
    const c = {
      id: "clip1",
      assetId: asset.id,
      name: "Test",
      in: 0,
      out: 3,
      speed: 1,
      volume: 0.5,
      brightness: 0,
      saturation: 1,
    };
    const project = {
      name: "한국어 제목",
      ratio: "16:9",
      clips: [c],
      audio: [],
      titles: [{ id: "t", text: "한글 자막 테스트", start: 0, end: 2 }],
      normalize: true,
    };
    const { data: exportJob, response: exportResponse } = await request(
      "/api/export",
      project,
    );
    assert.equal(exportResponse.status, 202);
    const render = await finish(exportJob);
    const rendered = await fetch(base + render.url, {
      headers: { Cookie: cookie },
    });
    assert.equal(rendered.status, 200);
    const outfile = path.join(work, "output.mp4");
    await fs.writeFile(outfile, Buffer.from(await rendered.arrayBuffer()));
    const { stdout } = await run("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration:stream=codec_name,width,height",
      "-of",
      "json",
      outfile,
    ]);
    const probe = JSON.parse(stdout);
    assert.ok(Math.abs(Number(probe.format.duration) - 3) < 0.15);
    assert.equal(probe.streams[0].width, 1280);
    const { data: autoJob } = await request("/api/auto-edit", {
      project,
      engine: "local",
      style: "wes",
      target: 3,
      instructions: "Test",
      removeSilence: true,
      normalize: true,
    });
    const auto = await finish(autoJob);
    assert.equal(auto.report.generationCredits, 0);
    assert.equal(auto.report.apiBilling, false);
    assert.equal(auto.project.clips.length, 2);
    assert.equal(remoteJobs, 0);
    const { response: noKey } = await request("/api/auto-edit", {
      project,
      engine: "codex",
      style: "none",
      target: 3,
      instructions: "Test",
      removeSilence: true,
      normalize: true,
    });
    assert.equal(noKey.status, 409);
    const { response: connected } = await request("/api/connections/gateway", {
      token: "local-test-token",
    });
    assert.equal(connected.status, 200);
    const input = {
      pluginId: "test-provider",
      capability: "video-generation",
      mode: "f2f",
      prompt: "Test continuity",
      assetIds: ["demo-0", "demo-1"],
      frameRefs: [
        { assetId: "demo-0", time: 1 },
        { assetId: "demo-1", time: 2 },
      ],
      duration: 3,
    };
    const { data: proposal } = await request("/api/proposals", input);
    assert.ok(proposal.id);
    assert.equal(remoteJobs, 0);
    const { response: unapproved } = await request(
      `/api/proposals/${proposal.id}/approve`,
      { approved: false },
    );
    assert.equal(unapproved.status, 400);
    assert.equal(remoteJobs, 0);
    const { response: crossUser } = await request(
      `/api/proposals/${proposal.id}/approve`,
      { approved: true },
      "moa_session=11111111-1111-4111-8111-111111111111",
    );
    assert.equal(crossUser.status, 404);
    const { data: generationJob } = await request(
      `/api/proposals/${proposal.id}/approve`,
      { approved: true },
    );
    await finish(generationJob);
    assert.equal(remoteJobs, 1);
    assert.equal(payloads[0].assets.length, 2);
    assert.equal(payloads[0].assets[0].mime, "image/jpeg");
    assert.equal(payloads[0].assets[0].position, "first");
    assert.equal(payloads[0].assets[1].position, "last");
    const { response: repeat } = await request(
      `/api/proposals/${proposal.id}/approve`,
      { approved: true },
    );
    assert.equal(repeat.status, 409);
    assert.equal(remoteJobs, 1);
    const { data: p2 } = await request("/api/proposals", input),
      { data: p3 } = await request("/api/proposals", input);
    const { data: batch } = await request("/api/proposal-batches", {
      ids: [p2.id, p3.id],
    });
    assert.equal(batch.totals.credits, 3);
    assert.equal(remoteJobs, 1);
    const { response: missingApproval } = await request(
      `/api/proposal-batches/${batch.id}/approve`,
      { approved: false },
    );
    assert.equal(missingApproval.status, 400);
    const { data: batchJob } = await request(
      `/api/proposal-batches/${batch.id}/approve`,
      { approved: true },
    );
    const completed = await finish(batchJob);
    assert.equal(completed.assets.length, 2);
    assert.equal(remoteJobs, 3);
    const { response: repeatBatch } = await request(
      `/api/proposal-batches/${batch.id}/approve`,
      { approved: true },
    );
    assert.equal(repeatBatch.status, 409);
    const deleteOwn = await fetch(base + "/api/assets/" + asset.id, {
      method: "DELETE",
      headers: { Cookie: cookie },
    });
    assert.equal(deleteOwn.status, 200);
    assert.ok(
      (await deleteOwn.json()).assets.find((a) => a.id === asset.id).deleted,
    );
    const deleteSamples = await fetch(base + "/api/assets/samples", {
      method: "DELETE",
      headers: { Cookie: cookie },
    });
    assert.equal(deleteSamples.status, 200);
    const afterDelete = (await request("/api/assets")).data;
    assert.ok(
      afterDelete.filter((a) => a.demo).every((a) => a.deleted),
      "samples must stay deleted on reload",
    );
    const otherAssets = (
      await request(
        "/api/assets",
        undefined,
        "moa_session=11111111-1111-4111-8111-111111111111",
      )
    ).data;
    assert.ok(
      otherAssets.filter((a) => a.demo).every((a) => !a.deleted),
      "sample deletion must be workspace-specific",
    );
    assert.equal(
      (
        await fetch(base + "/api/assets/" + asset.id, {
          method: "DELETE",
          headers: {
            Cookie: "moa_session=11111111-1111-4111-8111-111111111111",
          },
        })
      ).status,
      404,
    );
  },
);
