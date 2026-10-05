import fs from "node:fs/promises";
import dns from "node:dns/promises";
import { publicHttps } from "./media-transfer.mjs";
import { uploadCodexFile } from "./codex-file-upload.mjs";

function payload(result) {
  if (result.isError) {
    const details = result.structuredContent || {};
    const text =
      details.message ||
      details.error?.message ||
      (result.content || [])
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join(" ");
    const safe = String(
      text || details.error_code || "응답에 원인이 제공되지 않았습니다.",
    )
      .replace(/https?:\/\/[^\s"<>]+/g, "[주소 생략]")
      .replace(/Bearer\s+\S+|eyJ[A-Za-z0-9_.-]+/g, "[인증 정보 생략]")
      .slice(0, 1200);
    throw new Error("Runway 업로드 초기화/완료 오류: " + safe);
  }
  if (result.structuredContent) return result.structuredContent;
  for (const item of result.content || []) {
    if (item.type === "text") {
      try {
        return JSON.parse(item.text);
      } catch {}
    }
  }
  throw new Error("Runway 업로드 응답 형식을 확인할 수 없습니다.");
}

// Invoked only by an exactly approved Moa operation. The planner cannot choose
// local paths, upload destinations, upload IDs, HTTP headers, or completion parts.
export async function uploadRunwayReference({
  reference,
  file,
  mimeType,
  call,
  rationale,
  codexHome,
  onProgress,
  uploadFile = uploadCodexFile,
  ensureActive = () => {},
  lookup = dns.lookup,
  fetcher = fetch,
}) {
  ensureActive();
  const bytes = await fs.readFile(file);
  if (
    !bytes.length ||
    bytes.length > 50 * 1024 * 1024 ||
    !["image/jpeg", "video/mp4"].includes(mimeType)
  )
    throw new Error("Runway 참조는 JPG/MP4 파일당 50MB까지 지원합니다.");
  const filename = `moa-reference-${reference.split("/").at(-1)}.${mimeType === "image/jpeg" ? "jpg" : "mp4"}`;
  const attachment = await uploadFile({
    home: codexHome,
    bytes,
    filename,
    mimeType,
    ensureActive,
    onProgress,
  });
  ensureActive();
  const initialized = payload(
    await call("runway.init_upload", {
      file: attachment,
      filename,
      fileSize: bytes.length,
      mimeType,
      ...(rationale ? { rationale } : {}),
    }),
  );
  if (initialized.kind === "upload_complete") {
    await publicHttps(initialized.assetUrl, lookup);
    return initialized.assetUrl;
  }
  const urls = initialized.uploadUrls;
  const partSize = initialized.partSizeBytes || bytes.length;
  if (
    initialized.kind !== "upload_initialized" ||
    typeof initialized.uploadId !== "string" ||
    !Array.isArray(urls) ||
    !urls.length ||
    urls.length > 32 ||
    !Number.isSafeInteger(partSize) ||
    partSize < 1 ||
    urls.length !== Math.ceil(bytes.length / partSize)
  )
    throw new Error("Runway 임시 업로드 정보를 확인할 수 없습니다.");
  const headers = { "Content-Type": mimeType };
  for (const [key, value] of Object.entries(initialized.uploadHeaders || {})) {
    if (
      /^(authorization|proxy-authorization|cookie|host|origin|referer|connection)$/i.test(
        key,
      ) ||
      !/^[a-z0-9-]+$/i.test(key) ||
      typeof value !== "string" ||
      /[\r\n]/.test(value)
    )
      throw new Error("Runway 업로드 헤더가 허용 범위를 벗어났습니다.");
    headers[key] = value;
  }
  // Validate every destination before the first byte is transmitted.
  const targets = [];
  for (const url of urls) targets.push(await publicHttps(url, lookup));
  const parts = [];
  for (let i = 0; i < targets.length; i++) {
    ensureActive();
    const response = await fetcher(targets[i], {
      method: "PUT",
      headers,
      body: bytes.subarray(
        i * partSize,
        Math.min((i + 1) * partSize, bytes.length),
      ),
      redirect: "manual",
      signal: AbortSignal.timeout(120000),
    });
    const etag = response.headers.get("etag")?.replace(/^"|"$/g, "");
    await response.body?.cancel();
    if (!response.ok || !etag)
      throw new Error(
        "Runway 소재 전송에 실패했습니다. 자동 재전송하지 않습니다.",
      );
    parts.push({ partNumber: i + 1, etag });
  }
  ensureActive();
  const complete = payload(
    await call("runway.complete_upload", {
      uploadId: initialized.uploadId,
      parts,
      ...(rationale ? { rationale } : {}),
    }),
  );
  await publicHttps(complete.assetUrl, lookup);
  return complete.assetUrl;
}
