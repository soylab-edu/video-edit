import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { uploadRunwayReference as realUpload } from "../server/runway-upload.mjs";
const attachment = {
  file_id: "file_fixture",
  download_url: "https://files.example.com/frame.jpg",
  file_name: "moa-reference-0.jpg",
  mime_type: "image/jpeg",
};
const uploadRunwayReference = (options) =>
  realUpload({
    uploadFile: async ({ bytes }) => {
      assert.equal(bytes.toString(), "abcdefgh");
      return attachment;
    },
    ...options,
  });

test("provider initialization errors stop before sending image bytes and redact credential URLs", async (t) => {
  const file = await fixture(t);
  let sent = 0;
  await assert.rejects(
    uploadRunwayReference({
      reference: "moa://ref/0",
      file,
      mimeType: "image/jpeg",
      call: async () => ({
        isError: true,
        content: [
          {
            type: "text",
            text: "UNAUTHORIZED https://auth.example.com/?token=secret Bearer private-token",
          },
        ],
      }),
      fetcher: async () => {
        sent++;
        throw new Error("Must not send image bytes");
      },
    }),
    (error) =>
      error.message.includes("UNAUTHORIZED") &&
      !error.message.includes("secret") &&
      !error.message.includes("private-token"),
  );
  assert.equal(sent, 0);
});

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "moa-upload-"));
  const file = path.join(dir, "frame.jpg");
  await fs.writeFile(file, Buffer.from("abcdefgh"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return file;
}
test("native multipart upload sends exact approved bytes and server-bound ETags, without redirects", async (t) => {
  const file = await fixture(t),
    calls = [],
    sent = [];
  const url = await uploadRunwayReference({
    reference: "moa://ref/0",
    file,
    mimeType: "image/jpeg",
    lookup: async () => [{ address: "8.8.8.8" }],
    call: async (name, args) => {
      calls.push({ name, args });
      return {
        structuredContent:
          name === "runway.init_upload"
            ? {
                kind: "upload_initialized",
                uploadId: "server-id",
                partSizeBytes: 4,
                uploadUrls: [
                  "https://upload.example.com/1",
                  "https://upload.example.com/2",
                ],
              }
            : { assetUrl: "https://cdn.example.com/frame.jpg" },
      };
    },
    fetcher: async (url, options) => {
      assert.equal(options.method, "PUT");
      assert.equal(options.redirect, "manual");
      sent.push(options.body.toString());
      return new Response(null, { headers: { etag: `"etag${sent.length}"` } });
    },
  });
  assert.equal(url, "https://cdn.example.com/frame.jpg");
  assert.deepEqual(sent, ["abcd", "efgh"]);
  assert.deepEqual(calls[0].args, {
    file: attachment,
    filename: "moa-reference-0.jpg",
    fileSize: 8,
    mimeType: "image/jpeg",
  });
  assert.deepEqual(calls[1].args, {
    uploadId: "server-id",
    parts: [
      { partNumber: 1, etag: "etag1" },
      { partNumber: 2, etag: "etag2" },
    ],
  });
});
test("Runway receives the completed attachment object and uses its asset without re-upload", async (t) => {
  const file = await fixture(t);
  const calls = [];
  const url = await uploadRunwayReference({
    reference: "moa://ref/0",
    file,
    mimeType: "image/jpeg",
    lookup: async () => [{ address: "8.8.8.8" }],
    call: async (name, args) => {
      calls.push({ name, args });
      assert.deepEqual(args.file, attachment);
      return {
        structuredContent: {
          kind: "upload_complete",
          assetUrl: "https://cdn.example.com/owned-frame.jpg",
        },
      };
    },
    fetcher: async () => {
      throw new Error("Completed uploads must not send bytes again");
    },
  });
  assert.equal(url, "https://cdn.example.com/owned-frame.jpg");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "runway.init_upload");
});
test("private upload targets and failed/missing ETags stop before completion without retries", async (t) => {
  const file = await fixture(t);
  for (const target of [
    "https://127.0.0.1/file",
    "https://public.example.com/file",
  ]) {
    let calls = 0,
      sent = 0;
    await assert.rejects(
      uploadRunwayReference({
        reference: "moa://ref/0",
        file,
        mimeType: "image/jpeg",
        lookup: async () => [{ address: "8.8.8.8" }],
        call: async () => {
          calls++;
          return {
            structuredContent: {
              kind: "upload_initialized",
              uploadId: "id",
              uploadUrls: [target],
            },
          };
        },
        fetcher: async () => {
          sent++;
          return new Response(null, {
            status: 302,
            headers: { location: "https://elsewhere.example.com" },
          });
        },
      }),
      /내부 네트워크|소재 전송에 실패/,
    );
    assert.equal(calls, 1);
    assert.equal(sent, target.includes("127.0.0.1") ? 0 : 1);
  }
});
