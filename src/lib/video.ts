/** 图生视频：工作流表、校验、请求体与轮询结果解析。不产出界面文案。
 *  分辨率取值是 autodl.art 的协议标记（含竖/横），用码位拼出，避免在源码里写界面文字。 */

export const VIDEO_API_BASE = "https://autodl.art/api/v1/comfyui";
export const VIDEO_DEFAULT_WORKFLOW = "minimax_h3_lightx2v_v5";
export const FRAME_WORKFLOW_ID = "minimax_h3_lightx2v";
export const CUSTOM_FALLBACK_SEED = "479044338007328";

export const VIDEO_MAX_REFS = 6;
export const VIDEO_PROMPT_MAX = 500000;
export const VIDEO_DURATION_MAX = 15;
export const VIDEO_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const VIDEO_MIME = ["image/png", "image/jpeg", "image/webp"] as const;

export const VIDEO_SUBMIT_TIMEOUT_MS = 60_000;
export const VIDEO_POLL_INTERVAL_MS = 5_000;
export const VIDEO_POLL_MAX_MS = 20 * 60 * 1000;
export const VIDEO_POLL_MAX_FAILS = 6;

export type VideoEntry = "ref" | "frames" | "custom";
export type VideoInputMode = "refs" | "frames";
export type VideoStatus = "pending" | "done" | "error";

export type VideoIssue =
  | "missing-key"
  | "empty-prompt"
  | "prompt-too-long"
  | "bad-duration"
  | "missing-workflow"
  | "bad-seed"
  | "missing-refs"
  | "missing-frames"
  | "bad-file-type"
  | "file-too-large"
  | "frames-full"
  | "refs-full"
  | "read-failed";

export type VideoFailCode =
  | "submit-timeout"
  | "network"
  | "poll-exhausted"
  | "wait-timeout"
  | "no-url"
  | "no-task"
  | "read-failed"
  | "interrupted";

export interface VideoRefStored {
  blob: Blob;
  name: string;
  role?: "first" | "last";
}

export interface VideoRecord {
  id: string;
  status: VideoStatus;
  taskId: string;
  workflow: string;
  entry: VideoEntry;
  prompt: string;
  duration: number;
  resolution: string;
  seed: string;
  inputMode: VideoInputMode;
  refs: VideoRefStored[];
  remoteUrl: string;
  /** 服务端原文；有原文时界面原样显示 */
  error: string | null;
  failCode: VideoFailCode | null;
  createdAt: number;
  finishedAt: number | null;
  pollFails: number;
}

export interface VideoWorkflow {
  id: string;
  input?: "frames";
  defaultSeed: string;
  defaultResolution?: string;
  resolutions: readonly string[];
}

const VERT = String.fromCodePoint(0x7ad6);
const HORZ = String.fromCodePoint(0x6a2a);

function orient(px: number, dir: "v" | "h", dims?: string): string {
  const token = `${px}p${dir === "v" ? VERT : HORZ}`;
  return dims ? `${token}(${dims})` : token;
}

function square(px: number): string {
  return `${px}p(1:1)`;
}

const STD_RES = [
  orient(480, "v"),
  orient(768, "v"),
  orient(1080, "v"),
  orient(480, "h"),
  orient(768, "h"),
  orient(1080, "h"),
  square(480),
  square(768),
  square(1080),
] as const;

const SHORT_RES = [
  orient(480, "v"),
  orient(768, "v"),
  orient(480, "h"),
  orient(768, "h"),
] as const;

const Z0902_RES = [
  orient(480, "v", "480*864"),
  orient(480, "h", "864*480"),
  orient(768, "v", "768*1376"),
  orient(768, "h", "1376*768"),
  orient(1088, "v", "1088*1920"),
  orient(1088, "h", "1920*1088"),
  orient(1440, "v", "1440*2560"),
  orient(1440, "h", "2560*1440"),
] as const;

const FRAME_RES = [
  orient(480, "v"),
  orient(480, "h"),
  orient(768, "v"),
  orient(768, "h"),
  square(480),
  square(768),
] as const;

export const VIDEO_WORKFLOWS: readonly VideoWorkflow[] = [
  {
    id: "minimax_h3_lightx2v_v5",
    defaultSeed: "212238359716024",
    resolutions: STD_RES,
  },
  {
    id: "minimax_h3_z0902",
    defaultSeed: "629515677062289",
    resolutions: Z0902_RES,
  },
  {
    id: "minimax_h3_zm_u08",
    defaultSeed: "806661161901022",
    resolutions: STD_RES,
  },
  {
    id: "minimax_h3_image_audio_to_video_v2_15s",
    defaultSeed: "731242627237534",
    resolutions: SHORT_RES,
  },
  {
    id: "minimax_h3_zm_u24",
    defaultSeed: "683072603085674",
    resolutions: STD_RES,
  },
  {
    id: FRAME_WORKFLOW_ID,
    input: "frames",
    defaultSeed: "479044338007328",
    defaultResolution: orient(768, "v"),
    resolutions: FRAME_RES,
  },
];

export function getVideoWorkflow(id: string): VideoWorkflow | null {
  return VIDEO_WORKFLOWS.find((workflow) => workflow.id === id) ?? null;
}

export function isKnownWorkflow(id: string): boolean {
  return getVideoWorkflow(id) !== null;
}

export function refWorkflows(): readonly VideoWorkflow[] {
  return VIDEO_WORKFLOWS.filter((workflow) => workflow.input !== "frames");
}

export function defaultSeedFor(workflowId: string): string {
  return getVideoWorkflow(workflowId)?.defaultSeed ?? CUSTOM_FALLBACK_SEED;
}

export function allVideoResolutions(): string[] {
  const seen = new Set<string>();
  const list: string[] = [];
  for (const workflow of VIDEO_WORKFLOWS) {
    for (const value of workflow.resolutions) {
      if (seen.has(value)) continue;
      seen.add(value);
      list.push(value);
    }
  }
  return list;
}

export function resolutionOptions(opts: {
  entry: VideoEntry;
  workflowId: string;
}): string[] {
  if (opts.entry === "custom") return allVideoResolutions();
  const workflow =
    getVideoWorkflow(opts.workflowId) ??
    getVideoWorkflow(VIDEO_DEFAULT_WORKFLOW);
  return workflow ? [...workflow.resolutions] : [];
}

/** 切换工作流后的分辨率：该工作流记过的值优先，其次工作流默认，再次沿用当前值，否则取第一项 */
export function pickResolution(opts: {
  options: readonly string[];
  cached?: string;
  current: string;
  preferred?: string;
}): string {
  const { options, cached, current, preferred } = opts;
  if (cached && options.includes(cached)) return cached;
  if (preferred && options.includes(preferred)) return preferred;
  if (options.includes(current)) return current;
  return options[0] ?? current;
}

export function videoFileIssue(file: {
  type: string;
  size: number;
}): "bad-file-type" | "file-too-large" | null {
  if (!VIDEO_MIME.includes(file.type as (typeof VIDEO_MIME)[number]))
    return "bad-file-type";
  if (file.size > VIDEO_MAX_FILE_BYTES) return "file-too-large";
  return null;
}

export interface VideoPlanInput {
  hasKey: boolean;
  entry: VideoEntry;
  workflowId: string;
  customInput: VideoInputMode;
  prompt: string;
  duration: string;
  resolution: string;
  /** 用户手填；空字符串表示用该工作流默认 seed */
  seed: string;
  refCount: number;
  hasFirst: boolean;
  hasLast: boolean;
}

export interface VideoPlan {
  workflowId: string;
  entry: VideoEntry;
  inputMode: VideoInputMode;
  prompt: string;
  duration: number;
  resolution: string;
  seed: string;
}

export function planVideoSubmit(
  input: VideoPlanInput,
): { ok: true; plan: VideoPlan } | { ok: false; issue: VideoIssue } {
  if (!input.hasKey) return { ok: false, issue: "missing-key" };
  const prompt = input.prompt.trim();
  if (!prompt) return { ok: false, issue: "empty-prompt" };
  if (prompt.length > VIDEO_PROMPT_MAX)
    return { ok: false, issue: "prompt-too-long" };
  const durationText = input.duration.trim();
  if (!/^\d+$/.test(durationText)) return { ok: false, issue: "bad-duration" };
  const duration = Number(durationText);
  if (duration < 1 || duration > VIDEO_DURATION_MAX)
    return { ok: false, issue: "bad-duration" };
  const workflowId = input.workflowId.trim();
  if (input.entry === "custom" && !workflowId)
    return { ok: false, issue: "missing-workflow" };
  const resolvedId =
    input.entry === "frames"
      ? FRAME_WORKFLOW_ID
      : workflowId || VIDEO_DEFAULT_WORKFLOW;
  const seedText = input.seed.trim();
  const seed = seedText || defaultSeedFor(resolvedId);
  if (!/^\d{1,15}$/.test(seed)) return { ok: false, issue: "bad-seed" };
  const inputMode: VideoInputMode =
    input.entry === "frames" ||
    (input.entry === "custom" && input.customInput === "frames") ||
    getVideoWorkflow(resolvedId)?.input === "frames"
      ? "frames"
      : "refs";
  if (inputMode === "frames") {
    if (!input.hasFirst || !input.hasLast)
      return { ok: false, issue: "missing-frames" };
  } else if (input.refCount < 1) {
    return { ok: false, issue: "missing-refs" };
  }
  const options = resolutionOptions({
    entry: input.entry === "frames" ? "frames" : input.entry,
    workflowId: resolvedId,
  });
  const resolution = options.includes(input.resolution)
    ? input.resolution
    : (options[0] ?? input.resolution);
  return {
    ok: true,
    plan: {
      workflowId: resolvedId,
      entry: input.entry === "frames" ? "frames" : input.entry,
      inputMode,
      prompt,
      duration,
      resolution,
      seed,
    },
  };
}

export function buildVideoBody(
  plan: VideoPlan,
  images: readonly string[],
): Record<string, string | number> {
  const body: Record<string, string | number> = {
    duration: plan.duration,
    prompt: plan.prompt,
    resolution: plan.resolution,
    seed: Number(plan.seed),
  };
  if (plan.inputMode === "frames") {
    body.first_frame = images[0] ?? "";
    body.last_frame = images[1] ?? "";
  } else {
    images.slice(0, VIDEO_MAX_REFS).forEach((url, index) => {
      body[`ref_image_${index}`] = url;
    });
  }
  return body;
}

export function parseSubmitResponse(
  data: unknown,
): { ok: true; taskId: string } | { ok: false; message: string } {
  if (!data || typeof data !== "object") return { ok: false, message: "" };
  const rec = data as Record<string, unknown>;
  const inner = rec.data;
  const taskId =
    inner && typeof inner === "object"
      ? (inner as Record<string, unknown>).task_id
      : undefined;
  if (rec.code === "Success" && typeof taskId === "string" && taskId)
    return { ok: true, taskId };
  const message =
    typeof rec.msg === "string"
      ? rec.msg
      : typeof rec.message === "string"
        ? rec.message
        : "";
  return { ok: false, message };
}

export type PollRead =
  | { kind: "success"; url: string }
  | { kind: "pending" }
  | { kind: "failed"; message: string };

function extractResultUrls(results: unknown): string[] {
  if (!Array.isArray(results)) return [];
  return results
    .map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object") {
        const rec = item as Record<string, unknown>;
        const url = rec.url ?? rec.video_url ?? rec.file_url ?? "";
        return typeof url === "string" ? url : "";
      }
      return "";
    })
    .filter(Boolean);
}

export function interpretPoll(data: unknown): PollRead {
  if (!data || typeof data !== "object") return { kind: "failed", message: "" };
  const rec = data as Record<string, unknown>;
  const inner =
    rec.data && typeof rec.data === "object"
      ? (rec.data as Record<string, unknown>)
      : {};
  const status = String(inner.status ?? "").toUpperCase();
  if (status === "SUCCESS") {
    const urls = extractResultUrls(inner.results);
    if (!urls.length) return { kind: "failed", message: "" };
    return { kind: "success", url: urls[0] };
  }
  if (status === "QUEUED" || status === "RUNNING") return { kind: "pending" };
  const fromData = typeof inner.message === "string" ? inner.message : "";
  const fromRoot = typeof rec.msg === "string" ? rec.msg : "";
  return { kind: "failed", message: fromData || fromRoot };
}

function asBlob(value: unknown): Blob | null {
  return typeof Blob !== "undefined" && value instanceof Blob ? value : null;
}

function legacyRefs(raw: Record<string, unknown>): VideoRefStored[] {
  const list = Array.isArray(raw.refImages) ? raw.refImages : [];
  const refs: VideoRefStored[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const blob = asBlob(rec.blob);
    if (!blob) continue;
    const role =
      rec.role === "first" || rec.role === "last" ? rec.role : undefined;
    refs.push({
      blob,
      name: typeof rec.name === "string" ? rec.name : "",
      role,
    });
  }
  if (!refs.length) {
    const cover = asBlob(raw.refImage);
    if (cover) refs.push({ blob: cover, name: "" });
  }
  return refs;
}

/** 旧页面 `ai_image_playground` 里的一条记录。非视频、缺 id 的返回 null。
 *  没有 taskId 的 pending 视为被刷新打断。 */
export function importLegacyVideo(raw: unknown): VideoRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  if (rec.type !== "video") return null;
  if (typeof rec.id !== "string" || !rec.id) return null;
  const workflow = typeof rec.workflow === "string" ? rec.workflow : "";
  const entry: VideoEntry =
    rec.entry === "custom" || rec.entry === "frames" || rec.entry === "ref"
      ? rec.entry
      : rec.inputMode === "frames" || workflow === FRAME_WORKFLOW_ID
        ? "frames"
        : "ref";
  const inputMode: VideoInputMode =
    rec.inputMode === "frames" || entry === "frames" ? "frames" : "refs";
  const remoteUrl = typeof rec.url === "string" ? rec.url : "";
  let status: VideoStatus =
    rec.status === "pending" || rec.status === "done" || rec.status === "error"
      ? rec.status
      : remoteUrl
        ? "done"
        : "error";
  const taskId = typeof rec.taskId === "string" ? rec.taskId : "";
  let failCode: VideoFailCode | null = null;
  if (status === "pending" && !taskId) {
    status = "error";
    failCode = "interrupted";
  }
  const createdAt = typeof rec.createdAt === "number" ? rec.createdAt : 0;
  const finished = typeof rec.finishedAt === "number" ? rec.finishedAt : null;
  const duration = typeof rec.duration === "number" ? rec.duration : 0;
  const pollFails =
    typeof rec.pollFails === "number" && rec.pollFails > 0 ? rec.pollFails : 0;
  return {
    id: rec.id,
    status,
    taskId,
    workflow,
    entry,
    prompt: typeof rec.prompt === "string" ? rec.prompt : "",
    duration,
    resolution: typeof rec.resolution === "string" ? rec.resolution : "",
    seed: rec.seed == null ? "" : String(rec.seed),
    inputMode,
    refs: legacyRefs(rec),
    remoteUrl,
    error: typeof rec.error === "string" && rec.error ? rec.error : null,
    failCode,
    createdAt,
    finishedAt: finished,
    pollFails,
  };
}
