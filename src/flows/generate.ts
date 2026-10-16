/** 生成流程：草稿校验、请求、partial 预览、写库与各种结束方式；状态只经迁移函数写入 */
import { toast } from "@heroui/react";
import { requestImages } from "../api/client";
import { db, type HistoryRow } from "../db/schema";
import { saveGeneration } from "../db/history";
import { t } from "../i18n";
import { errorMessage, errorTitle, kindMessage } from "../i18n/errors";
import { issueText, missingText, ratioOrSize } from "../i18n/labels";
import { b64Format, b64ToBlob } from "../lib/blob";
import {
  prepareGeneration,
  prepareMultiGeneration,
  type GeneratedSlot,
  type PreparedGeneration,
} from "../lib/generation";
import { readImageMeta } from "../lib/image-orientation";
import { inpaintTargetSize } from "../lib/inpaint";
import {
  ApiError,
  clientError,
  type ApiErrorKind,
  type ApiConfig,
  type EditDraft,
  type EditSubmission,
  type GenParams,
  type InputImage,
  type MaskImage,
  type MissingResource,
  type PixelSize,
} from "../lib/types";
import { draftToParams, leaveDecision } from "../lib/workspace-rules";
import { useSettings } from "../store/settings";
import { useWorkspace } from "../store/workspace";
import { findRow } from "../store/workspace/selectors";
import {
  beginRun,
  beginSave,
  discardUnsaved,
  endRun,
  finishSave,
  markUnsaved,
  requestPromptFocus,
  setConfirm,
  setLastDoneId,
  setPartial,
  setSlotDone,
  setSlotFailed,
  setSlotPartial,
} from "../store/workspace/actions";

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

/** 错误反馈统一走 toast：标题 + 服务端信息或建议 */
export function toastError(error: unknown) {
  toast(errorMessage(error, t));
}

/** 进行中请求的取消句柄：同一时间最多一个（由 beginRun 保证）；多尺寸时所有请求共用它 */
let abort: AbortController | null = null;

export const cancelGenerate = () => abort?.abort();

/** 提交当前草稿；生成中、保存中忽略，有未保存结果时先确认放弃 */
export function generate() {
  const { run, draft } = useWorkspace.getState();
  // 草稿正是要提交的内容，不算被丢弃的修改（userWork = false）；会被替换的只有内存里的未保存结果
  const decision = leaveDecision({
    run: run.phase,
    userWork: false,
    usesDisplayed: false,
  });
  if (decision === "blocked") return;
  const checked = draftToParams({
    form: draft.form,
    inpaint: draft.inpaint,
    sizeAccepted: draft.sizeAccepted,
    reading: draft.readId !== null,
  });
  // 目标尺寸未接受时不发生成请求
  if (!checked.ok && checked.reason === "size-not-accepted") {
    if (checked.issue) toast(issueText(checked.issue, t));
    return;
  }
  setLastDoneId(null);
  if (!checked.ok) {
    if (checked.issue) toast(issueText(checked.issue, t));
    if (checked.focusPrompt) requestPromptFocus();
    return;
  }
  // 提交的内容在请求时确定，确认之后不再重新读草稿
  const params = checked.params;
  const edit = draft.inputs.length
    ? {
        inputs: draft.inputs,
        inputFidelity: draft.inputFidelity,
        ...(draft.inpaint ? { inpaint: draft.inpaint } : {}),
      }
    : null;
  if (decision === "confirm-unsaved") {
    setConfirm({
      title: t("confirm.unsavedGenerate.title"),
      desc: t("confirm.unsavedGenerate.desc"),
      onOk: () => {
        // 确认期间状态可能已变：不再是未保存结果时不重复发起
        if (useWorkspace.getState().run.phase !== "unsaved") return;
        discardUnsaved();
        void runGeneration(params, edit);
      },
    });
    return;
  }
  void runGeneration(params, edit);
}

/** 再来一版：用记录的参数与输入源直接重发；局部重绘记录复用同一底图与 mask（仅 complete 态可达） */
export function regenerate(id: string) {
  const row = findRow(useWorkspace.getState(), id);
  if (!row) return;
  setLastDoneId(null);
  if (row.inpaint) {
    void regenerateInpaint(row);
    return;
  }
  const draft: EditDraft | null = row.inputSources?.length
    ? {
        inputs: row.inputSources.map((source) => ({
          imageId: source.imageId,
          generationId: source.generationId,
        })),
        inputFidelity: row.inputFidelity ?? "auto",
      }
    : null;
  void runGeneration({ ...row.params }, draft);
}

/** 尺寸按当前约束重算，恒合法 */
async function regenerateInpaint(row: HistoryRow) {
  const read = await readInpaintDraft(row);
  if (!read.ok) {
    toast(t("toast.cantRegenerate", { what: missingText(read.missing, t) }));
    return;
  }
  await runGeneration(read.params, read.draft);
}

/** 写库并展示结果；保存失败时结果留在内存（可查看、下载）。返回是否保存成功 */
async function persist(prepared: PreparedGeneration): Promise<boolean> {
  beginSave(prepared);
  try {
    await saveGeneration(prepared);
  } catch {
    markUnsaved();
    toast(kindMessage("save-failed", t));
    return false;
  }
  finishSave(prepared);
  return true;
}

/** 一次完整生成：占位 → 读来源 → 请求 → 写库；准备阶段已处于 generating，可以取消。
 *  params.sizes 存在时每个尺寸各发一个请求（多尺寸），见 generateMulti */
async function runGeneration(params: GenParams, draft: EditDraft | null) {
  if (
    !beginRun({
      n: params.n,
      size: params.size,
      ...(params.sizes ? { sizes: params.sizes } : {}),
    })
  )
    return;
  // 配置在开始时读一次，不订阅 settings
  const { baseUrl, apiKey, streamEnabled } = useSettings.getState();
  const config = { baseUrl, apiKey, streamEnabled };
  const controller = new AbortController();
  abort = controller;
  try {
    const originPrompt = draft
      ? await resolveOriginPrompt(draft.inputs)
      : undefined;
    controller.signal.throwIfAborted();
    const startedAt = Date.now();
    const edit = draft
      ? await loadEditSubmission(draft, controller.signal)
      : undefined;
    if (params.sizes) {
      await generateMulti({
        params,
        sizes: params.sizes,
        edit,
        startedAt,
        originPrompt,
        config,
        signal: controller.signal,
      });
      return;
    }
    const result = await requestImages(
      params,
      config,
      {
        signal: controller.signal,
        onPartial: (b64, index) => setPartial(b64ToBlob(b64), index),
      },
      edit,
    );
    controller.signal.throwIfAborted();
    const prepared = prepareGeneration(
      params,
      result,
      edit,
      startedAt,
      undefined,
      originPrompt,
    );
    if (await persist(prepared)) toast(t("toast.generated"));
  } catch (caught) {
    endRun();
    if (isAbortError(caught)) {
      toast(t("toast.cancelled"));
      return;
    }
    toastError(caught);
  } finally {
    if (abort === controller) abort = null;
  }
}

/** 多尺寸里一个请求的结局 */
type SlotOutcome =
  | ({ status: "done" } & GeneratedSlot)
  | { status: "failed"; size: PixelSize; error: unknown }
  | { status: "aborted" };

/** 图片的实际宽高：读容器头，读不到就用请求的尺寸 */
async function actualSize(
  blob: Blob,
  requested: PixelSize,
): Promise<PixelSize> {
  try {
    const meta = await readImageMeta(blob);
    if (!("issue" in meta)) return { w: meta.width, h: meta.height };
  } catch {
    /* 读不到头：回退请求尺寸 */
  }
  return requested;
}

/** 失败请求的错误种类，舞台上显示它的标题 */
const errorKind = (error: unknown): ApiErrorKind =>
  error instanceof ApiError ? error.kind : "unknown";

/** 多尺寸：每个尺寸各发一个请求（n = 1），同时发出、互不影响，不自动重试。
 *  全部结束后，成功的按比例顺序合并为一条记录，失败的不入库；取消时已完成的照常保存 */
async function generateMulti(job: {
  params: GenParams;
  sizes: PixelSize[];
  edit: EditSubmission | undefined;
  startedAt: number;
  originPrompt: string | undefined;
  config: ApiConfig;
  signal: AbortSignal;
}) {
  const { params, sizes, edit, signal } = job;
  const requestOne = async (
    index: number,
    size: PixelSize,
  ): Promise<SlotOutcome> => {
    try {
      const result = await requestImages(
        { ...params, size, n: 1, sizes: undefined },
        job.config,
        { signal, onPartial: (b64) => setSlotPartial(index, b64ToBlob(b64)) },
        edit,
      );
      // 每个请求 n = 1：只取第一张
      const b64 = result.images[0];
      const format = b64Format(b64) ?? params.outputFormat;
      const blob = b64ToBlob(b64, `image/${format}`);
      const actual = await actualSize(blob, size);
      setSlotDone(index, blob);
      return {
        status: "done",
        blob,
        format,
        width: actual.w,
        height: actual.h,
        usage: result.usage,
      };
    } catch (error) {
      // 取消不算失败
      if (signal.aborted || isAbortError(error)) return { status: "aborted" };
      setSlotFailed(index, errorKind(error));
      return { status: "failed", size, error };
    }
  };

  const outcomes = await Promise.all(
    sizes.map((size, index) => requestOne(index, size)),
  );
  const done = outcomes.filter(
    (outcome): outcome is Extract<SlotOutcome, { status: "done" }> =>
      outcome.status === "done",
  );
  const failed = outcomes.filter(
    (outcome): outcome is Extract<SlotOutcome, { status: "failed" }> =>
      outcome.status === "failed",
  );

  if (!done.length) {
    // 一张都没完成：取消同单尺寸取消；否则同单尺寸失败，提示第一个失败比例的错误，草稿保留
    endRun();
    if (signal.aborted || !failed.length) toast(t("toast.cancelled"));
    else toastError(failed[0].error);
    return;
  }

  const prepared = prepareMultiGeneration(
    params,
    done,
    edit,
    job.startedAt,
    undefined,
    job.originPrompt,
  );
  if (!(await persist(prepared))) return;
  if (signal.aborted) {
    toast(t("toast.cancelledSaved", { count: done.length }));
  } else if (failed.length) {
    toast(t("toast.partialTitle", { done: done.length, total: sizes.length }), {
      description: failed
        .map((item) =>
          t("toast.partialItem", {
            ratio: ratioOrSize(item.size),
            reason: errorTitle(errorKind(item.error), t),
          }),
        )
        .join(t("toast.partialSeparator")),
      timeout: PARTIAL_TOAST_MS,
    });
  } else {
    toast(t("toast.generated"));
  }
}

/** 部分失败的提示要逐条读，比默认的 4 秒停留更久 */
const PARTIAL_TOAST_MS = 9000;

/** 取首个输入源的原始描述（沿链路取最初；局部重绘 inputs[0] 恒为底图） */
async function resolveOriginPrompt(
  inputs: Array<{ generationId?: string }>,
): Promise<string | undefined> {
  const sourceId = inputs.find((input) => input.generationId)?.generationId;
  if (!sourceId) return undefined;
  const source = await db.history.get(sourceId);
  return source ? (source.originPrompt ?? source.prompt) : undefined;
}

/** 编辑类生成的输入：来源可能来自历史，读取失败（已被删除）是唯一需要拦截的情形 */
async function loadEditSubmission(
  draft: EditDraft,
  signal: AbortSignal,
): Promise<EditSubmission> {
  const sources = await Promise.all(
    draft.inputs.map(async (input, index) => {
      const image = input.upload ?? (await db.images.get(input.imageId));
      if (!image)
        throw clientError("source-unavailable", "source-missing", {
          index: index + 1,
        });
      const { upload: _upload, ...source } = input;
      return { source, image };
    }),
  );
  signal.throwIfAborted();
  const inpaint = draft.inpaint;
  return {
    sources,
    inputFidelity: draft.inputFidelity,
    ...(inpaint
      ? {
          inpaint: {
            maskImage: inpaint.mask,
            ...(inpaint.original
              ? {
                  original: {
                    source: { ...inpaint.original.source },
                    image: inpaint.original.image,
                  },
                }
              : {}),
          },
        }
      : {}),
  };
}

/** 读取局部重绘记录资源：底图、参考图、mask；原文件缺失可省略，其余阻断 */
export async function readInpaintDraft(
  row: HistoryRow,
): Promise<
  | { ok: true; draft: EditDraft; mask: MaskImage; params: GenParams }
  | { ok: false; missing: MissingResource }
> {
  const inp = row.inpaint;
  const sources = row.inputSources ?? [];
  if (!inp || !sources.length) return { ok: false, missing: { kind: "mask" } };
  const maskRow = await db.images.get(inp.maskImageId);
  if (!maskRow?.mask) return { ok: false, missing: { kind: "mask" } };
  const baseRow = await db.images.get(maskRow.mask.baseImageId);
  if (!baseRow) return { ok: false, missing: { kind: "base" } };
  const inputs: InputImage[] = [
    {
      imageId: baseRow.id,
      generationId: sources[0]?.generationId,
      name: sources[0]?.name,
      upload: baseRow,
    },
  ];
  for (const source of sources.slice(1)) {
    if (source.imageId === baseRow.id) continue;
    const image = await db.images.get(source.imageId);
    if (!image)
      return {
        ok: false,
        missing: { kind: "reference", name: source.name },
      };
    inputs.push({
      imageId: source.imageId,
      generationId: source.generationId,
      name: source.name,
      upload: image,
    });
  }
  const draft: EditDraft = {
    inputs,
    inputFidelity: row.inputFidelity ?? "auto",
    inpaint: { mask: maskRow as MaskImage },
  };
  // 目标尺寸按当前约束复核
  const target = inpaintTargetSize(baseRow.width, baseRow.height);
  if (!target) return { ok: false, missing: { kind: "base" } };
  const params: GenParams = {
    ...row.params,
    size: { w: target.w, h: target.h },
  };
  return { ok: true, draft, mask: maskRow as MaskImage, params };
}
