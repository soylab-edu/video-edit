import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { atomicJson } from "../server/access.mjs";

const data = path.resolve(process.env.MOA_DATA_DIR || ".data");
const base = process.argv[2];
if (!base || !/^https?:\/\//.test(base))
  throw new Error("Usage: npm run invite -- <your editor URL>");
const url = new URL(base);
if (
  url.protocol !== "https:" &&
  !["127.0.0.1", "localhost"].includes(url.hostname)
)
  throw new Error("Remote workspaces require HTTPS.");
const dir = path.join(data, "access");
try {
  await fs.access(path.join(dir, "account.json"));
  console.log(
    "This workspace is already configured. Open the editor and use your password.",
  );
  process.exit(0);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
await fs.mkdir(dir, { recursive: true });
let token;
try {
  const invite = JSON.parse(
    await fs.readFile(path.join(dir, "invite.json"), "utf8"),
  );
  token = await fs.readFile(path.join(dir, "invite-token"), "utf8");
  if (invite.expires <= Date.now()) token = null;
} catch {}
if (!token) {
  token = randomBytes(32).toString("base64url");
  await atomicJson(path.join(dir, "invite.json"), {
    hash: createHash("sha256").update(token).digest("hex"),
    expires: Date.now() + 86400000,
  });
  await fs.writeFile(path.join(dir, "invite-token"), token, { mode: 0o600 });
}
url.hash = new URLSearchParams({ invite: token }).toString();
console.log("One-time setup link (valid for 24 hours; keep private):");
console.log(url.href);
