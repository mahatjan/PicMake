import { b64Format, b64ToBlob } from "./blob";
import type { EditSubmission, GenParams, ImageRequestResult } from "./types";
import type { HistoryRow, ImageRow } from "../db/schema";
import { uuid } from "./uuid";

export interface PreparedGeneration {
  row: HistoryRow;
  images: ImageRow[];
  /** 保存所需资源（底图、参考图、mask、原文件）；mask/原文件不显示为图N */
  sources: ImageRow[];
}

/** 一次提交的结果装配成历史行与资源：单尺寸与多尺寸共用 */
function assemble(input: {
  params: GenParams;
  images: ImageRow[];
  usage: HistoryRow["usage"];
  usages?: HistoryRow["usages"];
  edit: EditSubmission | undefined;
  startedAt: number;
  id: () => string;
  originPrompt?: string;
}): PreparedGeneration {
  const { params, images, edit, id, originPrompt } = input;
  const row: HistoryRow = {
    id: id(),
    prompt: params.prompt,
    params,
    usage: input.usage,
    ...(input.usages ? { usages: input.usages } : {}),
    ...(edit
      ? {
          inputSources: edit.sources.map(({ source }) => ({ ...source })),
          inputFidelity: edit.inputFidelity,
        }
      : {}),
    ...(edit?.inpaint
      ? {
          inpaint: {
            maskImageId: edit.inpaint.maskImage.id,
            ...(edit.inpaint.original
              ? { originalSource: { ...edit.inpaint.original.source } }
              : {}),
          },
        }
      : {}),
    ...(originPrompt ? { originPrompt } : {}),
    imageIds: images.map((image) => image.id),
    createdAt: Date.now(),
    durationMs: Math.max(0, Date.now() - input.startedAt),
  };
  const sources: ImageRow[] = [
    ...(edit?.sources.map(({ image }) => image) ?? []),
    // mask 与原文件不进入 inputSources
    ...(edit?.inpaint
      ? [
          edit.inpaint.maskImage,
          ...(edit.inpaint.original ? [edit.inpaint.original.image] : []),
        ]
      : []),
  ];
  return { row, images, sources };
}

export function prepareGeneration(
  params: GenParams,
  result: ImageRequestResult,
  edit: EditSubmission | undefined,
  startedAt: number,
  id: () => string = uuid,
  /** 编辑/参考生成时的原始描述 */
  originPrompt?: string,
): PreparedGeneration {
  const images = result.images.map((b64) => {
    const format = b64Format(b64) ?? params.outputFormat;
    return {
      id: id(),
      blob: b64ToBlob(b64, `image/${format}`),
      width: params.size === "auto" ? 0 : params.size.w,
      height: params.size === "auto" ? 0 : params.size.h,
      format,
    };
  });
  return assemble({
    params,
    images,
    usage: result.usage,
    edit,
    startedAt,
    id,
    originPrompt,
  });
}

/** 多尺寸里一个已完成的请求（n = 1，所以是一张图） */
export interface GeneratedSlot {
  blob: Blob;
  /** 图片的实际格式 */
  format: string;
  /** 图片的实际宽高；读不到时由调用方回退为该请求的尺寸 */
  width: number;
  height: number;
  /** 该请求自己的原始 usage */
  usage: ImageRequestResult["usage"];
}

/** 多尺寸：成功的请求按比例顺序合并为一条记录，失败的比例不入库。
 *  params 是提交时的参数（含全部 sizes）；usage 按请求分别保存在 usages，顺序与 imageIds 一致 */
export function prepareMultiGeneration(
  params: GenParams,
  slots: readonly GeneratedSlot[],
  edit: EditSubmission | undefined,
  startedAt: number,
  id: () => string = uuid,
  originPrompt?: string,
): PreparedGeneration {
  const images = slots.map((slot) => ({
    id: id(),
    blob: slot.blob,
    width: slot.width,
    height: slot.height,
    format: slot.format,
  }));
  return assemble({
    params,
    images,
    usage: null,
    usages: slots.map((slot) => slot.usage),
    edit,
    startedAt,
    id,
    originPrompt,
  });
}
