import { useEffect, useState } from "react";
import { LoaderCircle, ShieldCheck, Sparkles } from "lucide-react";
import { api, type Asset, type Project } from "./types";
import type { EditorApp } from "./AccountApps";
type Task = {
  id: string;
  providerId: string;
  state: string;
  message?: string;
  error?: string;
  activities: string[];
  outputs: { id: string; url: string; tool: string }[];
  references: { name: string; kind: string }[];
  report?: {
    id: string;
    summary: string;
    calls: {
      tool: string;
      arguments: unknown;
      purpose: string;
      estimatedCredits: number | null;
      pricingSource: string;
    }[];
    followUp: string;
    expiresAt: number;
    status: string;
  };
};
const active = (task: Task | null) =>
  !!task && ["starting", "running", "awaiting-approval"].includes(task.state);
export function CodexTaskPanel({
  app,
  assets,
  project,
  onImported,
}: {
  app: EditorApp;
  assets: Asset[];
  project: Project;
  onImported: () => Promise<void>;
}) {
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState("none");
  const [boundary, setBoundary] = useState(0);
  const [references, setReferences] = useState<string[]>([]);
  const [frameMode, setFrameMode] = useState(true);
  const [task, setTask] = useState<Task | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [consent, setConsent] = useState(false);
  useEffect(() => {
    let current = true;
    void api<Task[]>("/codex-tasks")
      .then((list) => {
        if (current) setTask(list.find((t) => t.providerId === app.id) || null);
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [app.id]);
  useEffect(() => {
    if (!active(task)) return;
    const timer = setInterval(() => {
      void api<Task>("/codex-tasks/" + task!.id)
        .then(setTask)
        .catch((e) => setError(e.message));
    }, 1500);
    return () => clearInterval(timer);
  }, [task?.id, task?.state]);
  useEffect(() => setConsent(false), [task?.report?.id]);
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function start() {
    await action(async () => {
      let refs: { assetId: string; kind: string; time?: number }[] = [];
      if (mode === "f2f") {
        const left = project.clips[boundary],
          right = project.clips[boundary + 1];
        if (!left || !right) throw new Error("연결할 두 컷을 선택하세요.");
        refs = [
          {
            assetId: left.assetId,
            kind: "image",
            time: Math.max(left.in, left.out - 1 / 24),
          },
          { assetId: right.assetId, kind: "image", time: right.in },
        ];
      }
      if (mode === "refs")
        refs = references.map((id) => {
          const a = assets.find((a) => a.id === id)!;
          return {
            assetId: id,
            kind: a.type === "audio" ? "audio" : frameMode ? "image" : "video",
            ...(frameMode && a.type === "video" ? { time: 0 } : {}),
          };
        });
      setTask(
        await api("/codex-tasks", {
          providerId: app.id,
          prompt,
          mode,
          references: refs,
        }),
      );
    });
  }
  async function importOutput(outputId: string) {
    await action(async () => {
      const job = await api("/codex-tasks/" + task!.id + "/import", {
        outputId,
      });
      for (let i = 0; i < 300; i++) {
        await new Promise((r) => setTimeout(r, 1200));
        const j = await api("/jobs/" + job.id);
        if (j.status === "failed") throw new Error(j.error);
        if (j.status === "completed") {
          await onImported();
          return;
        }
      }
      throw new Error(
        "가져오기가 진행 중입니다. 잠시 후 미디어를 새로고침하세요.",
      );
    });
  }
  return (
    <div className="codex-task-panel">
      <h3>
        <Sparkles size={16} /> {app.name} · Codex 작업
      </h3>
      {!active(task) && (
        <>
          <label className="form-label">
            원하는 편집·생성
            <textarea
              aria-label="플러그인 작업 요청"
              rows={4}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="예: 두 컷 사이를 자연스럽게 잇는 짧은 영상을 만들어줘. 먼저 방법과 예상 비용을 알려줘."
            />
          </label>
          <label className="form-label">
            참조 방식
            <select value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="none">텍스트로 요청</option>
              <option value="f2f" disabled={project.clips.length < 2}>
                F2F · 앞 컷 끝과 뒤 컷 시작
              </option>
              <option value="refs">Omni / Ref · 선택한 소재</option>
            </select>
          </label>
          {mode === "f2f" && (
            <label className="form-label">
              연결할 컷
              <select
                value={boundary}
                onChange={(e) => setBoundary(+e.target.value)}
              >
                {project.clips.slice(0, -1).map((clip, i) => (
                  <option key={clip.id} value={i}>
                    {clip.name} → {project.clips[i + 1].name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {mode === "refs" && (
            <div className="task-reference-list">
              <label>
                <input
                  type="checkbox"
                  checked={frameMode}
                  onChange={(e) => setFrameMode(e.target.checked)}
                />{" "}
                영상은 첫 프레임을 이미지로 참조
              </label>
              {assets.map((a) => (
                <label key={a.id}>
                  <input
                    type="checkbox"
                    checked={references.includes(a.id)}
                    onChange={(e) =>
                      setReferences((ids) =>
                        e.target.checked
                          ? [...ids.slice(0, 5), a.id]
                          : ids.filter((id) => id !== a.id),
                      )
                    }
                  />
                  {a.name}
                </label>
              ))}
            </div>
          )}
          <p className="muted small">
            계정·모델 조회와 작업 계획에는 Codex 구독 사용량이 적용됩니다. 소재
            전송과 생성은 승인 전 실행하지 않습니다.
          </p>
          <button
            className="primary full"
            disabled={busy || prompt.trim().length < 3}
            onClick={() => void start()}
          >
            <Sparkles size={15} /> Codex에 작업 계획 요청
          </button>
        </>
      )}
      {task && (
        <div className="codex-task-progress">
          <p role="status">
            {active(task) && <LoaderCircle size={14} className="spin" />}{" "}
            {task.state === "awaiting-approval"
              ? "전체 작업 보고서 · 승인 대기"
              : task.state === "running" || task.state === "starting"
                ? "Codex 작업 중"
                : task.state === "completed"
                  ? "작업 응답 완료"
                  : "작업 중단·확인 필요"}
          </p>
          {task.activities.slice(-3).map((text, i) => (
            <p className="muted small" key={i}>
              {text}
            </p>
          ))}
          {task.report && (
            <div className="codex-task-review">
              <h4>
                <ShieldCheck size={16} />{" "}
                {task.report.status === "approved"
                  ? "승인한 작업"
                  : "실행 전 확인"}
              </h4>
              <p>{task.report.summary}</p>
              <ol>
                {task.report.calls.map((call, i) => (
                  <li key={i}>
                    <strong>{call.purpose}</strong>
                    <p>
                      Codex 예상 비용:{" "}
                      {call.estimatedCredits === null
                        ? "확인되지 않음"
                        : `${call.estimatedCredits} 크레딧`}
                    </p>
                    <p className="muted small">
                      {call.pricingSource || "제공업체 확정 견적 없음"}
                    </p>
                    <details>
                      <summary>전송할 설정 확인</summary>
                      <pre>{JSON.stringify(call.arguments, null, 2)}</pre>
                    </details>
                  </li>
                ))}
              </ol>
              <p className="small">
                전송 소재:{" "}
                {task.references.length
                  ? task.references.map((r) => r.name).join(", ")
                  : "없음 · 요청 텍스트 전송"}
              </p>
              <p>
                <strong>
                  {task.report.calls.every((c) => c.estimatedCredits === null)
                    ? "전체 비용 미확인"
                    : `알려진 예상 합계: ${task.report.calls.reduce((sum, c) => sum + (c.estimatedCredits || 0), 0)} 크레딧`}
                  {task.report.calls.some((c) => c.estimatedCredits === null)
                    ? ` · 미확인 ${task.report.calls.filter((c) => c.estimatedCredits === null).length}건`
                    : ""}
                </strong>
              </p>
              {task.report.followUp && <p>{task.report.followUp}</p>}
              {task.state === "awaiting-approval" && (
                <>
                  <label className="task-consent">
                    <input
                      type="checkbox"
                      checked={consent}
                      onChange={(e) => setConsent(e.target.checked)}
                    />{" "}
                    예상액은 확정 견적이 아니며 미확인 비용이 있을 수 있음을
                    확인했습니다. 위 작업과 선택한 소재 전송, 제공업체 크레딧
                    사용을 승인합니다.
                  </label>
                  <button
                    className="primary full"
                    disabled={
                      !consent || busy || task.report.expiresAt < Date.now()
                    }
                    onClick={() =>
                      void action(async () =>
                        setTask(
                          await api("/codex-tasks/" + task.id + "/approve", {
                            reportId: task.report!.id,
                            approved: true,
                            acknowledgeEstimatedCost: true,
                          }),
                        ),
                      )
                    }
                  >
                    승인한 작업만 실행
                  </button>
                </>
              )}
            </div>
          )}
          {task.message && <p className="task-message">{task.message}</p>}
          {task.error && (
            <p className="inline-error" role="alert">
              {task.error}
            </p>
          )}
          {task.outputs.map((out, i) => (
            <div className="task-output" key={out.id}>
              <a href={out.url} target="_blank" rel="noreferrer">
                결과 {i + 1} 열기 ↗
              </a>
              <button
                className="text-button"
                disabled={busy}
                onClick={() => void importOutput(out.id)}
              >
                미디어로 가져오기
              </button>
            </div>
          ))}
          {active(task) && (
            <button
              className="text-button danger"
              disabled={busy}
              onClick={() =>
                void action(async () =>
                  setTask(await api("/codex-tasks/" + task.id + "/cancel", {})),
                )
              }
            >
              작업 거절·중단
            </button>
          )}
        </div>
      )}
      {busy && (
        <p role="status" className="muted small">
          처리 중…
        </p>
      )}
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
    </div>
  );
}
