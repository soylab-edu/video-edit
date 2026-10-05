export type Asset = {
  id: string;
  name: string;
  type: "video" | "audio";
  url: string;
  thumbnail: string;
  duration: number;
  hasAudio: boolean;
  demo?: boolean;
  deleted?: boolean;
  stem?: string;
};
export type Clip = {
  id: string;
  assetId: string;
  name: string;
  in: number;
  out: number;
  speed: number;
  volume: number;
  brightness: number;
  saturation: number;
};
export type AudioClip = {
  id: string;
  assetId: string;
  start: number;
  volume: number;
  duration: number;
};
export type Title = { id: string; text: string; start: number; end: number };
export type Project = {
  name: string;
  ratio: "16:9" | "9:16" | "1:1";
  clips: Clip[];
  audio: AudioClip[];
  titles: Title[];
  normalize: boolean;
};
export type Plugin = {
  id: string;
  name: string;
  description: string;
  capabilities: string[];
  connected: boolean;
  modes?: string[];
  stems?: string[];
  letter?: string;
};
export type Status = {
  ffmpeg: boolean;
  tts: boolean;
  demucs: boolean;
  bandit: { installed: boolean; ready: boolean; reason: string };
  codex: boolean;
  codexAuth?: "api-key" | "chatgpt" | null;
  gatewayConfigured: boolean;
  plugins: Plugin[];
};
export type Job = {
  id: string;
  type: string;
  status: string;
  progress: number;
  error?: string;
  result?: any;
};
export const length = (c: Clip) => (c.out - c.in) / c.speed;
export const total = (p: Project) =>
  p.clips.reduce((sum, c) => sum + length(c), 0);
export const uid = () => crypto.randomUUID();
export const clock = (t: number) =>
  `${String(Math.floor(Math.max(0, t) / 60)).padStart(2, "0")}:${String(Math.floor(Math.max(0, t) % 60)).padStart(2, "0")}`;
export const timecode = (t: number) =>
  `${clock(t)}:${String(Math.floor((Math.max(0, t) % 1) * 24)).padStart(2, "0")}`;
export const makeClip = (a: Asset): Clip => ({
  id: uid(),
  assetId: a.id,
  name: a.name,
  in: 0,
  out: a.duration,
  speed: 1,
  volume: 1,
  brightness: 0,
  saturation: 1,
});
export async function api<T = any>(
  url: string,
  body?: unknown,
  method?: string,
): Promise<T> {
  const response = await fetch("/api" + url, {
    method: method || (body ? "POST" : "GET"),
    headers:
      body instanceof FormData
        ? {}
        : body
          ? { "Content-Type": "application/json" }
          : {},
    body:
      body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error || "요청을 처리하지 못했습니다.");
  return data;
}
