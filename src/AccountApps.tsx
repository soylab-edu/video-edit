import { useEffect, useState } from "react";
import { LoaderCircle, RefreshCw } from "lucide-react";
import { api, type Asset, type Project } from "./types";
import { CodexTaskPanel } from "./CodexTaskPanel";
export type EditorApp = {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  executionReady: boolean;
  authentication?: "verified" | "reauthentication" | "unverified";
  toolCount?: number;
};
type Inventory = {
  state: "not-connected" | "checking" | "ready" | "error";
  apps: EditorApp[];
  checkedAt: string | null;
  error?: string;
};
const checking: Inventory = { state: "checking", apps: [], checkedAt: null };
const selectedProviders = ["runway", "magnific", "heygen", "pixverse"];
export function AccountApps({
  connected,
  assets,
  project,
  onImported,
}: {
  connected: boolean;
  assets: Asset[];
  project: Project;
  onImported: () => Promise<void>;
}) {
  const [inventory, setInventory] = useState<Inventory>(checking);
  const [refresh, setRefresh] = useState(0);
  const [selected, setSelected] = useState<EditorApp | null>(null);
  useEffect(() => {
    if (!connected) {
      setSelected(null);
      return;
    }
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    setInventory(checking);
    async function poll(force = false) {
      try {
        const result = await api<Inventory>(
          "/connections/codex-apps" + (force ? "/refresh" : ""),
          force ? {} : undefined,
        );
        if (!active) return;
        setInventory(result);
        if (result.state === "checking")
          timer = setTimeout(() => void poll(), 1800);
      } catch {
        if (active)
          setInventory({
            state: "error",
            apps: [],
            checkedAt: null,
            error:
              "플러그인 실행 도구를 조회하지 못했습니다. 잠시 후 다시 조회해 주세요.",
          });
      }
    }
    void poll(refresh > 0);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [connected, refresh]);
  if (!connected)
    return (
      <section className="account-apps">
        <h3>편집 플러그인</h3>
        <p className="muted small">
          아래에서 ChatGPT 계정으로 로그인하면 Runway·Magnific·HeyGen·PixVerse의
          실행 도구를 확인합니다.
        </p>
      </section>
    );
  const apps = inventory.apps.filter((app) =>
    selectedProviders.includes(app.id),
  );
  return (
    <section className="account-apps" aria-label="편집 플러그인">
      <div className="account-apps-heading">
        <h3>편집에 필요한 플러그인</h3>
        <button
          className="text-button"
          disabled={inventory.state === "checking"}
          onClick={() => setRefresh((n) => n + 1)}
        >
          <RefreshCw size={13} /> 다시 조회
        </button>
      </div>
      <p className="muted small">
        로그인한 Codex에서 도구와 인증을 확인합니다. 생성 작업은 전체 보고서를
        검토하고 승인한 후에 실행합니다.
      </p>
      {inventory.state === "checking" && (
        <p className="account-apps-status" role="status">
          <LoaderCircle size={16} className="spin" /> 실행 도구와 연결 상태를
          확인하고 있어요…
        </p>
      )}
      {inventory.state === "error" && (
        <p role="alert" className="inline-error">
          {inventory.error}
        </p>
      )}
      <div className="account-apps-grid">
        {apps.map((app) => (
          <article className="account-app-card" key={app.id}>
            <span className="account-app-initial" aria-hidden="true">
              {app.name[0]}
            </span>
            <div>
              <h4>{app.name}</h4>
              <span
                className={
                  app.executionReady
                    ? "account-app-badge"
                    : "account-app-badge disabled"
                }
              >
                {app.executionReady
                  ? "실행 연결 확인됨"
                  : app.authentication === "reauthentication"
                    ? "제공업체 재인증 필요"
                    : "실행 도구 확인 필요"}
              </span>
              <p>{app.description}</p>
              {app.executionReady ? (
                <button
                  className="text-button"
                  onClick={() => setSelected(app)}
                >
                  Codex로 작업하기 →
                </button>
              ) : app.authentication === "reauthentication" ? (
                <a
                  href="https://chatgpt.com/apps"
                  target="_blank"
                  rel="noreferrer"
                  className="text-button"
                >
                  ChatGPT에서 연결 확인 ↗
                </a>
              ) : (
                <p>설치 여부와 별도로 이 서버의 호출 경로를 확인 중입니다.</p>
              )}
            </div>
          </article>
        ))}
      </div>
      {inventory.checkedAt && (
        <p className="account-apps-time">
          마지막 확인{" "}
          {new Date(inventory.checkedAt).toLocaleTimeString("ko-KR")}
        </p>
      )}
      {selected && (
        <CodexTaskPanel
          app={selected}
          assets={assets.filter((a) => !a.deleted)}
          project={project}
          onImported={onImported}
        />
      )}
      <p className="muted small account-apps-note">
        기본 음원 분리는 BandIt, 기본 내레이션은 Microsoft TTS를 사용합니다.
        플러그인 생성에는 해당 제공업체의 구독·크레딧이 적용됩니다.
      </p>
    </section>
  );
}
