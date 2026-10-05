import dns from "node:dns/promises";
import net from "node:net";
import fs from "node:fs/promises";
import { randomBytes } from "node:crypto";

export function createShares() {
  const entries = new Map();
  return {
    issue(file, type, taskId) {
      for (const [key, item] of entries)
        if (item.expires < Date.now()) entries.delete(key);
      const token = randomBytes(32).toString("hex");
      entries.set(token, {
        file,
        type,
        taskId,
        expires: Date.now() + 45 * 60000,
      });
      return token;
    },
    get(token) {
      const entry = /^[a-f0-9]{64}$/.test(token) && entries.get(token);
      return entry && entry.expires > Date.now() ? entry : null;
    },
    revoke(taskId) {
      for (const [key, item] of entries)
        if (item.taskId === taskId) entries.delete(key);
    },
  };
}
export function privateAddress(ip) {
  if (ip.includes(":"))
    return !/^[23][0-9a-f]{0,3}:/i.test(ip) || /^2001:db8:/i.test(ip);
  const a = ip.split(".").map(Number);
  return (
    a.length !== 4 ||
    a[0] === 0 ||
    a[0] === 10 ||
    a[0] === 127 ||
    a[0] >= 224 ||
    (a[0] === 169 && a[1] === 254) ||
    (a[0] === 172 && a[1] >= 16 && a[1] <= 31) ||
    (a[0] === 192 && a[1] === 168) ||
    (a[0] === 100 && a[1] >= 64 && a[1] <= 127)
  );
}
export async function downloadOutput(
  value,
  file,
  { lookup = dns.lookup, fetcher = fetch } = {},
) {
  let current = value;
  for (let step = 0; step < 5; step++) {
    const url = new URL(current);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      (url.port && url.port !== "443")
    )
      throw new Error("HTTPS 미디어 주소만 가져올 수 있습니다.");
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    const addresses = net.isIP(hostname)
      ? [{ address: hostname }]
      : await lookup(hostname, { all: true });
    if (!addresses.length || addresses.some((a) => privateAddress(a.address)))
      throw new Error("내부 네트워크 주소는 가져올 수 없습니다.");
    const response = await fetcher(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(120000),
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      current = new URL(response.headers.get("location"), url).href;
      continue;
    }
    if (!response.ok || !response.body)
      throw new Error(
        "제공업체의 결과 파일을 내려받지 못했습니다. 결과 링크의 유효기간을 확인하세요.",
      );
    const limit = 100 * 1024 * 1024;
    if (Number(response.headers.get("content-length")) > limit) {
      await response.body.cancel();
      throw new Error("생성 결과 가져오기는 파일당 100MB까지 지원합니다.");
    }
    const handle = await fs.open(file, "wx");
    let bytes = 0;
    try {
      for await (const chunk of response.body) {
        bytes += chunk.length;
        if (bytes > limit) throw new Error("생성 결과가 100MB를 초과합니다.");
        await handle.writeFile(chunk);
      }
    } finally {
      await handle.close();
    }
    return;
  }
  throw new Error("결과 파일의 이동 경로가 너무 깁니다.");
}
