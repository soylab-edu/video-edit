import { useEffect, useState } from "react";
import {
  ArrowRight,
  Check,
  Download,
  Film,
  LoaderCircle,
  ShieldCheck,
  Sparkles,
  Zap,
} from "lucide-react";
import { api, total, clock, type Project, type Status } from "./types";
export function AutoEditor({
  project,
  status,
  busy,
  result,
  onRun,
  onApply,
  onConnect,
  onReview,
}: {
  project: Project;
  status: Status | null;
  busy: boolean;
  result: any;
  onRun: (input: any) => void;
  onApply: () => void;
  onConnect: () => void;
  onReview: () => void;
}) {
  const [styles, setStyles] = useState<any[]>([]),
    [style, setStyle] = useState("none"),
    [engine, setEngine] = useState<"local" | "codex">("local"),
    [target, setTarget] = useState(
      Math.max(3, Math.round(total(project) * 0.75)),
    ),
    [instructions, setInstructions] = useState(
      "이야기의 흐름을 유지하면서 지루한 구간을 정리해 주세요.",
    ),
    [silence, setSilence] = useState(true),
    [normalize, setNormalize] = useState(true),
    [error, setError] = useState("");
  useEffect(() => {
    api("/styles")
      .then(setStyles)
      .catch((e) => setError(e.message));
  }, []);
  const chosen = styles.find((s) => s.id === style);
  if (result)
    return (
      <div className="modal-content auto-report">
        <div className="report-success">
          <Check size={25} />
          <div>
            <h3>1차 편집본이 완성됐어요</h3>
            <p>
              생성 크레딧 사용 0 ·{" "}
              {result.report.apiBilling
                ? "Codex API 사용료 별도"
                : result.report.codexSubscription
                  ? "Codex 구독 사용량 적용"
                  : "AI 호출 없음"}
            </p>
          </div>
        </div>
        <video controls src={result.render.url} />
        <div className="report-numbers">
          <span>
            <strong>{clock(result.report.sourceDuration)}</strong>원본 길이
          </span>
          <ArrowRight size={18} />
          <span>
            <strong>{clock(result.report.resultDuration)}</strong>편집 후
          </span>
          <span>
            <strong>{result.report.edits.length}</strong>완성된 컷
          </span>
        </div>
        <p className="muted leading">{result.report.summary}</p>
        <h3 className="report-section-title">
          적용된 편집 · {result.report.style}
        </h3>
        <div className="edit-report">
          {result.report.edits.map((c: any, i: number) => (
            <div key={i}>
              <span>{String(i + 1).padStart(2, "0")}</span>
              <p>
                {c.in.toFixed(1)}초 → {c.out.toFixed(1)}초
                <small>{c.reason}</small>
              </p>
            </div>
          ))}
        </div>
        <h3 className="report-section-title">생성이 필요한 보완 제안</h3>
        {result.report.repairs.length ? (
          <>
            <div className="repair-list">
              {result.report.repairs.map((r: any, i: number) => (
                <div key={i}>
                  <Sparkles size={16} />
                  <div>
                    <strong>
                      {r.type === "video-generation"
                        ? "연결 장면"
                        : r.type === "sound-effects"
                          ? "효과음"
                          : "참조 이미지"}{" "}
                      · {r.duration}초
                    </strong>
                    <p>{r.reason}</p>
                  </div>
                </div>
              ))}
            </div>
            <button className="secondary full" onClick={onReview}>
              <ShieldCheck size={15} />
              전체 작업·전송 자료·견적 검토
            </button>
          </>
        ) : (
          <div className="info-box">
            {result.report.engine === "local"
              ? "로컬 편집은 생성 필요 여부를 판단하지 않습니다. 편집본을 검토한 뒤 AI 연결 도구를 사용하거나 Codex에 재편집을 맡길 수 있습니다."
              : "Codex가 이번 편집에서 제안한 생성 작업은 없습니다."}
          </div>
        )}
        <details className="report-details">
          <summary>검토할 사항</summary>
          {result.report.notes.map((n: string) => (
            <p key={n}>{n}</p>
          ))}
        </details>
        <div className="modal-actions">
          <a
            className="secondary"
            href={result.render.url}
            download={result.render.name}
          >
            <Download size={15} />
            MP4 다운로드
          </a>
          <button className="primary" onClick={onApply}>
            <Check size={16} />이 편집본으로 계속하기
          </button>
        </div>
      </div>
    );
  return (
    <form
      className="modal-content"
      onSubmit={(e) => {
        e.preventDefault();
        onRun({
          project,
          engine,
          style,
          target,
          instructions,
          removeSilence: silence,
          normalize,
        });
      }}
    >
      <div className="auto-banner">
        <Sparkles size={23} />
        <div>
          <strong>첫 컷부터 1차 편집본까지 맡겨보세요.</strong>
          <p>분석 → 컷 편집 → 음량 정리 → 렌더링 → 보완 보고</p>
        </div>
      </div>
      <label className="form-label">어떻게 맡길까요?</label>
      <div className="engine-cards">
        <button
          type="button"
          className={engine === "local" ? "selected" : ""}
          onClick={() => setEngine("local")}
        >
          <Zap size={19} />
          <strong>
            로컬 자동편집 <span>크레딧 0</span>
          </strong>
          <small>FFmpeg 규칙 기반 · 외부 전송 없음</small>
        </button>
        <button
          type="button"
          className={engine === "codex" ? "selected" : ""}
          onClick={() => setEngine("codex")}
        >
          <Sparkles size={19} />
          <strong>Codex에게 맡기기</strong>
          <small>장면을 보고 계획 · 연결한 계정의 사용량 적용</small>
        </button>
      </div>
      {engine === "codex" && !status?.codex && (
        <button type="button" className="connect-notice" onClick={onConnect}>
          Codex 연결이 필요합니다 <ArrowRight size={15} />
        </button>
      )}
      <label className="form-label">편집 스타일</label>
      <div className="director-grid">
        {styles.map((s) => (
          <button
            key={s.id}
            type="button"
            className={style === s.id ? "selected" : ""}
            onClick={() => setStyle(s.id)}
            style={{ "--director-accent": s.color } as React.CSSProperties}
          >
            <span>
              {s.id === "none" ? (
                <Sparkles size={17} />
              ) : (
                s.name
                  .split(" ")
                  .map((s: string) => s[0])
                  .join("")
              )}
            </span>
            <div>
              <strong>{s.name}</strong>
              <small>{s.english}</small>
            </div>
            {style === s.id && <Check size={14} />}
          </button>
        ))}
      </div>
      {chosen && (
        <div className="director-explanation">
          <strong>{chosen.description}</strong>
          <ul>
            {chosen.principles.map((p: string) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          {style !== "none" && (
            <details>
              <summary>{chosen.research}</summary>
              <p>
                영화의 촬영·연기·서사를 재현하는 기능이 아닙니다. 공개 자료를
                바탕으로 컷 리듬을 설계한 편집 해석입니다. 의미·구도에 따른
                선택은 Codex가 대표 프레임을 확인한 범위 안에서 제안합니다.
              </p>
              {chosen.sources.map((s: any) => (
                <a key={s.url} href={s.url} target="_blank" rel="noreferrer">
                  {s.title} ↗ · {s.verified ? "자료 확인" : "확인 대기"}
                </a>
              ))}
            </details>
          )}
        </div>
      )}
      <div className="two-inputs">
        <label>
          목표 길이 (초)
          <input
            type="number"
            min="3"
            max="600"
            value={target}
            onChange={(e) => setTarget(+e.target.value)}
          />
        </label>
        <label>
          현재 영상 길이
          <input readOnly value={clock(total(project))} />
        </label>
      </div>
      <label className="form-label">
        편집 의도
        <textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          rows={3}
          maxLength={3000}
        />
      </label>
      {engine === "local" && (
        <p className="muted small">
          로컬 모드는 아래 설정과 선택한 리듬 규칙을 사용합니다. 자유로운 문장
          지시는 Codex 모드에서 해석됩니다.
        </p>
      )}
      <div className="auto-options">
        <label>
          <input
            type="checkbox"
            checked={silence}
            onChange={(e) => setSilence(e.target.checked)}
          />
          무음 구간 정리
        </label>
        <label>
          <input
            type="checkbox"
            checked={normalize}
            onChange={(e) => setNormalize(e.target.checked)}
          />
          음량 정규화
        </label>
      </div>
      <div className="info-box">
        <ShieldCheck size={17} />
        {engine === "codex"
          ? "Codex에 대표 프레임·클립 이름·무음 분석을 전송해 편집 계획을 만듭니다. "
          : "미디어가 외부에 전송되지 않습니다. "}
        이미지·영상·효과음 생성이 필요하면 모든 보완 작업과 견적을 보고한 후
        따로 승인받습니다. 대사를 보존하므로 목표 길이는 정확히 맞지 않을 수
        있습니다.
      </div>
      {error && <p role="alert">{error}</p>}
      <button
        className="primary full"
        disabled={
          busy ||
          !project.clips.length ||
          (engine === "codex" && !status?.codex)
        }
      >
        {busy ? (
          <LoaderCircle size={17} className="spin" />
        ) : (
          <Film size={17} />
        )}{" "}
        {busy
          ? "1차 편집 중…"
          : engine === "codex"
            ? "Codex에 편집 및 렌더링 맡기기"
            : "크레딧 없이 1차 편집하기"}
      </button>
    </form>
  );
}
