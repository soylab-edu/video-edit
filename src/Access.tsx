import { useEffect, useState } from "react";
import { ArrowRight, Film, LockKeyhole, LogOut } from "lucide-react";
import App from "./App";

const invitation =
  new URLSearchParams(location.hash.slice(1)).get("invite") || "";
if (invitation)
  history.replaceState(null, "", location.pathname + location.search);
type Session = {
  enabled: boolean;
  authenticated: boolean;
  setupRequired: boolean;
};
export default function Access() {
  const [session, setSession] = useState<Session | null>(null);
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = async () => {
    const response = await fetch("/api/auth/session");
    if (!response.ok) throw new Error("편집 서버에 연결하지 못했습니다.");
    setSession(await response.json());
  };
  useEffect(() => {
    void refresh().catch((e) => setError(e.message));
  }, []);
  if (session?.authenticated)
    return (
      <>
        <App />
        {session.enabled && (
          <button
            className="workspace-logout"
            onClick={async () => {
              if (
                !confirm("저장된 작업은 유지됩니다. 작업실에서 로그아웃할까요?")
              )
                return;
              await fetch("/api/auth/logout", { method: "POST" });
              localStorage.removeItem("moa-project");
              location.reload();
            }}
          >
            <LogOut size={14} /> 로그아웃
          </button>
        )}
      </>
    );
  const setup = session?.setupRequired;
  return (
    <main className="access-page">
      <section className="access-story">
        <div className="access-brand">
          <Film size={24} /> moa<span>STUDIO</span>
        </div>
        <p className="access-eyebrow">YOUR STORY, BEAUTIFULLY TOLD</p>
        <h1>
          이야기를 만드는
          <br />
          가장 쉬운 시작.
        </h1>
        <p>
          컷 편집부터 사운드 분리, AI 자동편집까지.
          <br />
          당신의 작업실에서 하나로 이어집니다.
        </p>
        <div className="access-art">
          <div />
          <div />
          <div />
          <span>모든 장면에는, 당신만의 이야기가 있으니까.</span>
        </div>
      </section>
      <section className="access-form">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setError("");
            if (setup && password !== repeat)
              return setError("비밀번호가 서로 다릅니다.");
            setBusy(true);
            try {
              const response = await fetch(
                setup ? "/api/auth/setup" : "/api/auth/login",
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    password,
                    ...(setup ? { token: invitation } : {}),
                  }),
                },
              );
              const result = await response.json();
              if (!response.ok)
                throw new Error(result.error || "로그인하지 못했습니다.");
              setPassword("");
              setRepeat("");
              await refresh();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <span className="access-lock">
            <LockKeyhole size={22} />
          </span>
          <h2>
            {setup ? "나만의 작업실 열기" : "작업실에 오신 것을 환영해요"}
          </h2>
          <p>
            {setup
              ? "처음 한 번, 작업실을 보호할 비밀번호를 정하세요."
              : "비밀번호를 입력하고 편집을 이어가세요."}
          </p>
          {setup && !invitation ? (
            <div className="access-notice">
              운영자가 전달한 최초 설정 링크로 접속해 주세요.
            </div>
          ) : session ? (
            <>
              <label>
                작업실 비밀번호
                <input
                  aria-label="작업실 비밀번호"
                  type="password"
                  minLength={setup ? 12 : 1}
                  maxLength={256}
                  required
                  autoComplete={setup ? "new-password" : "current-password"}
                  placeholder={setup ? "12자 이상 입력" : "비밀번호 입력"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              {setup && (
                <label>
                  비밀번호 확인
                  <input
                    aria-label="비밀번호 확인"
                    type="password"
                    autoComplete="new-password"
                    required
                    value={repeat}
                    onChange={(e) => setRepeat(e.target.value)}
                  />
                </label>
              )}
              <button className="access-submit" disabled={busy}>
                {busy
                  ? "작업실을 여는 중…"
                  : setup
                    ? "비밀번호 설정하고 시작"
                    : "편집기 열기"}
                <ArrowRight size={18} />
              </button>
            </>
          ) : (
            <p>편집 서버에 연결하는 중…</p>
          )}
          {error && (
            <p role="alert" className="access-error">
              {error}
            </p>
          )}
          <p className="access-footnote">
            기본 편집은 FFmpeg로 처리합니다.
            <br />
            외부 AI 생성은 견적 확인과 승인 후에만 실행됩니다.
          </p>
        </form>
      </section>
    </main>
  );
}
