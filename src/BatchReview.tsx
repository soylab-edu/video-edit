import { useState } from "react";
import { Check, LoaderCircle, ShieldCheck } from "lucide-react";
import { api, type Plugin } from "./types";
export function BatchReview({
  report,
  plugins,
  busy,
  onApprove,
  onConnect,
}: {
  report: any;
  plugins: Plugin[];
  busy: boolean;
  onApprove: (id: string) => void;
  onConnect: () => void;
}) {
  const [selected, setSelected] = useState<number[]>(
      report.repairs.map((_: any, i: number) => i),
    ),
    [choices, setChoices] = useState<Record<number, string>>({}),
    [batch, setBatch] = useState<any>(null),
    [pending, setPending] = useState(false),
    [error, setError] = useState("");
  async function quote() {
    setPending(true);
    setError("");
    try {
      const ids = [];
      for (const i of selected) {
        const task = report.repairs[i],
          provider = plugins.find(
            (p) =>
              p.id ===
              (choices[i] ||
                plugins.find(
                  (p) =>
                    p.capabilities.includes(task.type) &&
                    (task.type !== "video-generation" ||
                      p.modes?.includes(task.mode)),
                )?.id),
          );
        if (!provider)
          throw new Error(`${i + 1}번 작업에 사용할 플러그인이 없습니다.`);
        const index = report.sourceClips.findIndex(
            (c: any) => c.id === task.afterClipId,
          ),
          left = report.sourceClips[index],
          right = report.sourceClips[index + 1];
        if (task.type === "video-generation" && (!left || !right))
          throw new Error(
            "연결 장면의 앞뒤 클립을 찾을 수 없습니다. AI 연결 도구에서 컷을 지정해 주세요.",
          );
        const proposal = await api("/proposals", {
          pluginId: provider.id,
          capability: task.type,
          ...(task.type === "video-generation" ? { mode: task.mode } : {}),
          prompt: task.prompt,
          duration: task.duration,
          assetIds:
            task.type === "video-generation"
              ? [left.assetId, right.assetId]
              : task.type === "image-generation" && left
                ? [left.assetId]
                : [],
          ...(task.type === "video-generation" && task.mode === "f2f"
            ? {
                frameRefs: [
                  {
                    assetId: left.assetId,
                    time: Math.max(left.in, left.out - 1 / 24),
                  },
                  { assetId: right.assetId, time: right.in },
                ],
              }
            : {}),
        });
        ids.push(proposal.id);
      }
      setBatch(await api("/proposal-batches", { ids }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="modal-content">
      <div className="approval-banner">
        <ShieldCheck size={23} />
        <p>
          1차 편집 후 필요한 생성 작업을 함께 검토합니다. 선택한 모든 작업의
          견적을 확인한 뒤에만 파일 전송과 생성이 시작됩니다.
        </p>
      </div>
      {!batch ? (
        <>
          {report.repairs.map((r: any, i: number) => (
            <div className="batch-task" key={i}>
              <label>
                <input
                  type="checkbox"
                  checked={selected.includes(i)}
                  onChange={(e) =>
                    setSelected((v) =>
                      e.target.checked ? [...v, i] : v.filter((x) => x !== i),
                    )
                  }
                />
                <strong>
                  {i + 1}.{" "}
                  {r.type === "video-generation"
                    ? "연결 영상"
                    : r.type === "image-generation"
                      ? "참조 이미지"
                      : "효과음"}{" "}
                  · {r.duration}초
                </strong>
              </label>
              <p>{r.reason}</p>
              <blockquote>{r.prompt}</blockquote>
              <select
                aria-label={`${i + 1}번 작업 플러그인`}
                value={
                  choices[i] ||
                  plugins.find(
                    (p) =>
                      p.capabilities.includes(r.type) &&
                      (r.type !== "video-generation" ||
                        p.modes?.includes(r.mode)),
                  )?.id ||
                  ""
                }
                onChange={(e) =>
                  setChoices((c) => ({ ...c, [i]: e.target.value }))
                }
              >
                <option value="">플러그인 선택</option>
                {plugins
                  .filter(
                    (p) =>
                      p.capabilities.includes(r.type) &&
                      (r.type !== "video-generation" ||
                        p.modes?.includes(r.mode)),
                  )
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </div>
          ))}
          {!plugins.length && (
            <button className="secondary full" onClick={onConnect}>
              사용 가능한 플러그인 연결
            </button>
          )}
          <button
            className="primary full"
            disabled={pending || !selected.length || !plugins.length}
            onClick={() => void quote()}
          >
            {pending ? (
              <LoaderCircle size={16} className="spin" />
            ) : (
              <ShieldCheck size={16} />
            )}
            선택한 작업 전체 견적 확인
          </button>
        </>
      ) : (
        <>
          <div className="export-settings">
            {Object.entries(batch.totals).map(([currency, cost]) => (
              <div key={currency}>
                <span>총 견적 ({batch.items.length}개 작업)</span>
                <strong>
                  {Number(cost).toFixed(2)} {currency}
                </strong>
              </div>
            ))}
          </div>
          {batch.items.map((p: any) => (
            <div className="batch-task" key={p.id}>
              <h3>
                {plugins.find((x) => x.id === p.input.pluginId)?.name} ·{" "}
                {p.quote.cost} {p.quote.currency}
              </h3>
              <p>{p.input.prompt}</p>
              <small>
                전송:{" "}
                {p.assets.map((a: any) => a.name).join(", ") || "텍스트만"}
                {p.input.mode === "f2f" ? " (지정한 시작·끝 프레임)" : ""}
              </small>
            </div>
          ))}
          <p className="muted small">
            작업은 순서대로 실행됩니다. 한 작업이 실패하면 이후 작업을 중단하며
            완료된 결과는 보관합니다. 이미 시작된 작업은 제공업체에 따라 과금될
            수 있습니다.
          </p>
          <button
            className="primary full"
            disabled={busy}
            onClick={() => onApprove(batch.id)}
          >
            <Check size={16} />
            전체 자료 전송 및 생성 승인
          </button>
          <button
            className="text-button centered"
            disabled={busy}
            onClick={() => setBatch(null)}
          >
            선택 수정 · 견적 다시 받기
          </button>
        </>
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
