/** 把 lib 返回的码、种类与结构化数据变成当前语言的文案（纯函数，t 由调用方传入；组件须用 useTranslation 的 t，
 *  这样切换语言会重渲染）。lib 本身不产出任何界面文字。 */
import type { TFunction } from "i18next";
import type { SizeReason } from "../lib/inpaint";
import {
  BASE_LABELS,
  PRESET_RATIOS,
  isCustomActive,
  isMultiSize,
  nearestRatio,
  sizeToPreset,
  type BaseRes,
  type GenForm,
} from "../lib/params";
import type { RatioId } from "../lib/params";
import { SIZE_LIMITS } from "../lib/size";
import type {
  InpaintIssue,
  MissingResource,
  ModelId,
  PixelSize,
  SizeSpec,
  SketchOrigin,
  UploadIssue,
} from "../lib/types";
import type { InputNaming } from "../lib/view-models";
import type { DraftIssue } from "../lib/workspace-rules";
import { errorHint } from "./errors";

/** 展示用尺寸文本，如 "1536 × 1024" / "自动" */
export const sizeText = (size: SizeSpec, t: TFunction): string =>
  size === "auto" ? t("common.auto") : `${size.w} × ${size.h}`;

type SizeForm = Pick<
  GenForm,
  "ratio" | "base" | "cw" | "ch" | "multi" | "ratios"
>;

const baseLabel = (base: BaseRes): string =>
  BASE_LABELS.find((b) => b.id === base)?.label ?? base.toUpperCase();

/** 单尺寸的文本：自定义宽高 / 比例·基准 / 自动。多比例只选了 1 个比例时与单选显示相同 */
function singleSizeText(f: SizeForm, t: TFunction): string {
  if (f.multi && f.ratios[0]) return `${f.ratios[0]} · ${baseLabel(f.base)}`;
  if (isCustomActive(f)) return `${f.cw}×${f.ch}`;
  if (f.ratio === "auto") return t("common.auto");
  return `${f.ratio} · ${baseLabel(f.base)}`;
}

/** 比例 chip 上的尺寸值文本：自定义宽高 / 比例·基准 / 自动；多尺寸显示「N 个比例 · 基准」 */
export function sizeChipValue(f: SizeForm, t: TFunction): string {
  if (isMultiSize(f))
    return t("params.sizeChipMulti", {
      count: f.ratios.length,
      base: baseLabel(f.base),
    });
  return singleSizeText(f, t);
}

/** 创作条 mini 摘要里的尺寸：多尺寸列出全部比例（如「1:1/16:9/9:16 · 2K」），不展开也能读出全部配置 */
export function sizeSummary(f: SizeForm, t: TFunction): string {
  if (isMultiSize(f))
    return `${PRESET_RATIOS.filter((id) => f.ratios.includes(id)).join("/")} · ${baseLabel(f.base)}`;
  return singleSizeText(f, t);
}

/** 比例名：像素恰好是「预设比例 × 基准」或接近某个预设比例时用预设名（如 "16:9"），认不出时用像素。
 *  比例与像素都是参数值，不随语言变化 */
export function ratioOrSize(size: PixelSize): string {
  return (
    sizeToPreset(size)?.ratio ??
    nearestRatio(size.w, size.h) ??
    `${size.w} × ${size.h}`
  );
}

/** 多尺寸每张图下的标注，如「16:9 · 1792 × 1008」；比例认不出时只有像素 */
export function sizeCaption(size: PixelSize): string {
  const ratio = sizeToPreset(size)?.ratio ?? nearestRatio(size.w, size.h);
  return ratio ? `${ratio} · ${size.w} × ${size.h}` : `${size.w} × ${size.h}`;
}

export const ratioLabel = (id: RatioId, t: TFunction): string =>
  id === "auto" ? t("common.auto") : id;

/** 模型 chip 值后面的短标签：2.5 的两个变体按速度/画质定位，无此定位的模型不显示 */
const MODEL_SUFFIX: Record<ModelId, "modelFast" | "modelDetailed" | null> = {
  flare: "modelFast",
  sunburst: "modelDetailed",
  gpt2: null,
};

export const modelSuffix = (model: ModelId, t: TFunction): string | null => {
  const key = MODEL_SUFFIX[model];
  return key ? t(`params.${key}`) : null;
};

/** 提交前校验提示（描述为空、尺寸问题等） */
export const issueText = (issue: DraftIssue, t: TFunction): string =>
  t(`issues.${issue}`, { long: SIZE_LIMITS.long, short: SIZE_LIMITS.short });

export const inpaintIssueText = (issue: InpaintIssue, t: TFunction): string =>
  t(`inpaint.issue.${issue}`);

/** 重绘输出尺寸与原图不同的原因 */
export function sizeReasonText(reason: SizeReason, t: TFunction): string {
  const parts: string[] = [];
  if (reason.floor === "w") parts.push(t("inpaint.reason.floorWidth"));
  if (reason.floor === "h") parts.push(t("inpaint.reason.floorHeight"));
  if (reason.floor === "both") parts.push(t("inpaint.reason.floorBoth"));
  if (reason.scaled) parts.push(t("inpaint.reason.scaled"));
  return parts.join(t("inpaint.reason.separator")) || t("inpaint.reason.exact");
}

/** 上传读取阶段的一条提示 */
export function uploadIssueText(issue: UploadIssue, t: TFunction): string {
  if (issue.kind === "file")
    return t("input.uploadFile", {
      file: issue.file,
      reason: errorHint(issue.error, t),
    });
  return t("input.overflow", {
    limit: errorHint("too-many-images", t),
    kept: issue.kept,
    skipped: issue.skipped,
  });
}

/** 输入来源的名字（用户文件名原样，系统来源按当前语言） */
export function inputName(naming: InputNaming, t: TFunction): string {
  switch (naming.kind) {
    case "file":
      return naming.fileName;
    case "sketch":
      return t("input.sketch");
    case "base":
      return t("input.base");
    case "work":
      return naming.workIndex
        ? t("input.workIndexed", { index: naming.workIndex })
        : t("input.work");
  }
}

/** 「图N」；index 从 0 起 */
export const inputNumber = (index: number, t: TFunction): string =>
  t("input.number", { index: index + 1 });

/** 「图N · 名字」 */
export const inputLabel = (
  naming: InputNaming,
  index: number,
  t: TFunction,
): string =>
  t("input.label", {
    number: inputNumber(index, t),
    name: inputName(naming, t),
  });

/** 草图弹层角落的说明：尺寸 + 来源 */
export function sketchMeta(
  size: { width: number; height: number },
  origin: SketchOrigin,
  t: TFunction,
): string {
  const params = { w: size.width, h: size.height };
  if (origin.kind === "attachment")
    return t("sketch.metaAttachment", { ...params, index: origin.index });
  if (origin.kind === "history") return t("sketch.metaHistory", params);
  return t("sketch.meta", params);
}

/** 读取记录时缺失的资源名，嵌入「不可用」类提示 */
export function missingText(missing: MissingResource, t: TFunction): string {
  if (missing.kind === "reference")
    return missing.name
      ? t("missing.referenceNamed", { name: missing.name })
      : t("missing.reference");
  return missing.kind === "mask" ? t("missing.mask") : t("missing.base");
}
