import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  AudioLines,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  ChevronsLeft,
  ChevronsRight,
  CircleHelp,
  Clapperboard,
  Cloud,
  Copy,
  Download,
  Expand,
  Eye,
  FileVideo,
  Film,
  FolderOpen,
  GripVertical,
  Headphones,
  Image,
  Layers,
  Link,
  LoaderCircle,
  LockKeyhole,
  Magnet,
  MessageSquare,
  Mic,
  MoreHorizontal,
  MousePointer2,
  Music2,
  Pause,
  Play,
  Plug,
  Plus,
  Redo2,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  SplitSquareHorizontal,
  Scissors,
  Trash2,
  Type,
  Undo2,
  Upload,
  Volume2,
  VolumeX,
  WandSparkles,
  X,
  Zap,
} from "lucide-react";
import { BatchReview } from "./BatchReview";
import { AutoEditor } from "./AutoEditor";
import { AccountApps } from "./AccountApps";
import {
  api,
  clock,
  timecode,
  total,
  length,
  makeClip,
  uid,
  type Asset,
  type Clip,
  type Project,
  type Status,
  type Job,
  type Plugin,
} from "./types";

const empty: Project = {
  name: "어디든, 나답게",
  ratio: "16:9",
  clips: [],
  audio: [],
  titles: [],
  normalize: false,
};
const NAV = [
  { id: "media", icon: FolderOpen, label: "미디어" },
  { id: "text", icon: Type, label: "텍스트" },
  { id: "audio", icon: AudioLines, label: "오디오" },
  { id: "bridge", icon: WandSparkles, label: "AI 연결" },
  { id: "plugins", icon: Plug, label: "플러그인" },
];
const CAP_NAMES: Record<string, string> = {
  "video-generation": "영상 생성",
  "image-generation": "이미지 생성",
  "sound-effects": "효과음 생성",
  "audio-separation": "음원 분리",
  tts: "음성 생성",
};
type Modal =
  | "export"
  | "tts"
  | "bridge"
  | "plugins"
  | "separate"
  | "sfx"
  | "help"
  | "analysis"
  | "approval"
  | "generated"
  | "codex"
  | "auto"
  | "batch"
  | null;

function IconButton({
  children,
  label,
  onClick,
  disabled = false,
  active = false,
  className = "",
}: {
  children: React.ReactNode;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`icon-button ${active ? "active" : ""} ${className}`}
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
function Waveform({ seed = 1 }: { seed?: number }) {
  return (
    <span className="waveform" aria-hidden="true">
      {Array.from({ length: 110 }, (_, i) => (
        <i
          key={i}
          style={{
            height: `${15 + Math.abs(Math.sin(i * seed * 0.71) * Math.cos(i * 0.19)) * 75}%`,
          }}
        />
      ))}
    </span>
  );
}
function Badge({
  children,
  color = "mint",
}: {
  children: React.ReactNode;
  color?: string;
}) {
  return <span className={`badge ${color}`}>{children}</span>;
}

export default function App() {
  const [project, setProject] = useState<Project>(empty),
    [assets, setAssets] = useState<Asset[]>([]),
    [status, setStatus] = useState<Status | null>(null);
  const [loaded, setLoaded] = useState(false),
    [nav, setNav] = useState("media"),
    [filter, setFilter] = useState("all"),
    [search, setSearch] = useState("");
  const [selected, setSelected] = useState(""),
    [time, setTime] = useState(0),
    [playing, setPlaying] = useState(false),
    [tab, setTab] = useState("ai");
  const [modal, setModal] = useState<Modal>(null),
    [toast, setToast] = useState(""),
    [busy, setBusy] = useState(false),
    [job, setJob] = useState<Job | null>(null);
  const [analysis, setAnalysis] = useState<any>(null),
    [proposal, setProposal] = useState<any>(null),
    [generated, setGenerated] = useState<any>(null);
  const [history, setHistory] = useState<Project[]>([]),
    [future, setFuture] = useState<Project[]>([]),
    [zoom, setZoom] = useState(1),
    [advanced, setAdvanced] = useState(false);
  const [autoResult, setAutoResult] = useState<any>(null);
  const [prompt, setPrompt] = useState(""),
    [codexPlan, setCodexPlan] = useState<any>(null),
    [saveError, setSaveError] = useState(false);
  const [serverSave, setServerSave] = useState("불러오는 중");
  const [uploadProgress, setUploadProgress] = useState("");
  const serverRevision = useRef<string | null>(null);
  const saveChain = useRef(Promise.resolve());
  const saveConflict = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null),
    projectInputRef = useRef<HTMLInputElement>(null),
    videoRef = useRef<HTMLVideoElement>(null),
    stageRef = useRef<HTMLDivElement>(null),
    timelineRef = useRef<HTMLDivElement>(null),
    audioRefs = useRef<Record<string, HTMLAudioElement | null>>({});
  const projectRef = useRef(project),
    timeRef = useRef(time),
    playingRef = useRef(playing),
    dragged = useRef<string | null>(null);
  projectRef.current = project;
  timeRef.current = time;
  playingRef.current = playing;
  const notify = useCallback((text: string) => setToast(text), []);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(""), 4800);
    return () => clearTimeout(id);
  }, [toast]);
  const refreshStatus = useCallback(async () => {
    setStatus(await api("/status"));
  }, []);
  useEffect(() => {
    let mounted = true;
    Promise.all([
      api<Asset[]>("/assets"),
      api<Status>("/status"),
      api<{ project: Project | null; revision: string | null }>("/project"),
    ])
      .then(([a, s, stored]) => {
        if (!mounted) return;
        setAssets(a);
        setStatus(s);
        let saved: Project | null = stored.project;
        serverRevision.current = stored.revision;
        try {
          const raw = localStorage.getItem("moa-project");
          if (raw && !saved) {
            const p = JSON.parse(raw);
            if (
              Array.isArray(p.clips) &&
              p.clips.every((c: Clip) => a.some((x) => x.id === c.assetId))
            )
              saved = p;
          }
        } catch {}
        const p = saved || {
          ...empty,
          clips: a
            .filter((a) => a.type === "video" && a.demo && !a.deleted)
            .map(makeClip),
          audio: a.some((a) => a.id === "demo-music" && !a.deleted)
            ? [
                {
                  id: "demo-audio",
                  assetId: "demo-music",
                  start: 0,
                  volume: 0.55,
                  duration: 22,
                },
              ]
            : [],
          titles: [
            {
              id: "demo-title",
              text: "조금 더 멀리, 나답게.",
              start: 0,
              end: 6,
            },
          ],
        };
        setProject(p);
        setSelected(p.clips[0]?.id || "");
        setLoaded(true);
      })
      .catch((e) => {
        notify(e.message);
        setServerSave("연결 실패 · 새로고침 필요");
      });
    return () => {
      mounted = false;
    };
  }, [notify]);
  useEffect(() => {
    if (loaded)
      try {
        localStorage.setItem("moa-project", JSON.stringify(project));
        setSaveError(false);
      } catch {
        setSaveError(true);
      }
  }, [project, loaded]);
  useEffect(() => {
    if (!loaded || saveConflict.current) return;
    setServerSave("저장 중…");
    let current = true;
    const timer = setTimeout(() => {
      saveChain.current = saveChain.current
        .catch(() => {})
        .then(async () => {
          if (saveConflict.current) return;
          try {
            const response = await fetch("/api/project", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                project,
                baseRevision: serverRevision.current,
              }),
            });
            const data = await response.json();
            if (!response.ok) {
              if (response.status === 409) {
                saveConflict.current = true;
                notify(data.error);
              }
              throw new Error(data.error);
            }
            serverRevision.current = data.revision;
            if (current) setServerSave("작업실에 저장됨");
          } catch {
            if (current || saveConflict.current)
              setServerSave(
                saveConflict.current
                  ? "저장 충돌 · 파일로 보관하세요"
                  : "서버 저장 실패 · 기기 사본 유지",
              );
          }
        });
    }, 500);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [project, loaded, notify]);
  const change = useCallback((edit: (p: Project) => Project) => {
    const previous = projectRef.current;
    const next = edit(previous);
    projectRef.current = next;
    setHistory((h) => [...h.slice(-39), previous]);
    setFuture([]);
    setProject(next);
  }, []);
  const undo = useCallback(() => {
    if (!history.length) return;
    setFuture((f) => [project, ...f]);
    setProject(history[history.length - 1]);
    setHistory((h) => h.slice(0, -1));
  }, [history, project]);
  async function deleteMedia(items: Asset[], samples = false) {
    if (!items.length || busy) return;
    const ids = new Set(items.map((a) => a.id));
    const used =
      projectRef.current.clips.filter((c) => ids.has(c.assetId)).length +
      projectRef.current.audio.filter((c) => ids.has(c.assetId)).length;
    if (
      !window.confirm(
        `${samples ? "샘플 영상과 오디오 모두" : items[0].name}를 삭제할까요?${used ? `\n타임라인에서 사용 중인 ${used}개 항목도 제거됩니다.` : ""}\n보관함에서 삭제되며, 편집 실행 취소를 위해 원본은 작업실에 보관합니다.`,
      )
    )
      return;
    setBusy(true);
    try {
      const result = await api<{ assets: Asset[]; deletedIds: string[] }>(
        samples
          ? "/assets/samples"
          : "/assets/" + encodeURIComponent(items[0].id),
        undefined,
        "DELETE",
      );
      setAssets(result.assets);
      setPlaying(false);
      change((p) => ({
        ...p,
        clips: p.clips.filter((c) => !ids.has(c.assetId)),
        audio: p.audio.filter((c) => !ids.has(c.assetId)),
      }));
      if (projectRef.current.clips.every((c) => c.id !== selected))
        setSelected("");
      setTime((t) => Math.min(t, total(projectRef.current)));
      notify(
        samples
          ? "샘플 영상과 오디오를 삭제했습니다."
          : "보관함에서 삭제했습니다.",
      );
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const redo = useCallback(() => {
    if (!future.length) return;
    setHistory((h) => [...h, project]);
    setProject(future[0]);
    setFuture((f) => f.slice(1));
  }, [future, project]);
  const seconds = total(project);
  let start = 0;
  const segments = project.clips.map((c) => {
    const s = { ...c, start, end: start + length(c) };
    start = s.end;
    return s;
  });
  const active =
      segments.find((c) => time >= c.start && time < c.end) || segments.at(-1),
    current = project.clips.find((c) => c.id === selected),
    activeAsset = assets.find((a) => a.id === active?.assetId),
    selectedAsset = assets.find((a) => a.id === current?.assetId);
  const activeTitle = project.titles.find(
      (t) => time >= t.start && time < t.end,
    ),
    timelineWidth = Math.max(660, seconds * 29 * zoom),
    pps = timelineWidth / Math.max(seconds, 1);
  useEffect(() => {
    if (time > seconds) setTime(seconds);
  }, [seconds, time]);
  useEffect(() => {
    if (!playing) return;
    let previous = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
      const elapsed = (now - previous) / 1000;
      previous = now;
      setTime((t) => {
        if (t + elapsed >= total(projectRef.current)) {
          setPlaying(false);
          return total(projectRef.current);
        }
        return t + elapsed;
      });
    }, 40);
    return () => clearInterval(id);
  }, [playing]);
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !active) return;
    const target = active.in + Math.max(0, time - active.start) * active.speed;
    v.playbackRate = active.speed;
    v.volume = Math.min(1, active.volume);
    if (Number.isFinite(v.duration) && Math.abs(v.currentTime - target) > 0.18)
      v.currentTime = Math.min(target, v.duration);
    if (playing && v.paused) v.play().catch(() => {});
    else if (!playing && !v.paused) v.pause();
  }, [time, active, playing]);
  useEffect(() => {
    for (const a of project.audio) {
      const el = audioRefs.current[a.id];
      if (!el) continue;
      const inRange = time >= a.start && time < a.start + a.duration;
      el.volume = Math.min(1, a.volume);
      if (inRange && Math.abs(el.currentTime - (time - a.start)) > 0.18)
        el.currentTime = time - a.start;
      if (playing && inRange) el.play().catch(() => {});
      else el.pause();
    }
  }, [time, playing, project.audio]);
  const togglePlay = useCallback(() => {
    if (!projectRef.current.clips.length) return;
    if (timeRef.current >= total(projectRef.current)) setTime(0);
    setPlaying((p) => !p);
  }, []);
  const removeClip = useCallback(() => {
    if (!selected) return;
    change((p) => ({ ...p, clips: p.clips.filter((c) => c.id !== selected) }));
    setSelected("");
  }, [selected, change]);
  const split = useCallback(() => {
    let offset = 0;
    const p = projectRef.current,
      c = p.clips.find((c) => {
        const inside =
          timeRef.current > offset + 0.1 &&
          timeRef.current < offset + length(c) - 0.1;
        if (!inside) offset += length(c);
        return inside;
      });
    if (!c) {
      notify("클립 안쪽으로 재생 헤드를 이동해 주세요.");
      return;
    }
    const cut = c.in + (timeRef.current - offset) * c.speed;
    change((p) => ({
      ...p,
      clips: p.clips.flatMap((x) =>
        x.id === c.id
          ? [
              { ...x, out: cut },
              { ...x, id: uid(), in: cut },
            ]
          : [x],
      ),
    }));
    notify("재생 헤드 위치에서 클립을 나눴습니다.");
  }, [change, notify]);
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if (
        (e.target as HTMLElement).closest(
          "input,textarea,select,[contenteditable]",
        ) ||
        modal
      )
        return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "i") {
        e.preventDefault();
        inputRef.current?.click();
      }
      if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        removeClip();
      }
      if (e.key.toLowerCase() === "s" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        split();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "z") {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      }
      if (e.key === "ArrowRight") setTime((t) => Math.min(seconds, t + 1 / 24));
      if (e.key === "ArrowLeft") setTime((t) => Math.max(0, t - 1 / 24));
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [modal, removeClip, split, undo, redo, seconds, togglePlay]);
  useEffect(() => {
    if (!modal) return;
    const previous = document.activeElement as HTMLElement;
    const timer = setTimeout(
      () => document.querySelector<HTMLButtonElement>(".modal button")?.focus(),
      10,
    );
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setModal(null);
        return;
      }
      if (e.key === "Tab") {
        const items = Array.from(
          document.querySelectorAll<HTMLElement>(
            ".modal button:not(:disabled),.modal input,.modal select,.modal textarea,.modal a[href]",
          ),
        ).filter((el) => el.offsetParent !== null);
        const first = items[0],
          last = items.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("keydown", handler);
      previous?.focus();
    };
  }, [modal]);
  async function uploadFiles(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        if (!file.size || file.size > 500 * 1024 * 1024)
          throw new Error("파일은 0MB 초과, 500MB 이하로 선택하세요.");
        const transfer = await api<{ id: string; chunkBytes: number }>(
          "/uploads",
          { name: file.name, size: file.size },
        );
        try {
          for (
            let offset = 0;
            offset < file.size;
            offset += transfer.chunkBytes
          ) {
            setUploadProgress(
              `${file.name} · ${Math.round((offset / file.size) * 100)}%`,
            );
            const response = await fetch(`/api/uploads/${transfer.id}`, {
              method: "PUT",
              headers: {
                "Content-Type": "application/octet-stream",
                "x-upload-offset": String(offset),
              },
              body: file.slice(offset, offset + transfer.chunkBytes),
            });
            if (!response.ok)
              throw new Error(
                "업로드가 중단되었습니다. 연결을 확인하고 다시 시도해 주세요.",
              );
          }
          setUploadProgress(`${file.name} · 편집용 파일 준비 중…`);
          let uploadJob = await api<Job>(
            `/uploads/${transfer.id}/complete`,
            {},
          );
          while (["queued", "running"].includes(uploadJob.status)) {
            await new Promise((resolve) => setTimeout(resolve, 1000));
            uploadJob = await api<Job>(`/jobs/${uploadJob.id}`);
          }
          if (uploadJob.status !== "completed")
            throw new Error(uploadJob.error || "미디어를 가져오지 못했습니다.");
          setAssets((a) => [...a, uploadJob.result.asset]);
        } catch (error) {
          await api(`/uploads/${transfer.id}`, undefined, "DELETE").catch(
            () => {},
          );
          throw error;
        }
      }
      notify("미디어를 가져왔습니다. + 버튼으로 타임라인에 추가하세요.");
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
      setUploadProgress("");
      if (inputRef.current) inputRef.current.value = "";
    }
  }
  function addAsset(a: Asset) {
    if (a.type === "video") {
      const c = makeClip(a);
      change((p) => ({ ...p, clips: [...p.clips, c] }));
      setSelected(c.id);
    } else
      change((p) => ({
        ...p,
        audio: [
          ...p.audio,
          {
            id: uid(),
            assetId: a.id,
            start: time,
            volume: 0.7,
            duration: a.duration,
          },
        ],
      }));
    notify("타임라인에 추가했습니다.");
  }
  function patchClip(update: Partial<Clip>) {
    change((p) => ({
      ...p,
      clips: p.clips.map((c) => (c.id === selected ? { ...c, ...update } : c)),
    }));
  }
  async function watchJob(first: Job, onDone: (result: any) => void) {
    setJob(first);
    let state = first;
    try {
      while (!["completed", "failed"].includes(state.status)) {
        await new Promise((r) => setTimeout(r, 700));
        state = await api<Job>("/jobs/" + first.id);
        setJob(state);
      }
      if (state.status === "failed") throw new Error(state.error);
      onDone(state.result);
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function startRequest(
    path: string,
    body: any,
    onDone: (result: any) => void,
  ) {
    setJob(null);
    setBusy(true);
    try {
      const first = await api<Job>(path, body);
      if (!first.id) {
        onDone(first);
        setBusy(false);
        return;
      }
      await watchJob(first, onDone);
    } catch (e) {
      notify((e as Error).message);
      setBusy(false);
    }
  }
  function importResult(result: any) {
    const list: Asset[] = result.assets || [result.asset].filter(Boolean);
    setAssets((a) => [...a, ...list]);
    setGenerated({ ...result, assets: list });
    setModal("generated");
  }
  function analyze(type: "silence" | "scenes") {
    if (!current) return notify("분석할 영상 클립을 선택해 주세요.");
    setPlaying(false);
    void startRequest(
      "/analyze",
      { assetId: current.assetId, type },
      (result) => {
        setAnalysis({ ...result, clipId: current.id });
        setModal("analysis");
      },
    );
  }
  function applyAnalysis() {
    if (!analysis) return;
    change((p) => ({
      ...p,
      clips: p.clips.flatMap((c) => {
        if (c.id !== analysis.clipId) return [c];
        let ranges: number[][] = [];
        if (analysis.type === "silence")
          ranges = analysis.ranges
            .map(([a, b]: number[]) => [Math.max(a, c.in), Math.min(b, c.out)])
            .filter(([a, b]: number[]) => b - a >= 0.15);
        else {
          const points = [
            c.in,
            ...analysis.cuts.filter(
              (t: number) => t > c.in + 0.1 && t < c.out - 0.1,
            ),
            c.out,
          ];
          ranges = points
            .slice(0, -1)
            .map((a: number, i: number) => [a, points[i + 1]]);
        }
        return ranges.map(([a, b]) => ({ ...c, id: uid(), in: a, out: b }));
      }),
    }));
    setModal(null);
    notify("분석 결과를 적용했습니다. 실행 취소로 되돌릴 수 있습니다.");
  }
  function downloadProject() {
    const blob = new Blob([JSON.stringify(project, null, 2)], {
        type: "application/json",
      }),
      url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = project.name + ".moa.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  }
  async function openProject(file?: File) {
    if (!file) return;
    try {
      const p = JSON.parse(await file.text());
      if (
        !p.name ||
        !Array.isArray(p.clips) ||
        !Array.isArray(p.audio) ||
        !Array.isArray(p.titles) ||
        !p.clips.every(
          (c: Clip) =>
            assets.some((a) => a.id === c.assetId) &&
            c.out > c.in &&
            c.speed > 0,
        )
      )
        throw new Error(
          "이 브라우저에 원본 미디어가 있거나 올바른 프로젝트 파일이어야 합니다.",
        );
      change(() => p);
      setTime(0);
      setSelected(p.clips[0]?.id || "");
      notify("프로젝트를 열었습니다.");
    } catch (e) {
      notify((e as Error).message);
    }
  }
  function reorder(targetId: string) {
    const source = dragged.current;
    if (!source || source === targetId) return;
    change((p) => {
      const clips = [...p.clips],
        from = clips.findIndex((c) => c.id === source),
        to = clips.findIndex((c) => c.id === targetId);
      if (from < 0 || to < 0) return p;
      const [clip] = clips.splice(from, 1);
      clips.splice(to, 0, clip);
      return { ...p, clips };
    });
    dragged.current = null;
  }
  const connected = status?.plugins.filter((p) => p.connected) || [];
  const setActiveNav = (id: string) => {
    setNav(id);
    if (id === "plugins") setModal("plugins");
  };
  const modalTitles: Record<string, string> = {
    auto: "AI에게 편집 맡기기",
    batch: "전체 생성 작업 검토",
    export: "이야기를 세상으로",
    tts: "글을 목소리로",
    bridge: "장면과 장면을 자연스럽게",
    plugins: "나의 플러그인",
    separate: "소리를 레이어로 분리하기",
    sfx: "장면에 어울리는 소리",
    help: "첫 편집, 가볍게 시작해요",
    analysis: "자동 편집 제안",
    approval: "생성 전에 확인해 주세요",
    generated: "새로운 소재가 준비됐어요",
    codex: "Codex 편집 제안",
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <a
          className="brand"
          href="#"
          onClick={(e) => e.preventDefault()}
          aria-label="Moa Studio"
        >
          <span className="brand-mark">
            <span />
            <span />
            <span />
            <span />
          </span>
          <strong>
            moa<span>studio</span>
          </strong>
          <span className="beta">BETA</span>
        </a>
        <div className="breadcrumbs">
          <span>내 작업 공간</span>
          <ChevronRight size={13} />
          <input
            aria-label="프로젝트 이름"
            value={project.name}
            onChange={(e) => change((p) => ({ ...p, name: e.target.value }))}
          />
          <ChevronDown size={13} />
        </div>
        <div className="top-actions">
          <span className={`saved ${saveError ? "warning" : ""}`}>
            <Cloud size={15} />
            {saveError ? "기기 저장 공간 부족" : serverSave}
          </span>
          <button
            className="mode-switch"
            onClick={() => setAdvanced((a) => !a)}
          >
            <span className={!advanced ? "chosen" : ""}>이지</span>
            <span className={advanced ? "chosen" : ""}>프로</span>
          </button>
          <button
            className="export-button"
            onClick={() => {
              setJob(null);
              setModal("export");
            }}
          >
            <ArrowUp size={15} />
            내보내기
          </button>
          <button
            className="avatar"
            aria-label="계정별 연결 관리"
            onClick={() => setModal("plugins")}
          >
            M
          </button>
        </div>
      </header>
      <aside className="rail">
        <div className="rail-main">
          {NAV.map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              className={`rail-item ${nav === id ? "selected" : ""}`}
              onClick={() => setActiveNav(id)}
            >
              <Icon size={21} strokeWidth={1.7} />
              <span>{label}</span>
              {id === "plugins" && connected.length > 0 && <i />}
            </button>
          ))}
        </div>
        <div className="rail-bottom">
          <IconButton
            label="프로젝트 파일 열기"
            onClick={() => projectInputRef.current?.click()}
          >
            <FolderOpen size={20} />
          </IconButton>
          <IconButton
            label="시작 가이드 및 단축키"
            onClick={() => setModal("help")}
          >
            <CircleHelp size={20} />
          </IconButton>
        </div>
      </aside>
      <main className="workbench">
        <section className="upper-workspace">
          <aside className="library">
            <div className="panel-heading">
              <h2>{NAV.find((n) => n.id === nav)?.label}</h2>
              <span className="count">
                {nav === "media" ? assets.filter((a) => !a.deleted).length : ""}
              </span>
              <IconButton label="프로젝트 저장" onClick={downloadProject}>
                <Download size={16} />
              </IconButton>
            </div>
            {nav === "media" && (
              <>
                <button
                  className="import-button"
                  onClick={() => inputRef.current?.click()}
                  disabled={busy}
                >
                  <Plus size={17} />
                  미디어 가져오기<span>⌘ I</span>
                </button>
                <div className="library-search">
                  <Search size={14} />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="미디어 검색"
                    aria-label="미디어 검색"
                  />
                  <span>⌕</span>
                </div>
                <div className="filter-tabs">
                  {[
                    ["all", "전체"],
                    ["video", "영상"],
                    ["audio", "오디오"],
                  ].map(([id, label]) => (
                    <button
                      key={id}
                      className={filter === id ? "selected" : ""}
                      onClick={() => setFilter(id)}
                    >
                      {label}
                    </button>
                  ))}
                  <span />
                  <IconButton
                    label="미디어 다시 불러오기"
                    onClick={() =>
                      api<Asset[]>("/assets")
                        .then(setAssets)
                        .catch((e) => notify(e.message))
                    }
                  >
                    <SlidersHorizontal size={14} />
                  </IconButton>
                </div>
                {assets.some((a) => a.demo && !a.deleted) && (
                  <button
                    className="clear-samples text-button"
                    disabled={busy}
                    onClick={() =>
                      void deleteMedia(
                        assets.filter((a) => a.demo && !a.deleted),
                        true,
                      )
                    }
                  >
                    <Trash2 size={12} /> 샘플 모두 삭제
                  </button>
                )}
                <div
                  className="asset-grid"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (e.dataTransfer.files.length)
                      void uploadFiles(e.dataTransfer.files);
                  }}
                >
                  {assets
                    .filter(
                      (a) =>
                        !a.deleted &&
                        (filter === "all" || a.type === filter) &&
                        a.name.toLowerCase().includes(search.toLowerCase()),
                    )
                    .map((a) => (
                      <article
                        key={a.id}
                        className={`asset-card ${selectedAsset?.id === a.id ? "selected" : ""}`}
                      >
                        <div
                          className={`asset-preview ${a.type}`}
                          onDoubleClick={() => addAsset(a)}
                        >
                          {a.type === "video" ? (
                            <img src={a.thumbnail} alt={a.name} />
                          ) : (
                            <>
                              <Music2 size={24} />
                              <Waveform seed={2} />
                            </>
                          )}
                          <span className="asset-kind">
                            {a.type === "video" ? (
                              <Film size={11} />
                            ) : (
                              <Music2 size={11} />
                            )}
                          </span>
                          <span className="asset-duration">
                            {clock(a.duration)}
                          </span>
                          <button
                            aria-label={`${a.name} 삭제`}
                            title="보관함에서 삭제"
                            className="asset-delete"
                            disabled={busy}
                            onClick={(e) => {
                              e.stopPropagation();
                              void deleteMedia([a]);
                            }}
                            onDoubleClick={(e) => e.stopPropagation()}
                          >
                            <Trash2 size={14} />
                          </button>
                          <button
                            aria-label={`${a.name} 타임라인에 추가`}
                            className="asset-add"
                            onClick={() => addAsset(a)}
                          >
                            <Plus size={14} />
                          </button>
                        </div>
                        <h3 title={a.name}>{a.name}</h3>
                        <p>
                          {a.demo
                            ? "샘플 소재"
                            : a.type === "video"
                              ? "영상 소스"
                              : "오디오 소스"}{" "}
                          <span>{a.type === "video" ? "MP4" : "AAC"}</span>
                        </p>
                      </article>
                    ))}
                </div>
                <div className="drop-hint">
                  <Upload size={17} />
                  <span>
                    {uploadProgress || "파일을 여기에 놓아도 좋아요"}
                    <small>영상 · 이미지 · 오디오 / 최대 500MB</small>
                  </span>
                </div>
                <div className="library-note">
                  <span className="tiny-dot" />
                  직접 만든 일러스트 샘플 프로젝트
                </div>
              </>
            )}
            {nav === "text" && (
              <div className="library-content">
                <p className="muted">이야기에 한 줄을 더해보세요.</p>
                <button
                  className="text-preset"
                  onClick={() =>
                    change((p) => ({
                      ...p,
                      titles: [
                        ...p.titles,
                        {
                          id: uid(),
                          text: "새로운 이야기가 시작됩니다",
                          start: time,
                          end: Math.min(time + 5, seconds) || 5,
                        },
                      ],
                    }))
                  }
                >
                  <span>Aa</span>텍스트 추가
                  <Plus size={17} />
                </button>
                {project.titles.map((t) => (
                  <div className="title-editor" key={t.id}>
                    <label>텍스트 / 자막</label>
                    <textarea
                      value={t.text}
                      onChange={(e) =>
                        change((p) => ({
                          ...p,
                          titles: p.titles.map((x) =>
                            x.id === t.id ? { ...x, text: e.target.value } : x,
                          ),
                        }))
                      }
                    />
                    <div className="two-inputs">
                      <label>
                        시작 (초)
                        <input
                          type="number"
                          min="0"
                          step="0.1"
                          value={t.start}
                          onChange={(e) =>
                            change((p) => ({
                              ...p,
                              titles: p.titles.map((x) =>
                                x.id === t.id
                                  ? {
                                      ...x,
                                      start: Math.max(0, +e.target.value),
                                    }
                                  : x,
                              ),
                            }))
                          }
                        />
                      </label>
                      <label>
                        끝 (초)
                        <input
                          type="number"
                          min={t.start + 0.1}
                          step="0.1"
                          value={t.end}
                          onChange={(e) =>
                            change((p) => ({
                              ...p,
                              titles: p.titles.map((x) =>
                                x.id === t.id
                                  ? {
                                      ...x,
                                      end: Math.max(
                                        t.start + 0.1,
                                        +e.target.value,
                                      ),
                                    }
                                  : x,
                              ),
                            }))
                          }
                        />
                      </label>
                    </div>
                    <button
                      className="text-button danger"
                      onClick={() =>
                        change((p) => ({
                          ...p,
                          titles: p.titles.filter((x) => x.id !== t.id),
                        }))
                      }
                    >
                      <Trash2 size={13} />
                      삭제
                    </button>
                  </div>
                ))}
                <div className="info-box">
                  텍스트 위치와 시간은 미리보기와 내보내기에 함께 적용됩니다.
                  자동 음성 인식 자막은 후속 연동 항목입니다.
                </div>
              </div>
            )}
            {nav === "audio" && (
              <div className="library-content">
                <p className="muted">잘 들리는 영상이 좋은 영상이에요.</p>
                <button className="tool-tile" onClick={() => setModal("tts")}>
                  <span className="tile-icon lavender">
                    <Mic size={20} />
                  </span>
                  <span>
                    <strong>AI 내레이션</strong>
                    <small>Microsoft TTS 기본 제공</small>
                  </span>
                  <ChevronRight size={16} />
                </button>
                <button
                  className="tool-tile"
                  onClick={() => setModal("separate")}
                >
                  <span className="tile-icon blue">
                    <AudioLines size={20} />
                  </span>
                  <span>
                    <strong>사운드 분리</strong>
                    <small>보이스 · 효과음 · BGM</small>
                  </span>
                  <ChevronRight size={16} />
                </button>
                <button className="tool-tile" onClick={() => setModal("sfx")}>
                  <span className="tile-icon peach">
                    <Music2 size={20} />
                  </span>
                  <span>
                    <strong>효과음 만들기</strong>
                    <small>연결된 플러그인으로 생성</small>
                  </span>
                  <ChevronRight size={16} />
                </button>
                <div className="section-label">
                  타임라인 오디오 <span>{project.audio.length}</span>
                </div>
                {project.audio.map((a) => (
                  <div className="audio-control" key={a.id}>
                    <div>
                      <Music2 size={14} />
                      <strong>
                        {assets.find((x) => x.id === a.assetId)?.name}
                      </strong>
                      <IconButton
                        label="오디오 삭제"
                        onClick={() =>
                          change((p) => ({
                            ...p,
                            audio: p.audio.filter((x) => x.id !== a.id),
                          }))
                        }
                      >
                        <X size={14} />
                      </IconButton>
                    </div>
                    <label>
                      볼륨 <span>{Math.round(a.volume * 100)}%</span>
                    </label>
                    <input
                      aria-label="오디오 볼륨"
                      type="range"
                      min="0"
                      max="1"
                      step=".01"
                      value={a.volume}
                      onChange={(e) =>
                        change((p) => ({
                          ...p,
                          audio: p.audio.map((x) =>
                            x.id === a.id
                              ? { ...x, volume: +e.target.value }
                              : x,
                          ),
                        }))
                      }
                    />
                    <label>
                      시작 위치 (초)
                      <input
                        type="number"
                        min="0"
                        step=".1"
                        value={a.start}
                        onChange={(e) =>
                          change((p) => ({
                            ...p,
                            audio: p.audio.map((x) =>
                              x.id === a.id
                                ? { ...x, start: Math.max(0, +e.target.value) }
                                : x,
                            ),
                          }))
                        }
                      />
                    </label>
                  </div>
                ))}
              </div>
            )}
            {nav === "bridge" && (
              <div className="library-content">
                <div className="bridge-art">
                  <div />
                  <Link size={26} />
                  <div />
                </div>
                <h3 className="feature-title">
                  컷 사이에도 이야기는
                  <br />
                  계속되니까.
                </h3>
                <p className="muted leading">
                  앞 장면의 마지막 프레임과 다음 장면의 시작을 AI로 이어보세요.
                </p>
                <div className="mini-feature">
                  <span>01</span>
                  <p>연결할 두 클립 선택</p>
                </div>
                <div className="mini-feature">
                  <span>02</span>
                  <p>F2F 또는 참조 기반 생성</p>
                </div>
                <div className="mini-feature">
                  <span>03</span>
                  <p>비용 확인 · 승인 후 생성</p>
                </div>
                <button
                  className="primary full"
                  onClick={() => setModal("bridge")}
                >
                  <Sparkles size={16} />
                  연결 장면 만들기
                </button>
                <div className="info-box">
                  <ShieldCheck size={18} />
                  소재 전송과 생성은 동의 후에만 시작합니다.
                </div>
              </div>
            )}
            {nav === "plugins" && (
              <div className="library-content">
                <p className="muted leading">
                  내 계정에 연결된 도구를 한곳에서.
                  <br />
                  연결 상태에 맞춰 옵션이 표시됩니다.
                </p>
                <button
                  className="primary full"
                  onClick={() => setModal("plugins")}
                >
                  <Plug size={16} />
                  연결 관리
                </button>
                <div className="connection-summary">
                  <span className="status-dot" />
                  Microsoft TTS
                  <Badge color={status?.tts ? "mint" : "gray"}>
                    {status?.tts ? "설치됨" : "설정 필요"}
                  </Badge>
                </div>
                <div className="connection-summary">
                  <span
                    className={`status-dot ${status?.codex ? "" : "off"}`}
                  />
                  Codex
                  <Badge color={status?.codex ? "mint" : "gray"}>
                    {status?.codex ? "연결됨" : "연결 필요"}
                  </Badge>
                </div>
                {connected.map((p) => (
                  <div className="connection-summary" key={p.id}>
                    <Plug size={13} />
                    {p.name}
                    <Badge>연결됨</Badge>
                  </div>
                ))}
              </div>
            )}
          </aside>

          <section className="viewer-panel">
            <div className="viewer-toolbar">
              <div>
                <span className="viewer-dot" />
                미리보기 <span className="subtle">/</span>{" "}
                <span className="subtle">{project.name}</span>
              </div>
              <div>
                <select
                  aria-label="영상 화면 비율"
                  value={project.ratio}
                  onChange={(e) =>
                    change((p) => ({
                      ...p,
                      ratio: e.target.value as Project["ratio"],
                    }))
                  }
                >
                  <option>16:9</option>
                  <option>9:16</option>
                  <option>1:1</option>
                </select>
                <span className="preview-quality">
                  720p <ChevronDown size={11} />
                </span>
              </div>
            </div>
            <div className="stage-wrap">
              <div
                ref={stageRef}
                className={`stage ratio-${project.ratio.replace(":", "-")}`}
                style={{ aspectRatio: project.ratio.replace(":", "/") }}
              >
                {activeAsset ? (
                  <>
                    <video
                      ref={videoRef}
                      src={activeAsset.url}
                      poster={activeAsset.thumbnail}
                      playsInline
                      preload="auto"
                      onLoadedMetadata={() => {
                        if (videoRef.current && active)
                          videoRef.current.currentTime =
                            active.in +
                            Math.max(0, timeRef.current - active.start) *
                              active.speed;
                      }}
                      style={{
                        filter: `brightness(${1 + (active?.brightness ?? 0)}) saturate(${active?.saturation ?? 1})`,
                      }}
                    />
                    {activeTitle && (
                      <div className="preview-title">{activeTitle.text}</div>
                    )}
                    {activeAsset.demo && (
                      <>
                        <div className="preview-top-label">
                          <span />
                          MOA ORIGINAL
                        </div>
                        <div className="preview-bottom-label">
                          A LITTLE FURTHER. A LITTLE MORE YOU.
                        </div>
                      </>
                    )}
                  </>
                ) : (
                  <button
                    className="empty-stage"
                    onClick={() => inputRef.current?.click()}
                  >
                    <Clapperboard size={40} />
                    <h3>당신의 첫 장면을 기다리고 있어요</h3>
                    <span>미디어를 가져오고 타임라인에 추가하세요</span>
                    <span className="primary">미디어 가져오기</span>
                  </button>
                )}
              </div>
            </div>
            <div className="playback-bar">
              <div className="time-display">
                {timecode(time)} <span>/ {timecode(seconds)}</span>
              </div>
              <div className="transport">
                <IconButton label="처음으로 이동" onClick={() => setTime(0)}>
                  <ChevronsLeft size={18} />
                </IconButton>
                <IconButton
                  label="이전 클립"
                  onClick={() =>
                    setTime(
                      [...segments].reverse().find((c) => c.start < time - 0.1)
                        ?.start || 0,
                    )
                  }
                >
                  <ChevronLeft size={19} />
                </IconButton>
                <button
                  className="play-button"
                  onClick={togglePlay}
                  aria-label={playing ? "일시 정지" : "재생"}
                  disabled={!project.clips.length}
                >
                  {playing ? (
                    <Pause size={18} fill="currentColor" />
                  ) : (
                    <Play size={18} fill="currentColor" />
                  )}
                </button>
                <IconButton
                  label="다음 클립"
                  onClick={() =>
                    setTime(
                      segments.find((c) => c.start > time + 0.1)?.start ||
                        seconds,
                    )
                  }
                >
                  <ChevronRight size={19} />
                </IconButton>
                <IconButton
                  label="끝으로 이동"
                  onClick={() => {
                    setPlaying(false);
                    setTime(seconds);
                  }}
                >
                  <ChevronsRight size={18} />
                </IconButton>
              </div>
              <div className="viewer-controls">
                <span>맞춤</span>
                <IconButton
                  label="미리보기 전체 화면"
                  onClick={() =>
                    stageRef.current
                      ?.requestFullscreen()
                      .catch(() =>
                        notify(
                          "이 브라우저에서는 전체 화면을 지원하지 않습니다.",
                        ),
                      )
                  }
                >
                  <Expand size={16} />
                </IconButton>
              </div>
            </div>
          </section>
        </section>

        <section className="timeline-panel">
          <div className="timeline-toolbar">
            <div className="tool-group">
              <IconButton
                label="실행 취소 (⌘ Z)"
                onClick={undo}
                disabled={!history.length}
              >
                <Undo2 size={17} />
              </IconButton>
              <IconButton
                label="다시 실행 (⌘ ⇧ Z)"
                onClick={redo}
                disabled={!future.length}
              >
                <Redo2 size={17} />
              </IconButton>
              <span className="divider" />
              <IconButton
                label="클립 선택"
                active={true}
                onClick={() => setTab("properties")}
              >
                <MousePointer2 size={17} />
              </IconButton>
              <IconButton label="클립 나누기 (S)" onClick={split}>
                <Scissors size={17} />
              </IconButton>
              <IconButton
                label="선택한 클립 복제"
                disabled={!current}
                onClick={() => {
                  if (current)
                    change((p) => ({
                      ...p,
                      clips: p.clips.flatMap((c) =>
                        c.id === current.id ? [c, { ...c, id: uid() }] : [c],
                      ),
                    }));
                }}
              >
                <Copy size={16} />
              </IconButton>
              <IconButton
                label="선택한 클립 삭제 (Delete)"
                onClick={removeClip}
                disabled={!current}
              >
                <Trash2 size={16} />
              </IconButton>
              <span className="divider" />
              <button
                className="timeline-ai"
                onClick={() => {
                  setAutoResult(null);
                  setModal("auto");
                }}
                disabled={busy}
              >
                <Sparkles size={15} />
                자동 편집
              </button>
            </div>
            <div className="timeline-zoom">
              <span>
                {project.clips.length}개 클립 <span className="subtle">·</span>{" "}
                {clock(seconds)}
              </span>
              <span className="divider" />
              <button
                aria-label="타임라인 축소"
                onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}
              >
                −
              </button>
              <input
                aria-label="타임라인 확대"
                type="range"
                min=".5"
                max="3"
                step=".25"
                value={zoom}
                onChange={(e) => setZoom(+e.target.value)}
              />
              <button
                aria-label="타임라인 확대"
                onClick={() => setZoom((z) => Math.min(3, z + 0.25))}
              >
                +
              </button>
            </div>
          </div>
          <div className="timeline-body">
            <div className="track-labels">
              <div className="ruler-label">
                트랙 <span>24 fps</span>
              </div>
              <div className="track-label video-label">
                <span className="track-icon">
                  <Film size={15} />
                </span>
                <div>
                  영상<small>V1</small>
                </div>
                <IconButton
                  label="영상 속성 보기"
                  onClick={() => setTab("properties")}
                >
                  <Settings2 size={13} />
                </IconButton>
              </div>
              <div className="track-label text-label">
                <span className="track-icon">
                  <Type size={15} />
                </span>
                <div>
                  텍스트<small>T1</small>
                </div>
                <IconButton label="텍스트 편집" onClick={() => setNav("text")}>
                  <Settings2 size={13} />
                </IconButton>
              </div>
              <div className="track-label audio-label">
                <span className="track-icon">
                  <Music2 size={15} />
                </span>
                <div>
                  오디오<small>A1</small>
                </div>
                <IconButton label="오디오 편집" onClick={() => setNav("audio")}>
                  <Settings2 size={13} />
                </IconButton>
              </div>
            </div>
            <div className="timeline-scroll" ref={timelineRef}>
              <div
                className="timeline-content"
                style={{ width: timelineWidth }}
              >
                <div
                  className="ruler"
                  onClick={(e) => {
                    setPlaying(false);
                    setTime(
                      Math.min(
                        seconds,
                        Math.max(
                          0,
                          (e.clientX -
                            e.currentTarget.getBoundingClientRect().left) /
                            pps,
                        ),
                      ),
                    );
                  }}
                >
                  {Array.from(
                    { length: Math.floor(seconds / 2) + 1 },
                    (_, i) => (
                      <span key={i} style={{ left: i * 2 * pps }}>
                        {clock(i * 2)}
                        <i />
                      </span>
                    ),
                  )}
                </div>
                <div className="video-track track">
                  {segments.map((c, i) => (
                    <button
                      draggable
                      onDragStart={() => {
                        dragged.current = c.id;
                      }}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        reorder(c.id);
                      }}
                      onDragEnd={() => {
                        dragged.current = null;
                      }}
                      className={`timeline-clip ${selected === c.id ? "selected" : ""}`}
                      key={c.id}
                      style={{
                        left: c.start * pps,
                        width: Math.max(8, length(c) * pps),
                      }}
                      onClick={() => {
                        setSelected(c.id);
                        setTime(c.start);
                        setPlaying(false);
                      }}
                      onDoubleClick={() => setTab("properties")}
                      aria-label={`${c.name} 클립 선택`}
                    >
                      <div
                        className="clip-filmstrip"
                        style={{
                          backgroundImage: `url(${assets.find((a) => a.id === c.assetId)?.thumbnail})`,
                        }}
                      />
                      <div className="clip-label">
                        <Film size={11} />
                        {c.name}
                        <span>{length(c).toFixed(1)}s</span>
                      </div>
                      <span className="trim-handle left" />
                      <span className="trim-handle right" />
                      {i > 0 && (
                        <span className="cut-marker">
                          <Link size={9} />
                        </span>
                      )}
                    </button>
                  ))}
                </div>
                <div className="title-track track">
                  {project.titles.map((t) => (
                    <button
                      key={t.id}
                      style={{
                        left: t.start * pps,
                        width: Math.max(18, (t.end - t.start) * pps),
                      }}
                      className="timeline-title"
                      onClick={() => {
                        setNav("text");
                        setTime(t.start);
                      }}
                    >
                      <Type size={13} />
                      {t.text}
                    </button>
                  ))}
                </div>
                <div className="audio-track track">
                  {project.audio.map((a, i) => (
                    <button
                      key={a.id}
                      className="timeline-audio"
                      style={{
                        left: a.start * pps,
                        width: a.duration * pps,
                        top: (i % 2) * 3,
                      }}
                      onClick={() => setNav("audio")}
                    >
                      <span>
                        <Music2 size={12} />
                        {assets.find((x) => x.id === a.assetId)?.name}
                      </span>
                      <Waveform seed={i + 1} />
                    </button>
                  ))}
                </div>
                <div
                  className="playhead"
                  style={{ left: Math.min(time, seconds) * pps }}
                >
                  <div />
                  <span />
                </div>
              </div>
            </div>
          </div>
          <footer className="timeline-footer">
            <span>
              <span className="status-dot" />
              모든 변경 사항은 자동 저장됩니다
            </span>
            <div>
              <kbd>Space</kbd> 재생 / 정지 <span>·</span>
              <kbd>S</kbd> 자르기 <span>·</span> 드래그하여 순서 변경
            </div>
            <button onClick={() => setModal("help")}>
              단축키 보기 <ArrowUp size={11} />
            </button>
          </footer>
        </section>
      </main>

      <aside className="inspector">
        <div className="inspector-tabs">
          <button
            className={tab === "ai" ? "selected" : ""}
            onClick={() => setTab("ai")}
          >
            <Sparkles size={15} />
            AI 도우미
          </button>
          <button
            className={tab === "properties" ? "selected" : ""}
            onClick={() => setTab("properties")}
          >
            <SlidersHorizontal size={14} />
            속성
          </button>
        </div>
        {tab === "ai" ? (
          <>
            <div className="assistant-scroll">
              <div className="assistant-intro">
                <span className="sparkle-bubble">
                  <Sparkles size={23} />
                </span>
                <Badge>YOUR CREATIVE PARTNER</Badge>
                <h1>
                  이야기에 집중하세요.
                  <br />
                  <span>편집은 함께할게요.</span>
                </h1>
                <p>반복 작업은 줄이고, 좋은 장면은 더 오래.</p>
              </div>
              <button
                className="auto-edit-entry"
                onClick={() => {
                  setAutoResult(null);
                  setModal("auto");
                }}
              >
                <Sparkles size={18} />
                <span>
                  <strong>AI 자동편집</strong>
                  <small>스타일을 고르고, 처음부터 끝까지 맡기기</small>
                </span>
                <ArrowRight size={16} />
              </button>
              <div className="assistant-section-title">
                어디서부터 시작할까요?<span>QUICK TOOLS</span>
              </div>
              <div className="quick-tools">
                <button onClick={() => analyze("silence")} disabled={busy}>
                  <Scissors size={18} />
                  <strong>무음 정리</strong>
                  <small>필요한 말만 남기기</small>
                </button>
                <button onClick={() => analyze("scenes")} disabled={busy}>
                  <SplitSquareHorizontal size={18} />
                  <strong>장면 나누기</strong>
                  <small>전환 지점 자동 감지</small>
                </button>
                <button
                  onClick={() => {
                    change((p) => ({ ...p, normalize: !p.normalize }));
                    notify(
                      project.normalize
                        ? "음량 정규화를 해제했습니다."
                        : "내보내기에 -16 LUFS 음량 정규화를 적용합니다.",
                    );
                  }}
                  className={project.normalize ? "enabled" : ""}
                >
                  <AudioLines size={18} />
                  <strong>
                    음량 맞추기 {project.normalize && <Check size={12} />}
                  </strong>
                  <small>일정하고 편안한 소리</small>
                </button>
                <button onClick={() => setModal("tts")}>
                  <Mic size={18} />
                  <strong>AI 내레이션</strong>
                  <small>글을 자연스러운 음성으로</small>
                </button>
              </div>
              <div className="bridge-suggestion">
                <div className="suggestion-top">
                  <span>
                    <Link size={14} />한 걸음 더, 자연스럽게
                  </span>
                  <span className="new-tag">NEW</span>
                </div>
                <div className="bridge-thumbs">
                  <img
                    src={
                      assets.find((a) => a.id === project.clips[0]?.assetId)
                        ?.thumbnail || "/demo/scene-0.jpg"
                    }
                    alt="첫 장면"
                  />
                  <span>
                    <Sparkles size={18} />
                  </span>
                  <img
                    src={
                      assets.find((a) => a.id === project.clips[1]?.assetId)
                        ?.thumbnail || "/demo/scene-1.jpg"
                    }
                    alt="다음 장면"
                  />
                </div>
                <h3>장면 사이를 AI로 이어보세요</h3>
                <p>
                  앞뒤 프레임이나 참조 이미지로
                  <br />
                  이야기의 흐름을 이어주는 연결 장면.
                </p>
                <button onClick={() => setModal("bridge")}>
                  연결 장면 살펴보기 <ArrowRight size={15} />
                </button>
                <small>
                  <ShieldCheck size={12} />
                  항상 확인하고 승인한 후 생성해요
                </small>
              </div>
              <div className="workflow-tip">
                <span>✦</span>
                <p>
                  <strong>작게 시작해도 괜찮아요</strong>클립을 선택하고{" "}
                  <kbd>S</kbd>를 눌러보세요.
                  <br />첫 번째 컷 편집이 완성됩니다.
                </p>
              </div>
            </div>
            <div className="codex-composer">
              <div className="codex-status">
                <span className="codex-logo">◈</span>
                <strong>Codex</strong>
                <span className={status?.codex ? "connected-text" : ""}>
                  {status?.codex ? "연결됨" : "연결 필요"}
                </span>
                <button
                  aria-label="Codex 연결 설정"
                  onClick={() => setModal("plugins")}
                >
                  <Settings2 size={13} />
                </button>
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!status?.codex) {
                    setModal("plugins");
                    return;
                  }
                  setPlaying(false);
                  void startRequest("/codex", { prompt, project }, (r) => {
                    setCodexPlan(r);
                    setModal("codex");
                  });
                }}
              >
                <textarea
                  aria-label="Codex 편집 요청"
                  placeholder="어떤 영상을 만들고 싶으세요?"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                />
                <div>
                  <span>예: 말 사이의 긴 무음을 정리해줘</span>
                  <button
                    type="submit"
                    aria-label="Codex에 편집 제안 요청"
                    disabled={busy || !prompt.trim()}
                  >
                    <ArrowUp size={16} />
                  </button>
                </div>
              </form>
              <p>AI가 제안하고, 당신이 결정합니다.</p>
            </div>
          </>
        ) : (
          <div className="properties-panel">
            {current ? (
              <>
                <div className="selected-clip-title">
                  <Film size={18} />
                  <div>
                    <h3>{current.name}</h3>
                    <span>
                      {length(current).toFixed(2)}초 ·{" "}
                      {selectedAsset?.demo ? "샘플 영상" : "원본 미디어"}
                    </span>
                  </div>
                </div>
                <div className="property-section">
                  <h3>
                    <Scissors size={14} />컷 범위
                  </h3>
                  <div className="two-inputs">
                    <label>
                      시작 (초)
                      <input
                        aria-label="클립 시작 시간"
                        type="number"
                        min="0"
                        max={current.out - 0.1}
                        step=".1"
                        value={current.in}
                        onChange={(e) =>
                          patchClip({
                            in: Math.min(
                              current.out - 0.1,
                              Math.max(0, +e.target.value),
                            ),
                          })
                        }
                      />
                    </label>
                    <label>
                      끝 (초)
                      <input
                        aria-label="클립 끝 시간"
                        type="number"
                        min={current.in + 0.1}
                        max={selectedAsset?.duration}
                        step=".1"
                        value={current.out}
                        onChange={(e) =>
                          patchClip({
                            out: Math.max(
                              current.in + 0.1,
                              Math.min(
                                selectedAsset?.duration || 999,
                                +e.target.value,
                              ),
                            ),
                          })
                        }
                      />
                    </label>
                  </div>
                  <button className="secondary full" onClick={split}>
                    <Scissors size={14} />
                    현재 위치에서 나누기
                  </button>
                </div>
                <div className="property-section">
                  <h3>
                    <Zap size={14} />
                    재생 속도
                  </h3>
                  <div className="speed-options">
                    {[0.5, 1, 1.5, 2].map((speed) => (
                      <button
                        className={current.speed === speed ? "selected" : ""}
                        key={speed}
                        onClick={() => patchClip({ speed })}
                      >
                        {speed}×
                      </button>
                    ))}
                  </div>
                </div>
                <div className="property-section">
                  <h3>
                    <Volume2 size={14} />
                    원본 소리
                  </h3>
                  <label className="slider-label">
                    볼륨 <span>{Math.round(current.volume * 100)}%</span>
                  </label>
                  <input
                    aria-label="클립 볼륨"
                    type="range"
                    min="0"
                    max="1"
                    step=".01"
                    value={current.volume}
                    onChange={(e) => patchClip({ volume: +e.target.value })}
                  />
                  <button
                    className="text-button"
                    disabled={!selectedAsset?.hasAudio || busy}
                    onClick={() =>
                      void startRequest(
                        "/audio/extract",
                        { assetId: current.assetId },
                        importResult,
                      )
                    }
                  >
                    <AudioLines size={14} />
                    오디오를 별도 소재로 추출
                  </button>
                </div>
                <div className="property-section">
                  <h3>
                    <SlidersHorizontal size={14} />
                    기본 색보정
                  </h3>
                  <label className="slider-label">
                    밝기
                    <span>
                      {current.brightness > 0 ? "+" : ""}
                      {Math.round(current.brightness * 100)}
                    </span>
                  </label>
                  <input
                    aria-label="밝기"
                    type="range"
                    min="-.5"
                    max=".5"
                    step=".01"
                    value={current.brightness}
                    onChange={(e) => patchClip({ brightness: +e.target.value })}
                  />
                  <label className="slider-label">
                    채도<span>{Math.round(current.saturation * 100)}%</span>
                  </label>
                  <input
                    aria-label="채도"
                    type="range"
                    min="0"
                    max="2"
                    step=".01"
                    value={current.saturation}
                    onChange={(e) => patchClip({ saturation: +e.target.value })}
                  />
                  <button
                    className="text-button"
                    onClick={() =>
                      patchClip({
                        brightness: 0,
                        saturation: 1,
                        speed: 1,
                        volume: 1,
                      })
                    }
                  >
                    기본값으로 초기화
                  </button>
                </div>
                {advanced && (
                  <div className="info-box">
                    프로 모드 · {selectedAsset?.duration.toFixed(2)}초 원본
                    <br />
                    인점 {current.in.toFixed(2)} / 아웃점{" "}
                    {current.out.toFixed(2)}
                    <br />
                    720p · 24fps 렌더링
                  </div>
                )}
                <button className="text-button danger" onClick={removeClip}>
                  <Trash2 size={14} />
                  클립 삭제
                </button>
              </>
            ) : (
              <div className="empty-properties">
                <MousePointer2 size={28} />
                <p>
                  타임라인에서 클립을 선택하면
                  <br />
                  편집 도구가 여기에 표시됩니다.
                </p>
              </div>
            )}
          </div>
        )}
      </aside>
      <input
        ref={inputRef}
        type="file"
        accept="video/*,audio/*,image/*"
        multiple
        hidden
        onChange={(e) => void uploadFiles(e.target.files)}
      />
      <input
        ref={projectInputRef}
        type="file"
        accept=".json"
        hidden
        onChange={(e) => void openProject(e.target.files?.[0])}
      />
      {project.audio.map((a) => (
        <audio
          key={a.id}
          ref={(el) => {
            audioRefs.current[a.id] = el;
          }}
          src={assets.find((x) => x.id === a.assetId)?.url}
          preload="auto"
        />
      ))}
      {busy && (
        <div className="job-status" role="status">
          <LoaderCircle size={16} className="spin" />
          <div>
            <strong>
              {job?.type === "export"
                ? "영상을 내보내고 있어요"
                : job?.type === "analyze"
                  ? "장면을 분석하고 있어요"
                  : "작업을 처리하고 있어요"}
            </strong>
            <span>
              {job?.progress ? `${job.progress}% 완료` : "잠시만 기다려 주세요"}
            </span>
          </div>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          <span>{toast}</span>
          <button aria-label="알림 닫기" onClick={() => setToast("")}>
            <X size={14} />
          </button>
        </div>
      )}
      {!loaded && (
        <div className="loading-screen">
          <LoaderCircle className="spin" />
          <span>스튜디오를 준비하고 있어요</span>
        </div>
      )}

      {modal && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setModal(null);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
            className={`modal modal-${modal}`}
          >
            <div className="modal-heading">
              <div>
                <span className="eyebrow">MOA STUDIO</span>
                <h2 id="modal-title">{modalTitles[modal]}</h2>
              </div>
              <IconButton label="닫기" onClick={() => setModal(null)}>
                <X size={20} />
              </IconButton>
            </div>
            {modal === "auto" && (
              <AutoEditor
                project={project}
                status={status}
                busy={busy}
                result={autoResult}
                onRun={(body) => {
                  setPlaying(false);
                  void startRequest("/auto-edit", body, setAutoResult);
                }}
                onApply={() => {
                  change(() => autoResult.project);
                  setTime(0);
                  setSelected(autoResult.project.clips[0]?.id || "");
                  setModal(null);
                  notify(
                    "1차 편집본을 적용했습니다. 실행 취소로 원본을 복원할 수 있습니다.",
                  );
                }}
                onConnect={() => setModal("plugins")}
                onReview={() => setModal("batch")}
              />
            )}
            {modal === "batch" && autoResult && (
              <BatchReview
                report={autoResult.report}
                plugins={connected}
                busy={busy}
                onConnect={() => setModal("plugins")}
                onApprove={(id) =>
                  void startRequest(
                    "/proposal-batches/" + id + "/approve",
                    { approved: true },
                    (r) => {
                      importResult(r);
                      const failed = r.results.filter(
                        (x: any) => x.status !== "completed",
                      );
                      if (failed.length)
                        notify(
                          failed
                            .map(
                              (x: any) =>
                                x.error || "이후 작업은 시작하지 않았습니다.",
                            )
                            .join(" / "),
                        );
                    },
                  )
                }
              />
            )}
            {modal === "help" && (
              <div className="modal-content">
                <div className="help-step">
                  <span>1</span>
                  <div>
                    <h3>소재를 가져오세요</h3>
                    <p>미디어를 업로드한 후 +를 눌러 타임라인에 넣으세요.</p>
                  </div>
                </div>
                <div className="help-step">
                  <span>2</span>
                  <div>
                    <h3>원하는 흐름을 만드세요</h3>
                    <p>
                      클립을 드래그해 순서를 바꾸고, S로 나누세요. 속성에서 컷
                      범위와 색감을 조절합니다.
                    </p>
                  </div>
                </div>
                <div className="help-step">
                  <span>3</span>
                  <div>
                    <h3>AI와 함께 다듬으세요</h3>
                    <p>
                      무음·장면 분석은 로컬에서, 생성은 연결한 플러그인에서 승인
                      후 진행합니다.
                    </p>
                  </div>
                </div>
                <div className="help-step">
                  <span>4</span>
                  <div>
                    <h3>한 편의 영상으로 내보내세요</h3>
                    <p>영상·텍스트·오디오를 합친 MP4를 다운로드합니다.</p>
                  </div>
                </div>
                <div className="shortcut-table">
                  <span>재생 / 정지</span>
                  <kbd>Space</kbd>
                  <span>현재 위치에서 나누기</span>
                  <kbd>S</kbd>
                  <span>선택 클립 삭제</span>
                  <kbd>Delete</kbd>
                  <span>실행 취소 / 다시 실행</span>
                  <kbd>⌘/Ctrl Z / ⇧ Z</kbd>
                </div>
                <button className="primary full" onClick={() => setModal(null)}>
                  편집 시작하기 <ArrowRight size={16} />
                </button>
              </div>
            )}
            {modal === "export" && (
              <div className="modal-content">
                <p className="muted">
                  영상, 텍스트와 오디오를 하나의 파일로 완성합니다.
                </p>
                <div className="export-preview">
                  <img
                    src={activeAsset?.thumbnail || "/demo/scene-0.jpg"}
                    alt="프로젝트 표지"
                  />
                  <div>
                    <h3>{project.name}</h3>
                    <p>
                      {clock(seconds)} · {project.clips.length}개 클립
                    </p>
                    <Badge>MP4 · H.264</Badge>
                  </div>
                </div>
                <div className="export-settings">
                  <div>
                    <span>해상도</span>
                    <strong>
                      {project.ratio === "9:16"
                        ? "720 × 1280"
                        : project.ratio === "1:1"
                          ? "1080 × 1080"
                          : "1280 × 720"}
                    </strong>
                  </div>
                  <div>
                    <span>프레임 레이트</span>
                    <strong>24 fps</strong>
                  </div>
                  <div>
                    <span>음량 정규화</span>
                    <strong>
                      {project.normalize ? "켜짐 · -16 LUFS" : "꺼짐"}
                    </strong>
                  </div>
                </div>
                {job?.type === "export" && job.status === "completed" ? (
                  <a
                    className="primary full"
                    href={job.result.url}
                    download={job.result.name}
                  >
                    <Download size={16} />
                    완성된 영상 다운로드
                  </a>
                ) : (
                  <button
                    className="primary full"
                    disabled={busy || !project.clips.length}
                    onClick={() => {
                      setPlaying(false);
                      void startRequest("/export", project, () =>
                        notify("영상이 완성됐습니다. 다운로드할 수 있어요."),
                      );
                    }}
                  >
                    {busy ? (
                      <LoaderCircle className="spin" size={16} />
                    ) : (
                      <ArrowUp size={16} />
                    )}{" "}
                    {busy
                      ? `렌더링 중 ${job?.progress || 0}%`
                      : "영상 내보내기"}
                  </button>
                )}
                <button
                  className="text-button centered"
                  onClick={downloadProject}
                >
                  <Download size={14} />
                  편집 프로젝트 파일 저장
                </button>
              </div>
            )}
            {modal === "tts" && (
              <TtsForm
                status={status}
                busy={busy}
                onSubmit={(body) =>
                  void startRequest("/tts", body, importResult)
                }
                onPlugin={async (input) => {
                  try {
                    setProposal(await api("/proposals", input));
                    setModal("approval");
                  } catch (e) {
                    notify((e as Error).message);
                  }
                }}
              />
            )}
            {modal === "plugins" && (
              <PluginManager
                status={status}
                assets={assets}
                project={project}
                onImported={async () => {
                  setAssets(await api("/assets"));
                  notify("생성 결과를 미디어 보관함에 추가했습니다.");
                }}
                onChange={refreshStatus}
                notify={notify}
              />
            )}
            {(modal === "bridge" ||
              modal === "sfx" ||
              modal === "separate") && (
              <GenerationForm
                kind={modal}
                project={project}
                assets={assets}
                plugins={connected}
                selected={selected}
                status={status}
                onLocal={(assetId) =>
                  void startRequest(
                    "/audio/separate-local",
                    { assetId },
                    importResult,
                  )
                }
                onConnect={() => setModal("plugins")}
                onSubmit={async (body) => {
                  setBusy(true);
                  try {
                    setProposal(await api("/proposals", body));
                    setModal("approval");
                  } catch (e) {
                    notify((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
                busy={busy}
              />
            )}
            {modal === "analysis" && analysis && (
              <div className="modal-content">
                <Badge>
                  {analysis.type === "silence"
                    ? "무음 구간 분석"
                    : "장면 전환 분석"}
                </Badge>
                <h3 className="analysis-summary">
                  {analysis.message ||
                    (analysis.type === "silence"
                      ? `${analysis.silence?.length || 0}개의 무음 구간을 찾았습니다.`
                      : `${analysis.cuts?.length || 0}개의 장면 전환을 찾았습니다.`)}
                </h3>
                <p className="muted leading">
                  선택한 원본을 분석한 결과입니다. 적용 시 선택 클립 범위
                  안에서만 편집되며, 실행 취소로 되돌릴 수 있습니다.
                </p>
                <div className="analysis-list">
                  {analysis.type === "silence"
                    ? analysis.silence?.map(([a, b]: number[], i: number) => (
                        <div key={i}>
                          <Scissors size={15} />
                          <span>
                            {a.toFixed(2)}초 — {b.toFixed(2)}초
                          </span>
                          <Badge color="gray">{(b - a).toFixed(1)}초</Badge>
                        </div>
                      ))
                    : analysis.cuts?.map((t: number, i: number) => (
                        <div key={i}>
                          <SplitSquareHorizontal size={15} />
                          <span>{t.toFixed(2)}초에서 나누기</span>
                        </div>
                      ))}
                </div>
                <div className="modal-actions">
                  <button className="secondary" onClick={() => setModal(null)}>
                    원본 유지
                  </button>
                  <button
                    className="primary"
                    disabled={
                      !!analysis.message ||
                      !(analysis.type === "silence"
                        ? analysis.silence?.length
                        : analysis.cuts?.length)
                    }
                    onClick={applyAnalysis}
                  >
                    <Check size={16} />
                    제안 적용
                  </button>
                </div>
              </div>
            )}
            {modal === "approval" && proposal && (
              <div className="modal-content">
                <div className="approval-banner">
                  <ShieldCheck size={22} />
                  <p>
                    아래 내용에 동의하면 외부 플러그인으로 자료를 전송하고
                    유료일 수 있는 생성을 시작합니다.
                  </p>
                </div>
                <div className="export-settings">
                  <div>
                    <span>제공업체</span>
                    <strong>
                      {
                        connected.find((p) => p.id === proposal.input.pluginId)
                          ?.name
                      }
                    </strong>
                  </div>
                  <div>
                    <span>작업</span>
                    <strong>
                      {CAP_NAMES[proposal.input.capability]}{" "}
                      {proposal.input.mode?.toUpperCase()}
                    </strong>
                  </div>
                  <div>
                    <span>견적</span>
                    <strong>
                      {proposal.quote.cost} {proposal.quote.currency}
                    </strong>
                  </div>
                  <div>
                    <span>길이</span>
                    <strong>{proposal.input.duration}초</strong>
                  </div>
                </div>
                <label className="form-label">전송되는 자료</label>
                <div className="info-box">
                  {proposal.assets.length
                    ? proposal.assets.map((a: any) => (
                        <div key={a.id}>
                          {a.name} ·{" "}
                          {proposal.input.mode === "f2f"
                            ? "지정한 컷 프레임"
                            : "원본 파일"}
                        </div>
                      ))
                    : "텍스트 프롬프트만 전송"}
                  <p>{proposal.input.prompt}</p>
                </div>
                <p className="muted small">
                  견적은 10분 동안 유효합니다. 결과는 먼저 보관함에 추가되고,
                  확인 후 타임라인에 넣습니다.
                </p>
                <div className="modal-actions">
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={async () => {
                      await api(`/proposals/${proposal.id}/reject`, {});
                      setModal(null);
                    }}
                  >
                    취소
                  </button>
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() =>
                      void startRequest(
                        `/proposals/${proposal.id}/approve`,
                        { approved: true },
                        importResult,
                      )
                    }
                  >
                    <ShieldCheck size={16} />
                    전송 및 생성 승인
                  </button>
                </div>
              </div>
            )}
            {modal === "generated" && generated && (
              <div className="modal-content">
                <p className="muted">결과를 확인하고 타임라인에 추가하세요.</p>
                {generated.assets.map((a: Asset) => (
                  <div className="generated-asset" key={a.id}>
                    {a.type === "video" ? (
                      <video src={a.url} controls />
                    ) : (
                      <audio src={a.url} controls />
                    )}
                    <h3>{a.name}</h3>
                    <button
                      className="secondary full"
                      onClick={() => {
                        const boundary = generated.boundary;
                        if (a.type === "video" && boundary) {
                          const p = projectRef.current,
                            index = p.clips.findIndex(
                              (c) => c.id === boundary.leftClipId,
                            );
                          if (
                            index < 0 ||
                            p.clips[index + 1]?.id !== boundary.rightClipId
                          ) {
                            notify(
                              "원래 컷 위치가 바뀌었습니다. 보관함에서 원하는 위치로 추가해 주세요.",
                            );
                            return;
                          }
                          change((p) => {
                            const clips = [...p.clips];
                            clips.splice(index + 1, 0, makeClip(a));
                            return { ...p, clips };
                          });
                          notify("선택한 컷 사이에 연결 장면을 삽입했습니다.");
                        } else addAsset(a);
                        setModal(null);
                      }}
                    >
                      <Plus size={15} />
                      {generated.boundary && a.type === "video"
                        ? "원래 컷 사이에 삽입"
                        : "타임라인에 추가"}
                    </button>
                  </div>
                ))}
              </div>
            )}
            {modal === "codex" && codexPlan && (
              <div className="modal-content">
                <div className="approval-banner">
                  <Sparkles size={22} />
                  <p>{codexPlan.summary}</p>
                </div>
                {codexPlan.actions?.map((a: any, i: number) => (
                  <div className="codex-action" key={i}>
                    <div>
                      <h3>
                        {
                          {
                            silence: "무음 정리",
                            scenes: "장면 나누기",
                            normalize: "음량 정규화",
                            bridge: "연결 장면 생성",
                            captions: "텍스트 / 자막 추가",
                          }[a.type as string]
                        }
                      </h3>
                      <p>{a.reason}</p>
                    </div>
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() => {
                        if (a.type === "silence" || a.type === "scenes")
                          analyze(a.type);
                        if (a.type === "normalize") {
                          change((p) => ({ ...p, normalize: true }));
                          setModal(null);
                          notify("음량 정규화를 켰습니다.");
                        }
                        if (a.type === "bridge") setModal("bridge");
                        if (a.type === "captions") {
                          setNav("text");
                          setModal(null);
                        }
                      }}
                    >
                      검토
                    </button>
                  </div>
                ))}
                <p className="muted small">
                  제안만 생성되었습니다. 각 항목을 검토해 적용하세요.
                </p>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function TtsForm({
  status,
  busy,
  onSubmit,
  onPlugin,
}: {
  status: Status | null;
  busy: boolean;
  onSubmit: (body: any) => void;
  onPlugin: (body: any) => void;
}) {
  const [text, setText] = useState(
      "익숙한 곳을 벗어나, 조금 더 멀리. 나만의 속도로 새로운 이야기를 시작합니다.",
    ),
    [voice, setVoice] = useState("ko-KR-SunHiNeural"),
    [rate, setRate] = useState(0),
    [provider, setProvider] = useState("microsoft");
  return (
    <form
      className="modal-content"
      onSubmit={(e) => {
        e.preventDefault();
        provider === "microsoft"
          ? onSubmit({ text, voice, rate })
          : onPlugin({
              pluginId: provider,
              capability: "tts",
              prompt: text,
              assetIds: [],
              duration: 5,
            });
      }}
    >
      <p className="muted">
        텍스트를 입력하면 타임라인에 넣을 수 있는 음성 소재를 만듭니다.
      </p>
      <label className="form-label">
        음성 제공업체
        <select value={provider} onChange={(e) => setProvider(e.target.value)}>
          <option value="microsoft">Microsoft · 기본 TTS</option>
          {status?.plugins
            .filter((p) => p.connected && p.capabilities.includes("tts"))
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
        </select>
      </label>
      {provider === "microsoft" && (
        <>
          <label className="form-label">
            목소리
            <select value={voice} onChange={(e) => setVoice(e.target.value)}>
              <option value="ko-KR-SunHiNeural">선희 · 한국어 · 여성</option>
              <option value="ko-KR-InJoonNeural">인준 · 한국어 · 남성</option>
              <option value="en-US-JennyNeural">Jenny · English · 여성</option>
            </select>
          </label>
          <label className="form-label">
            말하기 속도{" "}
            <span>
              {rate > 0 ? "+" : ""}
              {rate}%
            </span>
            <input
              type="range"
              min="-30"
              max="30"
              value={rate}
              onChange={(e) => setRate(+e.target.value)}
            />
          </label>
        </>
      )}
      <label className="form-label">
        내레이션 텍스트
        <textarea
          rows={5}
          maxLength={3000}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <div className="field-meta">
        <span>{text.length} / 3,000</span>
        <span>생성 후 미리듣기 가능</span>
      </div>
      {provider === "microsoft" && (
        <div className="info-box">
          Microsoft Edge 온라인 음성 서비스를 edge-tts로 사용합니다. 텍스트가
          Microsoft에 전송되며, 서비스 정책과 연결 상태에 따라 제공이 달라질 수
          있습니다.
        </div>
      )}
      <button
        className="primary full"
        disabled={
          busy || !text.trim() || (provider === "microsoft" && !status?.tts)
        }
      >
        <Mic size={16} />
        {provider === "microsoft"
          ? "텍스트 전송 및 음성 만들기"
          : "견적 확인하기"}
      </button>
    </form>
  );
}

function PluginManager({
  status,
  assets,
  project,
  onImported,
  onChange,
  notify,
}: {
  status: Status | null;
  assets: Asset[];
  project: Project;
  onImported: () => Promise<void>;
  onChange: () => Promise<void>;
  notify: (text: string) => void;
}) {
  const [kind, setKind] = useState<"gateway" | "codex">("codex"),
    [key, setKey] = useState(""),
    [busy, setBusy] = useState(false);
  const [codexLogin, setCodexLogin] = useState<{
    state: string;
    url?: string;
    code?: string;
    error?: string;
  } | null>(null);
  useEffect(() => {
    void api("/connections/codex-login")
      .then(setCodexLogin)
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!codexLogin || !["starting", "waiting"].includes(codexLogin.state))
      return;
    const timer = setInterval(() => {
      void api("/connections/codex-login")
        .then(async (result) => {
          setCodexLogin(result);
          if (result.state === "connected") {
            await onChange();
            notify("ChatGPT 계정으로 Codex를 연결했습니다.");
          }
        })
        .catch((e) => notify(e.message));
    }, 1800);
    return () => clearInterval(timer);
  }, [codexLogin?.state, onChange, notify]);
  async function connect(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api(
        "/connections/" + kind,
        kind === "gateway" ? { token: key } : { key },
      );
      setKey("");
      await onChange();
      notify("계정 연결을 확인했습니다.");
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="modal-content">
      <p className="muted leading">
        ChatGPT 로그인으로 Codex와 계정 앱을 연결합니다.
        <br />
        기본 기능과 생성 실행 연동 상태를 확인하세요.
      </p>
      <div className="plugin-cards">
        <div className="plugin-card">
          <span className="plugin-symbol microsoft">▦</span>
          <div>
            <h3>
              Microsoft TTS{" "}
              <Badge color={status?.tts ? "mint" : "gray"}>
                {status?.tts ? "설치됨" : "설정 필요"}
              </Badge>
            </h3>
            <p>기본 내레이션 · 한국어 / 영어</p>
          </div>
        </div>
        <div className="plugin-card">
          <span className="plugin-symbol codex">◈</span>
          <div>
            <h3>
              Codex{" "}
              <Badge color={status?.codex ? "mint" : "gray"}>
                {status?.codex ? "연결됨" : "연결 필요"}
              </Badge>
            </h3>
            <p>자연어로 편집을 계획하고 제안 받기</p>
          </div>
        </div>
        <div className="plugin-card">
          <span className="plugin-symbol codex">
            <AudioLines size={24} />
          </span>
          <div>
            <h3>
              BandIt DnR{" "}
              <Badge color={status?.bandit.ready ? "mint" : "gray"}>
                {status?.bandit.ready ? "기본 제공" : "설정 필요"}
              </Badge>
            </h3>
            <p>보이스 · 효과음 · BGM 분리 · 외부 플러그인 불필요</p>
          </div>
        </div>
      </div>
      <AccountApps
        assets={assets}
        project={project}
        onImported={onImported}
        connected={
          status?.codexAuth === "chatgpt" || codexLogin?.state === "connected"
        }
      />
      {!!status?.plugins.length && (
        <h3 className="plugin-provider-heading">생성 실행에 연결된 도구</h3>
      )}
      <div className="plugin-cards">
        {status?.plugins.map((p) => (
          <div className="plugin-card" key={p.id}>
            <span className={`plugin-symbol ${p.id}`}>
              {p.letter || p.name[0]}
            </span>
            <div>
              <h3>
                {p.name}
                <Badge color={p.connected ? "mint" : "gray"}>
                  {p.connected ? "연결됨" : "미연결"}
                </Badge>
              </h3>
              <p>{p.description}</p>
              {p.connected && (
                <div className="cap-tags">
                  {p.capabilities.map((c) => (
                    <span key={c}>{CAP_NAMES[c]}</span>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="connect-form">
        <h3>
          <Link size={16} />
          계정 연결
        </h3>
        <div className="segmented">
          <button
            className={kind === "gateway" ? "selected" : ""}
            onClick={() => {
              setKind("gateway");
              setKey("");
            }}
          >
            추가 생성 연동
          </button>
          <button
            className={kind === "codex" ? "selected" : ""}
            onClick={() => {
              setKind("codex");
              setKey("");
            }}
          >
            Codex 로그인
          </button>
        </div>
        <p className="muted small">
          {kind === "gateway"
            ? status?.gatewayConfigured
              ? "게이트웨이의 계정 토큰으로 사용 가능한 플러그인을 조회합니다."
              : "서버의 PLUGIN_GATEWAY_URL 설정이 먼저 필요합니다. 연결 후 제공업체별 지원 기능을 자동 조회합니다."
            : "ChatGPT 계정으로 로그인해 Codex를 사용합니다. 해당 계정의 Codex 사용 한도와 정책이 적용됩니다."}
        </p>
        {kind === "codex" && (
          <div className="codex-login-panel">
            {status?.codexAuth === "chatgpt" ||
            codexLogin?.state === "connected" ? (
              <div className="info-box">
                ChatGPT 로그인으로 연결됨 · 사용자 계정의 Codex 사용량 적용
              </div>
            ) : (
              <>
                <button
                  className="primary full"
                  disabled={
                    codexLogin?.state === "starting" ||
                    codexLogin?.state === "waiting"
                  }
                  onClick={async () => {
                    try {
                      setCodexLogin(await api("/connections/codex-login", {}));
                    } catch (e) {
                      notify((e as Error).message);
                    }
                  }}
                >
                  <Link size={16} />
                  {codexLogin?.state === "starting"
                    ? "로그인 준비 중…"
                    : "ChatGPT 계정으로 Codex 연결"}
                </button>
                {codexLogin?.state === "waiting" && (
                  <div className="info-box">
                    <p>1. 아래 OpenAI 인증 페이지를 여세요.</p>
                    <a
                      href={codexLogin.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-button"
                    >
                      OpenAI 인증 페이지 열기 ↗
                    </a>
                    <p>2. 아래 코드를 입력하고 본인 계정으로 승인하세요.</p>
                    <code className="device-code">{codexLogin.code}</code>
                    <p className="muted small">
                      ChatGPT → 설정 → 보안에서 Codex 기기 코드 인증을 허용해야
                      할 수 있습니다. 인증 코드는 다른 사람에게 전달하지 마세요.
                    </p>
                    <button
                      className="text-button"
                      onClick={async () =>
                        setCodexLogin(
                          await api(
                            "/connections/codex-login",
                            undefined,
                            "DELETE",
                          ),
                        )
                      }
                    >
                      로그인 취소
                    </button>
                  </div>
                )}
                {codexLogin?.state === "failed" && (
                  <p className="access-error">{codexLogin.error}</p>
                )}
              </>
            )}
            <p className="secure-note">
              <LockKeyhole size={12} />
              로그인 토큰은 이 작업실의 서버에 보관됩니다. 연결 해제 시
              삭제합니다.
            </p>
          </div>
        )}
        <details open={kind === "gateway"} key={kind}>
          <summary>
            {kind === "codex"
              ? "대신 API 키로 연결하기 (API 별도 과금)"
              : "게이트웨이 토큰 입력"}
          </summary>
          <form onSubmit={connect}>
            <input
              type="password"
              autoComplete="off"
              aria-label="연결 키"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={
                kind === "gateway" ? "게이트웨이 계정 토큰" : "OpenAI API 키"
              }
            />
            <button
              className="primary"
              disabled={
                !key ||
                busy ||
                (kind === "gateway" && !status?.gatewayConfigured)
              }
            >
              {busy ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <Link size={15} />
              )}
              연결
            </button>
          </form>
          <p className="secure-note">
            <LockKeyhole size={12} />
            키는 브라우저에 저장하지 않고 서버 세션에서만 유지합니다.
          </p>
        </details>
        <button
          className="text-button danger"
          onClick={async () => {
            try {
              await api("/connections", undefined, "DELETE");
              setCodexLogin({ state: "idle" });
              await onChange();
              notify("사용자 플러그인과 Codex 연결을 해제했습니다.");
            } catch (e) {
              notify((e as Error).message);
            }
          }}
        >
          내 세션 연결 모두 해제
        </button>
      </div>
    </div>
  );
}

function GenerationForm({
  kind,
  project,
  assets,
  plugins,
  selected,
  status,
  onLocal,
  onSubmit,
  onConnect,
  busy,
}: {
  kind: "bridge" | "sfx" | "separate";
  project: Project;
  assets: Asset[];
  plugins: Plugin[];
  selected: string;
  status: Status | null;
  onLocal: (assetId: string) => void;
  onSubmit: (body: any) => void;
  onConnect: () => void;
  busy: boolean;
}) {
  const capability =
    kind === "bridge"
      ? "video-generation"
      : kind === "sfx"
        ? "sound-effects"
        : "audio-separation";
  const compatible = plugins.filter(
    (p) =>
      p.capabilities.includes(capability) &&
      (kind !== "separate" ||
        ["voice", "sfx", "bgm"].every((s) => p.stems?.includes(s))),
  );
  const [pluginId, setPluginId] = useState(compatible[0]?.id || ""),
    [mode, setMode] = useState("f2f"),
    [boundaryIndex, setBoundaryIndex] = useState(
      Math.max(
        0,
        Math.min(
          project.clips.length - 2,
          project.clips.findIndex((c) => c.id === selected),
        ),
      ),
    ),
    [duration, setDuration] = useState(3),
    [source, setSource] = useState(assets.find((a) => a.hasAudio)?.id || ""),
    [references, setReferences] = useState<string[]>([]),
    [prompt, setPrompt] = useState(
      kind === "bridge"
        ? "카메라의 이동과 빛의 방향을 유지하면서 두 풍경을 자연스럽게 연결해 주세요."
        : kind === "sfx"
          ? "산길을 따라 불어오는 부드러운 바람과 멀리 들리는 새 소리."
          : "",
    ),
    [prepareImage, setPrepareImage] = useState(false);
  const provider = compatible.find((p) => p.id === pluginId),
    left = project.clips[boundaryIndex],
    right = project.clips[boundaryIndex + 1],
    imageProviders = plugins.filter((p) =>
      p.capabilities.includes("image-generation"),
    );
  useEffect(() => {
    if (provider?.modes?.length && !provider.modes.includes(mode))
      setMode(provider.modes[0]);
  }, [provider, mode]);
  function submit(e: React.FormEvent) {
    e.preventDefault();
    const input = {
      pluginId: prepareImage ? imageProviders[0]?.id : pluginId,
      capability: prepareImage ? "image-generation" : capability,
      ...(kind === "bridge" && !prepareImage ? { mode } : {}),
      prompt,
      assetIds:
        kind === "bridge"
          ? mode === "f2f"
            ? [left?.assetId, right?.assetId].filter(Boolean)
            : references
          : kind === "separate"
            ? [source]
            : [],
      duration,
      ...(kind === "bridge" && !prepareImage && left && right
        ? {
            boundary: { leftClipId: left.id, rightClipId: right.id },
            ...(mode === "f2f"
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
          }
        : {}),
    };
    onSubmit(input);
  }
  if (kind !== "separate" && !compatible.length)
    return (
      <div className="modal-content">
        <div className="approval-banner">
          <Sparkles size={22} />
          <p>
            Codex에 연결된 편집 플러그인으로{" "}
            {kind === "bridge" ? "컷 연결 영상을" : "효과음을"} 만드세요.
          </p>
        </div>
        <p className="muted leading">
          플러그인을 선택하고 ‘Codex로 작업하기’를 누르면 실제 지원 기능과 계정
          상태를 확인합니다.{" "}
          {kind === "bridge"
            ? "F2F 또는 Omni / Ref를 선택할 수 있습니다. "
            : ""}
          필요한 작업·자료·예상 비용을 확인하고 승인한 뒤 실행합니다.
        </p>
        <button className="primary full" onClick={onConnect}>
          <Plug size={16} /> Codex 편집 플러그인 열기
        </button>
      </div>
    );
  return (
    <form className="modal-content" onSubmit={submit}>
      <p className="muted leading">
        {kind === "bridge"
          ? "연결할 컷과 생성 방식을 선택하세요. 실제 생성 전에 전송 자료와 견적을 확인합니다."
          : kind === "sfx"
            ? "장면에 필요한 소리를 설명하면 연결된 도구로 효과음을 생성합니다."
            : "보이스, 효과음, 배경 음악을 각각 독립된 오디오 소재로 가져옵니다."}
      </p>
      {kind === "bridge" && (
        <>
          <label className="form-label">
            연결할 컷
            <select
              value={boundaryIndex}
              onChange={(e) => setBoundaryIndex(+e.target.value)}
            >
              {project.clips.slice(0, -1).map((c, i) => (
                <option key={c.id} value={i}>
                  {i + 1}. {c.name} → {project.clips[i + 1].name}
                </option>
              ))}
            </select>
          </label>
          <div className="mode-cards">
            <button
              type="button"
              className={mode === "f2f" ? "selected" : ""}
              onClick={() => setMode("f2f")}
              disabled={!!provider && !provider.modes?.includes("f2f")}
            >
              <SplitSquareHorizontal size={21} />
              <strong>F2F</strong>
              <span>앞 장면의 끝 → 다음 장면의 시작</span>
            </button>
            <button
              type="button"
              className={mode === "omni" ? "selected" : ""}
              onClick={() => setMode("omni")}
              disabled={!!provider && !provider.modes?.includes("omni")}
            >
              <Layers size={21} />
              <strong>Omni / Ref</strong>
              <span>참조 소재로 스타일과 흐름 유지</span>
            </button>
          </div>
          {mode === "omni" && (
            <div className="reference-picker">
              <label className="form-label">참조 소재 · 최대 6개</label>
              {assets
                .filter((a) => a.type === "video")
                .map((a) => (
                  <label key={a.id}>
                    <input
                      type="checkbox"
                      checked={references.includes(a.id)}
                      onChange={(e) =>
                        setReferences((r) =>
                          e.target.checked
                            ? r.length < 6
                              ? [...r, a.id]
                              : r
                            : r.filter((id) => id !== a.id),
                        )
                      }
                    />
                    {a.name}
                  </label>
                ))}
            </div>
          )}
        </>
      )}
      {kind === "separate" && (
        <>
          <label className="form-label">
            분리할 원본
            <select value={source} onChange={(e) => setSource(e.target.value)}>
              {assets
                .filter((a) => a.hasAudio)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </select>
          </label>
          <div className="stem-list">
            <span>
              <Mic size={20} />
              보이스<small>대사 · 내레이션</small>
            </span>
            <span>
              <AudioLines size={20} />
              효과음<small>환경음 · 소리 효과</small>
            </span>
            <span>
              <Music2 size={20} />
              BGM<small>배경 음악</small>
            </span>
          </div>
          <div className="local-separator">
            <h3>BandIt DnR · 로컬 분리</h3>
            <p>
              대사 · 음악 · 효과음에 맞춰 학습된 공개 모델입니다. 플러그인과
              생성 크레딧 없이 이 서버에서 실행합니다.
            </p>
            <Badge color={status?.bandit.ready ? "mint" : "gray"}>
              {status?.bandit.ready ? "가중치 설치됨" : "가중치 필요"}
            </Badge>
            <p>{status?.bandit.reason}</p>
            <button
              type="button"
              className="primary full"
              disabled={busy || !status?.bandit.ready || !source}
              onClick={() => onLocal(source)}
            >
              <AudioLines size={16} />
              BandIt으로 3종 분리
            </button>
          </div>
        </>
      )}
      <label className="form-label">
        연결된 플러그인
        <select value={pluginId} onChange={(e) => setPluginId(e.target.value)}>
          {!compatible.length && (
            <option value="">사용 가능한 플러그인이 없습니다</option>
          )}
          {compatible.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      {!compatible.length && (
        <button type="button" className="connect-notice" onClick={onConnect}>
          <Plug size={18} />
          <span>이 기능을 지원하는 플러그인을 연결하세요</span>
          <ArrowRight size={16} />
        </button>
      )}
      {kind !== "separate" && (
        <>
          <label className="form-label">
            {kind === "sfx" ? "어떤 소리가 필요한가요?" : "장면 설명"}
            <textarea
              rows={3}
              value={prompt}
              maxLength={3000}
              onChange={(e) => setPrompt(e.target.value)}
            />
          </label>
          <label className="form-label">
            길이
            <select
              value={duration}
              onChange={(e) => setDuration(+e.target.value)}
            >
              {[3, 5, 8, 10].map((n) => (
                <option key={n} value={n}>
                  {n}초
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      {kind === "bridge" && (
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={prepareImage}
            disabled={!imageProviders.length}
            onChange={(e) => setPrepareImage(e.target.checked)}
          />
          <span>
            먼저 참조 이미지 생성하기
            <small>
              {imageProviders.length
                ? "이미지를 검토한 뒤 영상 생성을 별도로 승인합니다."
                : "이미지 생성 플러그인을 연결하면 사용할 수 있어요."}
            </small>
          </span>
        </label>
      )}
      <button
        className="primary full"
        disabled={
          busy ||
          (!compatible.length && !prepareImage) ||
          (kind === "bridge" &&
            (project.clips.length < 2 ||
              (mode === "omni" && !references.length))) ||
          (kind === "separate" && !source)
        }
      >
        <ShieldCheck size={16} />
        {prepareImage ? "이미지 생성 견적 확인" : "전송 자료와 견적 확인"}
      </button>
      <p className="secure-note centered">
        <ShieldCheck size={12} />이 단계에서는 파일 전송이나 생성이 시작되지
        않습니다.
      </p>
    </form>
  );
}
