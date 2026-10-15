/** autodl.art 图生视频：提交与查询。鉴权是 Token 原文，不走生图客户端的 /v1 与 Bearer。 */
import {
  interpretPoll,
  parseSubmitResponse,
  VIDEO_API_BASE,
  VIDEO_SUBMIT_TIMEOUT_MS,
  type PollRead,
} from "../lib/video";

export type VideoHttpFailure =
  | { kind: "network" }
  | { kind: "timeout" }
  | { kind: "http"; status: number; message: string };

async function readMessage(res: Response): Promise<string> {
  try {
    const data: unknown = await res.json();
    if (!data || typeof data !== "object") return "";
    const rec = data as Record<string, unknown>;
    if (typeof rec.msg === "string" && rec.msg) return rec.msg;
    if (typeof rec.message === "string" && rec.message) return rec.message;
    const err = rec.error;
    if (
      err &&
      typeof err === "object" &&
      typeof (err as { message?: unknown }).message === "string"
    ) {
      return (err as { message: string }).message;
    }
  } catch {
    /* 非 JSON */
  }
  return "";
}

function authHeaders(token: string): HeadersInit {
  return {
    Authorization: token,
    "Content-Type": "application/json",
  };
}

async function request(
  url: string,
  token: string,
  init: RequestInit,
): Promise<
  { ok: true; data: unknown } | { ok: false; failure: VideoHttpFailure }
> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { ...authHeaders(token), ...(init.headers ?? {}) },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError")
      return { ok: false, failure: { kind: "timeout" } };
    if (error instanceof Error && error.name === "AbortError")
      return { ok: false, failure: { kind: "timeout" } };
    if (error instanceof TypeError)
      return { ok: false, failure: { kind: "network" } };
    throw error;
  }
  if (!res.ok) {
    return {
      ok: false,
      failure: {
        kind: "http",
        status: res.status,
        message: await readMessage(res),
      },
    };
  }
  try {
    return { ok: true, data: await res.json() };
  } catch {
    return {
      ok: false,
      failure: { kind: "http", status: res.status, message: "" },
    };
  }
}

export async function submitVideoTask(
  token: string,
  workflowId: string,
  body: Record<string, string | number>,
): Promise<
  | { ok: true; taskId: string }
  | {
      ok: false;
      failure: VideoHttpFailure | { kind: "rejected"; message: string };
    }
> {
  const result = await request(
    `${VIDEO_API_BASE}/comfyui_workflow/${encodeURIComponent(workflowId)}`,
    token,
    {
      method: "POST",
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(VIDEO_SUBMIT_TIMEOUT_MS),
    },
  );
  if (!result.ok) return result;
  const parsed = parseSubmitResponse(result.data);
  if (!parsed.ok)
    return {
      ok: false,
      failure: { kind: "rejected", message: parsed.message },
    };
  return parsed;
}

export async function queryVideoTask(
  token: string,
  taskId: string,
): Promise<
  { ok: true; poll: PollRead } | { ok: false; failure: VideoHttpFailure }
> {
  const result = await request(
    `${VIDEO_API_BASE}/comfyui_workflow/result/${encodeURIComponent(taskId)}`,
    token,
    { method: "GET" },
  );
  if (!result.ok) return result;
  return { ok: true, poll: interpretPoll(result.data) };
}
