import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";

const scrypt = promisify(scryptCallback);
const hash = (text) => createHash("sha256").update(text).digest("hex");
const equal = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  a.length === b.length &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
export async function atomicJson(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = file + "." + randomUUID() + ".tmp";
  await fs.writeFile(temp, JSON.stringify(data), { mode: 0o600 });
  await fs.rename(temp, file);
}
async function read(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

// A private single-workspace deployment. This is deliberately not multi-tenant registration.
export async function installAccess(app, { data, onLogout = () => {} }) {
  const enabled =
    process.env.MOA_AUTH_MODE === "required" ||
    (process.env.NODE_ENV === "production" &&
      process.env.MOA_AUTH_MODE !== "disabled");
  if (process.env.NODE_ENV === "production" && !enabled)
    throw new Error("Production requires workspace authentication.");
  const accessDir = path.join(data, "access");
  const accountFile = path.join(accessDir, "account.json"),
    inviteFile = path.join(accessDir, "invite.json"),
    sessionsFile = path.join(accessDir, "sessions.json");
  let account = enabled ? await read(accountFile) : null;
  let sessions = enabled ? (await read(sessionsFile)) || {} : {};
  const persistSessions = async () => {
    sessions = Object.fromEntries(
      Object.entries(sessions).filter(([, s]) => s.expires > Date.now()),
    );
    await atomicJson(sessionsFile, sessions);
  };
  let sessionWrite = Promise.resolve();
  const saveSessions = () =>
    (sessionWrite = sessionWrite.catch(() => {}).then(persistSessions));
  if (enabled && !account && !(await read(inviteFile))) {
    const token = randomBytes(32).toString("base64url");
    await atomicJson(inviteFile, {
      hash: hash(token),
      expires: Date.now() + 86400000,
    });
    await fs.writeFile(path.join(accessDir, "invite-token"), token, {
      mode: 0o600,
    });
    console.log(
      "Private workspace ready. Run npm run invite -- <public HTTPS address> to get the one-time setup link.",
    );
  }
  const cookieOptions = {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.COOKIE_SECURE === "1",
    path: "/",
    maxAge: 14 * 86400000,
  };
  app.use((req, res, next) => {
    res.set("X-Content-Type-Options", "nosniff");
    res.set("Referrer-Policy", "no-referrer");
    res.set("X-Frame-Options", "DENY");
    if (req.path.startsWith("/api/") || req.path.startsWith("/media/"))
      res.set("Cache-Control", "no-store");
    if (!enabled) return next();
    const token = (req.headers.cookie || "")
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("moa_access="))
      ?.slice(11);
    const session = token && sessions[hash(token)];
    if (account && session && session.expires > Date.now()) {
      req.accessOwner = account.owner;
      req.accessTokenHash = hash(token);
    }
    next();
  });
  app.get("/api/health", (req, res) =>
    res.json({ ok: true, service: "moa-studio" }),
  );
  app.get("/api/auth/session", (req, res) =>
    res.json({
      enabled,
      authenticated: !enabled || !!req.accessOwner,
      setupRequired: enabled && !account,
    }),
  );
  let failures = [],
    authBusy = false;
  const guarded = (fn) => async (req, res, next) => {
    failures = failures.filter((t) => Date.now() - t < 600000);
    if (!enabled)
      return res
        .status(404)
        .json({ error: "로그인이 필요하지 않은 개발 환경입니다." });
    if (failures.length >= 8 || authBusy)
      return res
        .status(429)
        .json({ error: "로그인 요청이 많습니다. 잠시 후 다시 시도하세요." });
    authBusy = true;
    try {
      await fn(req, res);
    } catch (e) {
      next(e);
    } finally {
      authBusy = false;
    }
  };
  const signIn = async (res) => {
    const token = randomBytes(32).toString("base64url");
    sessions[hash(token)] = { expires: Date.now() + cookieOptions.maxAge };
    await saveSessions();
    res.cookie("moa_access", token, cookieOptions);
    res.json({ ok: true });
  };
  app.post(
    "/api/auth/setup",
    guarded(async (req, res) => {
      if (account)
        return res
          .status(409)
          .json({ error: "이미 설정된 작업실입니다. 로그인하세요." });
      const invitation = await read(inviteFile);
      const { token, password } = req.body || {};
      if (
        typeof token !== "string" ||
        !invitation ||
        invitation.expires < Date.now() ||
        !equal(invitation.hash, hash(token))
      ) {
        failures.push(Date.now());
        return res
          .status(403)
          .json({ error: "유효한 최초 설정 링크가 필요합니다." });
      }
      if (
        typeof password !== "string" ||
        password.length < 12 ||
        password.length > 256
      )
        return res
          .status(400)
          .json({ error: "비밀번호는 12~256자로 설정하세요." });
      const salt = randomBytes(16).toString("hex");
      const passwordHash = (await scrypt(password, salt, 64)).toString("hex");
      account = { owner: randomUUID(), salt, passwordHash };
      await atomicJson(accountFile, account);
      await fs.rm(inviteFile, { force: true });
      await fs.rm(path.join(accessDir, "invite-token"), { force: true });
      await signIn(res);
    }),
  );
  app.post(
    "/api/auth/login",
    guarded(async (req, res) => {
      const password = req.body?.password;
      const candidate =
        typeof password === "string" && password.length <= 256 && account
          ? (await scrypt(password, account.salt, 64)).toString("hex")
          : "";
      if (!account || !equal(candidate, account.passwordHash)) {
        failures.push(Date.now());
        return res.status(401).json({ error: "비밀번호를 확인하세요." });
      }
      failures = [];
      await signIn(res);
    }),
  );
  app.post("/api/auth/logout", async (req, res, next) => {
    try {
      if (req.accessTokenHash) {
        delete sessions[req.accessTokenHash];
        await saveSessions();
        onLogout(req.accessOwner);
      }
      res.clearCookie("moa_access", cookieOptions);
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });
  app.use((req, res, next) => {
    if (
      enabled &&
      !req.accessOwner &&
      /^\/(api|media|demo)(\/|$)/.test(req.path)
    )
      return res.status(401).json({ error: "작업실에 로그인해 주세요." });
    next();
  });
}
