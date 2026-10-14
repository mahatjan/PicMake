/** OpenAI 兼容 API 客户端：图片为 b64_json，部分中转只给 url（下载后并入同一条管线）；
 *  流式走 SSE；单次请求事务，无降级无重试 */
import { createParser } from "eventsource-parser";
import { apiUrl } from "../lib/url";
import {
  ApiError,
  clientError,
  MODEL_NAMES,
  type ApiConfig,
  type GenParams,
  type ImageRequestResult,
  type EditSubmission,
} from "../lib/types";

/** HTTP 状态 → 错误。message 是服务端原文（可能为空），原样保留不翻译；
 *  没有原文时 detail 给出客户端兜底说明，文案由界面按当前语言生成 */
function mapStatus(
  status: number,
  code: string | undefined,
  message: string,
): ApiError {
  if (status === 401)
    return new ApiError("auth", message, status, { code: "key-invalid" });
  if (status === 403)
    return new ApiError("org-unverified", message, status, {
      code: "org-unverified",
    });
  if (status === 429)
    return new ApiError("rate-limit", message, status, { code: "rate-limit" });
  if (status === 400 && /content|policy/i.test(code ?? "")) {
    return new ApiError("content-policy", message, status, {
      code: "blocked",
    });
  }
  if (status >= 500)
    return new ApiError("server", message, status, { code: "server-error" });
  return new ApiError("unknown", message, status, {
    code: "request-failed",
    params: { status },
  });
}

async function toApiError(res: Response): Promise<ApiError> {
  let message = "";
  let code: string | undefined;
  try {
    const j = await res.json();
    message = j?.error?.message ?? "";
    code = j?.error?.code;
  } catch {
    /* 非 JSON 响应体 */
  }
  return mapStatus(res.status, code, message);
}

async function fetchJson<T>(
  path: string,
  config: ApiConfig,
  init?: RequestInit,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(apiUrl(config.baseUrl, path), {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
        ...(init?.headers ?? {}),
      },
    });
  } catch (e) {
    if (init?.signal?.aborted) throw e;
    throw clientError("network", "unreachable");
  }
  if (!res.ok) throw await toApiError(res);
  return (await res.json()) as T;
}

/* ── 连接测试：GET /models，最便宜的校验方式 ── */

export async function testConnection(
  config: ApiConfig,
): Promise<{ ok: true; models: string[] } | { ok: false; error: ApiError }> {
  try {
    const j = await fetchJson<{ data?: Array<{ id: string }> }>(
      "/models",
      config,
    );
    return { ok: true, models: (j.data ?? []).map((m) => m.id) };
  } catch (e) {
    return { ok: false, error: e as ApiError };
  }
}

/* ── 参数映射 ── */

function bodyFields(
  params: GenParams,
): Record<string, string | number | boolean> {
  return {
    model: MODEL_NAMES[params.model],
    prompt: params.prompt,
    n: params.n,
    size: params.size === "auto" ? "auto" : `${params.size.w}x${params.size.h}`,
    quality: params.quality,
    background: params.background,
    output_format: params.outputFormat,
    moderation: "auto",
    stream: true,
    partial_images: 3,
  };
}

/* ── 非流式生成 ── */

/** 图片字段的两种形态：b64_json（官方）或 url（部分中转）。两者都在顶层或 data[] 里 */
function imageParts(j: any): { b64: string[]; urls: string[] } {
  const b64: string[] = [];
  const urls: string[] = [];
  const take = (d: any) => {
    if (typeof d?.b64_json === "string" && d.b64_json) b64.push(d.b64_json);
    else if (typeof d?.url === "string" && d.url) urls.push(d.url);
  };
  take(j);
  if (Array.isArray(j?.data)) j.data.forEach(take);
  return { b64, urls };
}

/** parseGenResponse 的结果：urls 还没下载，调用方要补齐 images */
export interface ParsedResponse extends ImageRequestResult {
  urls: string[];
}

/** 解析非流式响应体（普通请求与流式嗅探共用）；usage 原样保存 */
export function parseGenResponse(j: any): ParsedResponse {
  const { b64, urls } = imageParts(j);
  if (!b64.length && !urls.length) throw clientError("unknown", "no-image");
  return { images: b64, urls, usage: j.usage ?? null };
}

/* ── 异步任务型中转（如 apimart）：恒回任务单，轮询 GET /tasks/{id} 到 completed 取图片 URL ── */

const TASK_POLL_INTERVAL_MS = 3000;
const TASK_POLL_TIMEOUT_MS = 300_000;

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** 响应是「任务已提交」而非图片 */
function extractTaskId(j: any): string | null {
  const item = j?.data?.[0];
  if (
    item &&
    typeof item.task_id === "string" &&
    item.task_id &&
    !item.b64_json &&
    !item.url
  ) {
    return item.task_id;
  }
  return null;
}

/** 任务结果是图片 URL，下载转 b64 走统一管线 */
async function urlToB64(url: string, signal?: AbortSignal): Promise<string> {
  let res: Response;
  try {
    res = await fetch(url, { signal });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw clientError("network", "download-failed");
  }
  if (!res.ok)
    throw clientError("unknown", "download-http", { status: res.status });
  const blob = await res.blob();
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(clientError("unknown", "read-failed"));
    reader.readAsDataURL(blob);
  });
  return dataUrl.slice(dataUrl.indexOf(",") + 1);
}

/** url 形态的结果下载转 b64，才能与 b64 形态走同一条管线 */
function downloadUrls(urls: string[], signal?: AbortSignal): Promise<string[]> {
  return Promise.all(urls.map((u) => urlToB64(u, signal)));
}

/** 轮询任务到完成取图；保留请求级 usage */
async function resolveTaskResult(
  taskId: string,
  config: ApiConfig,
  signal?: AbortSignal,
): Promise<ImageRequestResult> {
  const deadline = Date.now() + TASK_POLL_TIMEOUT_MS;
  for (;;) {
    const j = await fetchJson<any>(
      `/tasks/${encodeURIComponent(taskId)}`,
      config,
      { signal },
    );
    const d = j?.data;
    const status = typeof d?.status === "string" ? d.status : "";
    if (status === "completed" && d?.result) {
      const urls: string[] = (d.result.images ?? []).flatMap(
        (im: any) => im.url ?? [],
      );
      if (!urls.length) throw clientError("unknown", "task-no-image");
      const b64s = await Promise.all(urls.map((u) => urlToB64(u, signal)));
      return { images: b64s, usage: d.usage ?? null };
    }
    if (status === "failed" || status === "error" || status === "cancelled") {
      const msg = d?.error?.message ?? d?.message ?? j?.error?.message;
      if (typeof msg === "string" && msg) throw new ApiError("server", msg);
      throw clientError("server", "task-failed");
    }
    if (Date.now() > deadline) throw clientError("server", "task-timeout");
    await sleep(TASK_POLL_INTERVAL_MS, signal);
  }
}

/* ── 流式生成：SSE 渐进预览 ── */

export interface StreamHandlers {
  onPartial?: (b64: string, index: number) => void;
  signal?: AbortSignal;
}

/** multipart 构造；局部重绘追加 mask 部件，不手工设置 boundary */
export function editFormData(
  submission: EditSubmission,
  params: GenParams,
): FormData {
  const form = new FormData();
  const fields = bodyFields(params);
  delete fields.moderation;
  for (const [key, value] of Object.entries(fields))
    form.append(key, String(value));
  // auto 不发送：部分中转对 flare 等模型拒绝 input_fidelity（invalid_input_fidelity_model）
  if (submission.inputFidelity !== "auto")
    form.append("input_fidelity", submission.inputFidelity);
  for (const { image } of submission.sources) {
    const ext = image.format === "jpeg" ? "jpg" : image.format;
    // 单图保留已有通道字段；多图使用 OpenAI 的 image[] multipart 数组。
    form.append(
      submission.sources.length === 1 ? "image" : "image[]",
      image.blob,
      `source.${ext}`,
    );
  }
  if (submission.inpaint)
    form.append("mask", submission.inpaint.maskImage.blob, "mask.png");
  return form;
}

/** 预览事件：官方 image_generation.partial_image，中转可能是 image.generation.partial_image */
const PARTIAL_TYPE = /^image[._](generation|edit)[._]partial_image$/;
/** 终稿事件：官方 image_generation.completed，部分中转用 image.generation.result */
const RESULT_TYPE = /^image[._](generation|edit)[._](completed|result)$/;

/** SSE 分帧包装：纯解析。事件名兼容 type/event 与 object 两种来源，图片兼容 b64 与 url 两种形态；
 *  url 只收集不下载（onEvent 是同步的），由调用方在流结束后统一取。 */
export function createImageParser(
  handlers: StreamHandlers,
  result: ImageRequestResult,
  urls: string[] = [],
) {
  return createParser({
    onEvent(ev) {
      if (!ev.data || ev.data === "[DONE]") return;
      let d: any;
      try {
        d = JSON.parse(ev.data);
      } catch {
        return;
      }
      const type = d.type ?? d.object ?? ev.event;
      if (type === "error" || d.error) {
        const error = d.error ?? d;
        const mapped = mapStatus(
          error.status ?? 400,
          error.code,
          error.message ?? "",
        );
        // 事件里完全没有 message：统一说「生成失败」，不按状态码细分
        if (error.message == null)
          mapped.detail = { code: "generation-failed" };
        throw mapped;
      }
      const parts = imageParts(d);
      if (PARTIAL_TYPE.test(type)) {
        if (parts.b64.length)
          handlers.onPartial?.(parts.b64[0], d.partial_image_index ?? 0);
      } else if (RESULT_TYPE.test(type)) {
        result.images.push(...parts.b64);
        urls.push(...parts.urls);
        // usage 是请求级总量，后续完成事件的总量回显覆盖，绝不按图相加。
        if (d.usage) result.usage = d.usage;
      }
    },
  });
}

/** 文生图和编辑共享传输与错误语义；配置在调用时固定。edit 存在时走 /images/edits。 */
export async function requestImages(
  params: GenParams,
  config: ApiConfig,
  handlers: StreamHandlers = {},
  edit?: EditSubmission,
): Promise<ImageRequestResult> {
  const url = apiUrl(
    config.baseUrl,
    edit ? "/images/edits" : "/images/generations",
  );
  let res: Response;
  try {
    handlers.signal?.throwIfAborted();
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        ...(!edit ? { "Content-Type": "application/json" } : {}),
      },
      body: edit
        ? editFormData(edit, params)
        : JSON.stringify(bodyFields(params)),
      signal: handlers.signal,
    });
  } catch (e) {
    if (handlers.signal?.aborted) throw e;
    throw clientError("network", "unreachable");
  }
  if (!res.ok) throw await toApiError(res);
  // 中转对 stream 请求回 JSON（普通响应或任务单）时就地解析，
  // 不重发请求——重发等于同一批图计费两次。
  if ((res.headers.get("content-type") ?? "").includes("json")) {
    const j = await res.json();
    const taskId = extractTaskId(j);
    if (taskId) return resolveTaskResult(taskId, config, handlers.signal);
    const parsed = parseGenResponse(j);
    return {
      images: [
        ...parsed.images,
        ...(await downloadUrls(parsed.urls, handlers.signal)),
      ],
      usage: parsed.usage,
    };
  }
  if (!res.body) throw clientError("unknown", "no-content");
  const result: ImageRequestResult = { images: [], usage: null };
  const urls: string[] = [];
  const parser = createImageParser(handlers, result, urls);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let streamError: unknown;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.feed(decoder.decode(value, { stream: true }));
    }
    parser.feed(decoder.decode());
    parser.reset({ consume: true });
  } catch (e) {
    streamError = e;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  handlers.signal?.throwIfAborted();
  if (streamError) throw streamError;
  // url 形态的终稿在流结束后下载；中断时 fetch 直接 abort，不会留下半张图
  if (urls.length)
    result.images.push(...(await downloadUrls(urls, handlers.signal)));
  if (!result.images.length) throw clientError("unknown", "no-image");
  return result;
}
