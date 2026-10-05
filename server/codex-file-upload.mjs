import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { publicHttps } from "./media-transfer.mjs";

// Mirrors the pinned official Codex file-parameter transport. Raw
// mcpServer/tool/call does not run core's model-tool argument rewriter.
// https://github.com/openai/codex/blob/rust-v0.160.0/codex-rs/codex-api/src/files.rs
// Called only after exact material-sharing approval, using this editor owner's
// login. No host credentials, credential logging, model-chosen paths, or URLs.
export async function uploadCodexFile({
  home,
  bytes,
  filename,
  mimeType,
  ensureActive = () => {},
  fetcher = fetch,
  lookup,
  onProgress = () => {},
}) {
  ensureActive();
  if (
    !home ||
    !Buffer.isBuffer(bytes) ||
    !bytes.length ||
    bytes.length > 50 * 1024 * 1024
  )
    throw new Error("전송할 소재 파일을 확인하세요.");
  let auth;
  try {
    auth = JSON.parse(await fs.readFile(path.join(home, "auth.json"), "utf8"));
  } catch {
    throw new Error("이 작업실의 Codex 로그인이 필요합니다.");
  }
  if (
    auth.auth_mode !== "chatgpt" ||
    !auth.tokens?.access_token ||
    !auth.tokens?.account_id
  )
    throw new Error("이 작업실의 ChatGPT 로그인을 확인하세요.");
  const headers = {
    Authorization: `Bearer ${auth.tokens.access_token}`,
    "ChatGPT-Account-ID": auth.tokens.account_id,
    "Content-Type": "application/json",
  };
  const base = "https://chatgpt.com/backend-api/files";
  async function request(url, options, stage) {
    ensureActive();
    let response;
    try {
      response = await fetcher(url, {
        ...options,
        redirect: "manual",
        signal: AbortSignal.timeout(60000),
      });
    } catch {
      throw new Error(`Codex 첨부파일 ${stage}: 네트워크 요청 실패`);
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(
        `Codex 첨부파일 ${stage}: HTTP ${response.status}${response.status === 401 ? " · 계정 연결을 갱신해 주세요." : ""}`,
      );
    }
    return response;
  }
  async function json(response) {
    try {
      return await response.json();
    } catch {
      throw new Error("Codex 첨부파일 응답 형식을 확인할 수 없습니다.");
    }
  }
  onProgress("첨부파일 전송 준비");
  const created = await json(
    await request(
      base,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          file_name: filename,
          file_size: bytes.length,
          use_case: "codex",
        }),
      },
      "준비",
    ),
  );
  if (
    typeof created.file_id !== "string" ||
    !/^[a-zA-Z0-9_-]{1,200}$/.test(created.file_id)
  )
    throw new Error("Codex 첨부파일 식별자가 올바르지 않습니다.");
  const uploadUrl = await publicHttps(created.upload_url, lookup);
  // Never forward the editor's OAuth headers to a returned storage URL.
  const uploaded = await request(
    uploadUrl,
    {
      method: "PUT",
      body: bytes,
      headers: {
        "x-ms-blob-type": "BlockBlob",
        "x-ms-client-request-id": randomUUID(),
        "Content-Length": String(bytes.length),
      },
    },
    "바이트 전송",
  );
  await uploaded.body?.cancel();
  onProgress("첨부파일 바이트 전송 완료");
  const deadline = Date.now() + 30000;
  while (true) {
    const result = await json(
      await request(
        `${base}/${created.file_id}/uploaded`,
        {
          method: "POST",
          headers,
          body: "{}",
        },
        "완료 확인",
      ),
    );
    if (result.status === "success") {
      await publicHttps(result.download_url, lookup);
      if (
        result.file_size_bytes !== undefined &&
        result.file_size_bytes !== bytes.length
      )
        throw new Error("Codex 첨부파일 크기가 선택한 소재와 다릅니다.");
      onProgress("첨부파일 등록 완료");
      return {
        file_id: created.file_id,
        download_url: result.download_url,
        file_name: filename,
        mime_type: mimeType,
      };
    }
    if (result.status !== "retry" || Date.now() >= deadline)
      throw new Error(
        "Codex 첨부파일 등록을 완료하지 못했습니다. 파일을 다시 보내지 않습니다.",
      );
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}
