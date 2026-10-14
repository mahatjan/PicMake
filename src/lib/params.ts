/** 生成表单 ↔ API 参数映射（纯函数） */
import { validateSize, type SizeIssue } from "./size";
import type {
  Background,
  GenParams,
  ModelId,
  OutputFormat,
  PixelSize,
  Quality,
  SizeSpec,
} from "./types";

export type RatioId =
  "1:1" | "4:3" | "3:4" | "3:2" | "2:3" | "16:9" | "9:16" | "auto";

/** 预设比例（不含「自动」） */
export type PresetRatio = Exclude<RatioId, "auto">;

/** 模型显示名是品牌名，不随语言变化 */
export const MODEL_LABELS: Record<ModelId, string> = {
  flare: "Flare",
  sunburst: "Sunburst",
  gpt2: "GPT Image 2",
};

/** 比例 chip 的顺序；「auto」的显示名随语言，见 i18n/labels.ts */
export const RATIOS: ReadonlyArray<RatioId> = [
  "1:1",
  "4:3",
  "3:4",
  "3:2",
  "2:3",
  "16:9",
  "9:16",
  "auto",
];

/** 预设比例，顺序同 chip；多尺寸的图片也按这个顺序排列，与点选先后无关 */
export const PRESET_RATIOS: ReadonlyArray<PresetRatio> = RATIOS.filter(
  (id): id is PresetRatio => id !== "auto",
);

/** 多比例最多同时选几个 */
export const MAX_MULTI_RATIOS = 4;

/** 各比例的基准像素 */
export const RATIO_DIMS: Record<PresetRatio, [number, number]> = {
  "1:1": [1024, 1024],
  "4:3": [1360, 1024],
  "3:4": [1024, 1360],
  "3:2": [1536, 1024],
  "2:3": [1024, 1536],
  "16:9": [1792, 1008],
  "9:16": [1008, 1792],
};

export type BaseRes = "1k" | "2k" | "4k";

export const BASE_LABELS: ReadonlyArray<{ id: BaseRes; label: string }> = [
  { id: "1k", label: "1K" },
  { id: "2k", label: "2K" },
  { id: "4k", label: "4K" },
];

export interface GenForm {
  model: ModelId;
  prompt: string;
  ratio: RatioId;
  /** 基准分辨率：比例生效时决定实际像素（自动尺寸下无效） */
  base: BaseRes;
  cw: string;
  ch: string;
  quality: Quality;
  n: number;
  bg: Background;
  fmt: OutputFormat;
  /** 多比例（2026-10-13）：开启后由 ratios 代替 ratio，「自动」与自定义宽高不参与 */
  multi: boolean;
  /** 多比例所选的预设比例，按 chip 顺序；开启时 1–MAX_MULTI_RATIOS 个，关闭时为空 */
  ratios: PresetRatio[];
}

export const DEFAULT_FORM: GenForm = {
  model: "flare",
  prompt: "",
  ratio: "3:2",
  base: "1k",
  cw: "",
  ch: "",
  quality: "high",
  n: 1,
  bg: "auto",
  fmt: "png",
  multi: false,
  ratios: [],
};

export function isCustomActive(f: Pick<GenForm, "cw" | "ch">): boolean {
  return f.cw !== "" || f.ch !== "";
}

/** 自定义宽高是否合法（不激活时恒合法） */
export function customOk(f: Pick<GenForm, "cw" | "ch">): boolean {
  if (!isCustomActive(f)) return true;
  const w = parseDimension(f.cw);
  const h = parseDimension(f.ch);
  return w !== null && h !== null && validateSize(w, h).length === 0;
}

function parseDimension(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/** 按基准分辨率缩放 1K 基准尺寸，保持 /16 整除并夹在 3840 × 2160 内 */
function scaleDims(w: number, h: number, base: BaseRes): PixelSize {
  if (base === "1k") return { w, h };
  if (base === "2k") return { w: w * 2, h: h * 2 };
  // 4K：等比放进 3840 × 2160 的框里
  const s = Math.min(3840 / w, 2160 / h);
  const round16 = (n: number) =>
    Math.min(3840, Math.max(256, Math.round(n / 16) * 16));
  return { w: round16(w * s), h: round16(h * s) };
}

/** 预设比例 × 基准分辨率得到的像素；恒为合法尺寸，不需要再校验 */
export function ratioSize(ratio: PresetRatio, base: BaseRes): PixelSize {
  const [w, h] = RATIO_DIMS[ratio];
  return scaleDims(w, h, base);
}

/** 多比例是否真正生效：至少 2 个比例才是多尺寸，只选 1 个与普通单尺寸完全一致 */
export function isMultiSize(f: Pick<GenForm, "multi" | "ratios">): boolean {
  return f.multi && f.ratios.length >= 2;
}

/** 多尺寸的各个尺寸，按比例 chip 顺序；不是多尺寸时为 null */
export function formSizes(
  f: Pick<GenForm, "multi" | "ratios" | "base">,
): PixelSize[] | null {
  if (!isMultiSize(f)) return null;
  return PRESET_RATIOS.filter((id) => f.ratios.includes(id)).map((id) =>
    ratioSize(id, f.base),
  );
}

/** 表单 → 尺寸：多比例取第一个比例；自定义合法时优先；比例 × 基准分辨率次之；auto 交给 API */
export function formSize(
  f: Pick<GenForm, "ratio" | "base" | "cw" | "ch" | "multi" | "ratios">,
): SizeSpec {
  if (f.multi) {
    const first = PRESET_RATIOS.find((id) => f.ratios.includes(id));
    if (first) return ratioSize(first, f.base);
  }
  if (isCustomActive(f) && customOk(f)) {
    return { w: Number(f.cw), h: Number(f.ch) };
  }
  if (f.ratio === "auto") return "auto";
  return ratioSize(f.ratio, f.base);
}

export function formToParams(f: GenForm): GenParams {
  const sizes = formSizes(f);
  return {
    model: f.model,
    prompt: f.prompt,
    size: formSize(f),
    quality: f.quality,
    // 多尺寸时每个请求只出 1 张，总张数 = 比例数
    n: sizes ? 1 : f.n,
    background: f.bg,
    outputFormat: f.fmt,
    ...(sizes ? { sizes } : {}),
  };
}

/* ── 多比例：表单状态转换（返回补丁，经 patchForm 写入） ── */

/** 开关多比例。开启：当前是某个预设比例就保持选中，是「自动」或自定义宽高就改选默认比例 3:2；
 *  关闭：只保留所选比例里顺序最靠前的一个，回到单选 */
export function multiPatch(f: GenForm, on: boolean): Partial<GenForm> {
  if (on === f.multi) return {};
  if (on) {
    const keep = f.ratio !== "auto" && !isCustomActive(f);
    const ratio: PresetRatio = keep
      ? (f.ratio as PresetRatio)
      : (DEFAULT_FORM.ratio as PresetRatio);
    return { multi: true, ratios: [ratio], ratio, cw: "", ch: "" };
  }
  const first =
    PRESET_RATIOS.find((id) => f.ratios.includes(id)) ??
    (DEFAULT_FORM.ratio as PresetRatio);
  return { multi: false, ratios: [], ratio: first, cw: "", ch: "" };
}

/** 多比例下点选一个比例：已选则取消（至少保留 1 个），未选则加入（最多 MAX_MULTI_RATIOS 个）；
 *  没有变化返回 null */
export function toggleRatioPatch(
  f: Pick<GenForm, "ratios">,
  id: PresetRatio,
): Partial<GenForm> | null {
  const selected = f.ratios.includes(id);
  if (selected && f.ratios.length <= 1) return null;
  if (!selected && f.ratios.length >= MAX_MULTI_RATIOS) return null;
  const next = PRESET_RATIOS.filter((r) =>
    r === id ? !selected : f.ratios.includes(r),
  );
  return { ratios: next, ratio: next[0] };
}

/** 进入局部重绘等不支持多比例的场景：退回单选，其余表单不动 */
export function withoutMulti(f: GenForm): GenForm {
  return f.multi ? { ...f, ...multiPatch(f, false) } : f;
}

/* ── 尺寸 ↔ 预设比例 ── */

/** 预设比例 × 基准的全部像素（共 21 种，互不相同）→ 比例与基准，用于复用参数时反推 */
const PRESET_BY_SIZE = new Map<string, { ratio: PresetRatio; base: BaseRes }>(
  BASE_LABELS.flatMap(({ id: base }) =>
    PRESET_RATIOS.map((ratio) => {
      const { w, h } = ratioSize(ratio, base);
      return [`${w}x${h}`, { ratio, base }] as const;
    }),
  ),
);

/** 尺寸恰好等于某个「预设比例 × 基准」时反推出它们，否则为 null */
export function sizeToPreset(
  size: PixelSize,
): { ratio: PresetRatio; base: BaseRes } | null {
  return PRESET_BY_SIZE.get(`${size.w}x${size.h}`) ?? null;
}

/** 多尺寸记录的所选比例与基准：每个尺寸都来自同一基准的预设比例才能反推，否则为 null */
function presetsOfSizes(
  sizes: readonly PixelSize[],
): { ratios: PresetRatio[]; base: BaseRes } | null {
  const hits = sizes.map(sizeToPreset);
  const first = hits[0];
  if (!first || hits.some((hit) => !hit || hit.base !== first.base))
    return null;
  const ratios = new Set(hits.map((hit) => hit!.ratio));
  return {
    ratios: PRESET_RATIOS.filter((id) => ratios.has(id)),
    base: first.base,
  };
}

/** 比例识别的相对误差上限：实际返回的尺寸与预设比例差在 3% 内都算同一个比例 */
const RATIO_TOLERANCE = 0.03;

/** 实际宽高最接近的预设比例；都不接近时为 null。
 *  不能按最大公约数约分：1360 × 1024 约分是 85:64，而不是 4:3 */
export function nearestRatio(w: number, h: number): PresetRatio | null {
  if (!(w > 0 && h > 0)) return null;
  const actual = w / h;
  let best: PresetRatio | null = null;
  let bestError = Infinity;
  for (const id of PRESET_RATIOS) {
    const [rw, rh] = id.split(":").map(Number);
    const error = Math.abs(actual / (rw / rh) - 1);
    if (error < bestError) {
      best = id;
      bestError = error;
    }
  }
  return bestError <= RATIO_TOLERANCE ? best : null;
}

/** 提交的尺寸里没有对应图片的那些（部分失败）。先按像素精确匹配，剩下的按比例就近匹配；每张图只用一次 */
export function missingSizes(
  submitted: readonly PixelSize[],
  actual: readonly PixelSize[],
): PixelSize[] {
  const unused = [...actual];
  const take = (match: (candidate: PixelSize) => boolean) => {
    const at = unused.findIndex(match);
    if (at < 0) return false;
    unused.splice(at, 1);
    return true;
  };
  const rest = submitted.filter(
    (size) => !take((c) => c.w === size.w && c.h === size.h),
  );
  return rest.filter((size) => {
    const ratio = nearestRatio(size.w, size.h);
    return !take((c) =>
      ratio !== null
        ? nearestRatio(c.w, c.h) === ratio
        : Math.abs(c.w / c.h / (size.w / size.h) - 1) <= RATIO_TOLERANCE,
    );
  });
}

/** 复用参数：历史记录 → 表单。多尺寸记录还原多比例、所选比例与基准；
 *  单尺寸恰好是「预设比例 × 基准」时还原成比例与基准，否则把具体尺寸回填到自定义宽高 */
export function paramsToForm(p: GenParams): GenForm {
  const form: GenForm = {
    ...DEFAULT_FORM,
    model: p.model,
    prompt: p.prompt,
    quality: p.quality,
    n: p.n,
    bg: p.background,
    fmt: p.outputFormat,
  };
  if (p.sizes && p.sizes.length >= 2) {
    const presets = presetsOfSizes(p.sizes);
    if (presets)
      return {
        ...form,
        multi: true,
        ratios: presets.ratios,
        ratio: presets.ratios[0],
        base: presets.base,
      };
  }
  const size: SizeSpec = p.size;
  if (size === "auto") return { ...form, ratio: "auto" };
  const preset = sizeToPreset(size);
  if (preset) return { ...form, ratio: preset.ratio, base: preset.base };
  return { ...form, ratio: "3:2", cw: String(size.w), ch: String(size.h) };
}

/** 请求参数的问题码；界面文案见 i18n 资源 issues.* */
export type ParamIssue = "empty-prompt" | SizeIssue;

export function validateParams(p: GenParams): ParamIssue[] {
  const issues: ParamIssue[] = [];
  if (!p.prompt.trim()) issues.push("empty-prompt");
  if (p.size !== "auto") issues.push(...validateSize(p.size.w, p.size.h));
  for (const size of p.sizes ?? [])
    issues.push(...validateSize(size.w, size.h));
  return [...new Set(issues)];
}
