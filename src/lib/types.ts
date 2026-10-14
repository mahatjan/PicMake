/** 核心类型定义 */

export type ModelId = "flare" | "sunburst" | "gpt2";
export type Quality = "low" | "medium" | "high" | "xhigh" | "max";
export type Background = "auto" | "transparent" | "opaque";
export type InputFidelity = "low" | "high";
/** 保真度选择：auto = 不发送 input_fidelity（部分中转拒绝该参数） */
export type FidelityChoice = "auto" | InputFidelity;
export type OutputFormat = "png" | "jpeg" | "webp";

export interface ApiConfig {
  baseUrl: string;
  apiKey: string;
}

export const MODEL_NAMES: Record<ModelId, string> = {
  flare: "gpt-image-2.5-flare",
  sunburst: "gpt-image-2.5-sunburst",
  gpt2: "gpt-image-2",
};

/** 具体像素尺寸 */
export type PixelSize = { w: number; h: number };

/** 尺寸：'auto' 或具体宽高 */
export type SizeSpec = PixelSize | "auto";

export interface GenParams {
  model: ModelId;
  prompt: string;
  size: SizeSpec;
  quality: Quality;
  /** 产品上限 4 */
  n: number;
  background: Background;
  outputFormat: OutputFormat;
  /** 多尺寸（2026-10-13）：提交时所选的 2–4 个尺寸，按比例 chip 顺序，每个尺寸单独一个请求。
   *  存在时 n = 1；size 取 sizes[0] 只为保持字段合法，展示与复用不得据此推断尺寸。
   *  单尺寸记录与旧记录没有这个字段 */
  sizes?: PixelSize[];
}

/** 有序输入来源；本地文件没有 generationId。 */
export interface InputSource {
  imageId: string;
  generationId?: string;
  name?: string;
}

export interface InputImage extends InputSource {
  /** 仅上传草稿持有原图，历史作品在提交时读取。 */
  upload?: import("../db/schema").ImageRow;
}

export interface EditDraft {
  inputs: InputImage[];
  inputFidelity: FidelityChoice;
  /** 已确认的局部重绘附件：底图恒为 inputs[0] */
  inpaint?: InpaintDraft;
}

export interface EditSubmission {
  sources: { source: InputSource; image: import("../db/schema").ImageRow }[];
  inputFidelity: FidelityChoice;
  /** 提交快照中的 mask：仅 multipart 追加 mask 部件，不进入 sources */
  inpaint?: {
    maskImage: MaskImage;
    original?: {
      source: InputSource;
      image: import("../db/schema").ImageRow;
    };
  };
}

/** 草图：可重放的绘制命令文档，随 ImageRow 持久化 */

export interface SketchPoint {
  x: number;
  y: number;
}

/** 一笔 = 一次完整拖动或一次单击（圆点）；橡皮忽略颜色 */
export interface SketchStroke {
  type: "stroke";
  tool: "pen" | "eraser";
  color?: string;
  width: number;
  points: SketchPoint[];
}

export interface SketchClear {
  type: "clear";
}

export type SketchCommand = SketchStroke | SketchClear;

export interface SketchDocument {
  version: 1;
  width: number;
  height: number;
  commands: SketchCommand[];
}

export const MAX_INPUT_IMAGES = 16;
export const MAX_INPUT_BYTES = 50 * 1024 * 1024;

/** 局部重绘 */

/** 一笔 = 一次完整拖动或一次单击（圆点）；画笔扩大覆盖，擦除减少覆盖 */
/** width 为底图像素单位的笔刷直径，缩放不改变已有笔宽。 */
export type MaskStroke = Omit<SketchStroke, "color">;

export type MaskCommand = MaskStroke | SketchClear;

/** 绑定实际请求底图的选区文档（baseImageId ≠ 方向归一前的原文件） */
export interface MaskDocument extends Omit<SketchDocument, "commands"> {
  baseImageId: string;
  commands: MaskCommand[];
}

/** mask 资源行：PNG Blob + 可重放文档，宽高取底图尺寸 */
export type MaskImage = import("../db/schema").ImageRow & {
  mask: MaskDocument;
};

/** 局部重绘的发起入口：结果图、草稿中的图、重开已确认选区 */
export type InpaintEntry = "result" | "draft-input" | "reedit";

/** 创作草稿 / 提交快照共用的局部重绘附件 */
export interface InpaintDraft {
  mask: MaskImage;
  /** 仅发生 EXIF 方向归一化时存在 */
  original?: {
    source: InputSource;
    image: import("../db/schema").ImageRow;
  };
}

/** 存在即表示该记录是局部重绘 */
export interface InpaintHistory {
  maskImageId: string;
  originalSource?: InputSource;
}

/** 草稿校验错误码（非异常）；界面文案见 i18n 资源 inpaint.issue.* */
export type InpaintIssue =
  | "empty-mask"
  | "invalid-mask"
  | "pixel-limit"
  | "ratio-limit"
  | "unsupported-orientation"
  | "canvas-failed"
  | "mask-too-large";

export interface ImageRequestResult {
  images: string[];
  /** 请求级原始 usage（原样保存，不做费用展示） */
  usage: Record<string, unknown> | null;
}

export type ApiErrorKind =
  | "invalid-image"
  | "image-too-large"
  | "too-many-images"
  | "source-unavailable"
  | "save-failed"
  | "history-unavailable" // 本地历史读取失败（liveQuery 出错）
  | "auth" // 401：Key 无效
  | "org-unverified" // 403：组织未完成资格验证
  | "rate-limit" // 429
  | "content-policy" // 内容政策拦截
  | "server" // 5xx
  | "network"
  | "unknown";

/** 客户端自己产生的错误细节（服务端原文放 ApiError.message，不翻译）；界面文案见 i18n 资源 errors.detail.* */
export const API_ERROR_DETAIL_CODES = [
  "key-invalid",
  "org-unverified",
  "rate-limit",
  "blocked",
  "server-error",
  "request-failed", // 其他状态码，参数 status
  "generation-failed",
  "unreachable",
  "no-image",
  "no-content",
  "task-no-image",
  "task-failed",
  "task-timeout",
  "download-failed",
  "download-http", // 参数 status
  "read-failed",
  "source-missing", // 参数 index（从 1 起）
] as const;
export type ApiErrorDetailCode = (typeof API_ERROR_DETAIL_CODES)[number];

export interface ApiErrorDetail {
  code: ApiErrorDetailCode;
  params?: Record<string, string | number>;
}

/** 展示文案 = message（服务端原文，可能为空）→ detail（客户端细节）→ 该 kind 的通用建议，见 i18n/errors.ts */
export class ApiError extends Error {
  kind: ApiErrorKind;
  status?: number;
  detail?: ApiErrorDetail;

  constructor(
    kind: ApiErrorKind,
    message: string,
    status?: number,
    detail?: ApiErrorDetail,
  ) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
    this.status = status;
    this.detail = detail;
  }
}

/** 客户端自己产生的错误：没有服务端原文，只带细节码 */
export function clientError(
  kind: ApiErrorKind,
  code: ApiErrorDetailCode,
  params?: ApiErrorDetail["params"],
  status?: number,
): ApiError {
  return new ApiError(kind, "", status, { code, params });
}

/** 上传读取阶段的提示：结构化存放，文案由界面按当前语言生成 */
export type UploadIssue =
  | { kind: "file"; file: string; error: ApiErrorKind }
  | { kind: "overflow"; kept: number; skipped: number };

/** 读取局部重绘记录时缺失的资源；文案由界面按当前语言生成 */
export type MissingResource =
  { kind: "mask" | "base" } | { kind: "reference"; name?: string };

/** 草图画板的来源：决定弹层角落里的说明文字 */
export type SketchOrigin =
  | { kind: "new" }
  /** 编辑创作条里的某张草图附件，index 从 1 起 */
  | { kind: "attachment"; index: number }
  | { kind: "history" };
