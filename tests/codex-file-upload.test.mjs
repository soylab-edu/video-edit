import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { uploadCodexFile } from "../server/codex-file-upload.mjs";

async function fixture(t) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "moa-file-"));
  await fs.writeFile(
    path.join(home, "auth.json"),
    JSON.stringify({
      auth_mode: "chatgpt",
      tokens: { access_token: "fixture-secret", account_id: "fixture-owner" },
    }),
  );
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  return {
    home,
    bytes: Buffer.from("frame"),
    filename: "frame.jpg",
    mimeType: "image/jpeg",
    lookup: async () => [{ address: "8.8.8.8" }],
  };
}
const response = (data) =>
  new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json" },
  });
const base = "https://chatgpt.com/backend-api/files";
test("file transport follows Codex's create/bytes/finalize contract; OAuth never reaches storage", async (t) => {
  const options = await fixture(t),
    calls = [];
  const progress = [];
  let finalizations = 0;
  const file = await uploadCodexFile({
    ...options,
    onProgress: (x) => progress.push(x),
    fetcher: async (url, init) => {
      calls.push(String(url));
      assert.equal(init.redirect, "manual");
      if (String(url) === "https://storage.example.com/signed") {
        assert.equal(init.method, "PUT");
        assert.deepEqual(init.body, options.bytes);
        assert.equal(init.headers["x-ms-blob-type"], "BlockBlob");
        assert.equal(init.headers.Authorization, undefined);
        assert.equal(init.headers["ChatGPT-Account-ID"], undefined);
        return new Response(null);
      }
      assert.equal(init.headers.Authorization, "Bearer fixture-secret");
      assert.equal(init.headers["ChatGPT-Account-ID"], "fixture-owner");
      if (String(url) === base) {
        assert.deepEqual(JSON.parse(init.body), {
          file_name: "frame.jpg",
          file_size: 5,
          use_case: "codex",
        });
        return response({
          file_id: "file_fixture",
          upload_url: "https://storage.example.com/signed",
        });
      }
      assert.equal(String(url), base + "/file_fixture/uploaded");
      assert.equal(init.body, "{}");
      return response(
        ++finalizations === 1
          ? { status: "retry" }
          : {
              status: "success",
              download_url: "https://files.example.com/frame.jpg",
              file_size_bytes: 5,
            },
      );
    },
  });
  assert.deepEqual(file, {
    file_id: "file_fixture",
    download_url: "https://files.example.com/frame.jpg",
    file_name: "frame.jpg",
    mime_type: "image/jpeg",
  });
  assert.equal(
    calls.filter((x) => x.includes("storage.example.com")).length,
    1,
  );
  assert.equal(progress.at(-1), "첨부파일 등록 완료");
});
test("private upload targets, redirects and HTTP errors never replay or expose raw error bodies", async (t) => {
  const options = await fixture(t);
  for (const target of [
    "https://127.0.0.1/file",
    "https://storage.example.com/signed",
  ]) {
    let calls = 0;
    await assert.rejects(
      uploadCodexFile({
        ...options,
        fetcher: async (url) => {
          calls++;
          if (String(url) === base)
            return response({ file_id: "file_fixture", upload_url: target });
          return new Response("fixture-secret raw response", {
            status: 302,
            headers: { location: "https://other.example.com" },
          });
        },
      }),
      (e) =>
        /내부 네트워크|HTTP 302/.test(e.message) &&
        !e.message.includes("fixture-secret"),
    );
    assert.equal(calls, target.includes("127.0.0.1") ? 1 : 2);
  }
});
test("cancellation before upload prevents file transmission", async (t) => {
  const options = await fixture(t);
  let calls = 0,
    active = true;
  await assert.rejects(
    uploadCodexFile({
      ...options,
      ensureActive: () => {
        if (!active) throw new Error("cancelled");
      },
      fetcher: async () => {
        calls++;
        active = false;
        return response({
          file_id: "file_fixture",
          upload_url: "https://storage.example.com/signed",
        });
      },
    }),
    /cancelled/,
  );
  assert.equal(calls, 1);
});
