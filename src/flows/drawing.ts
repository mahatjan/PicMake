/** 画板流程：草图与局部重绘的入口、底图准备、确认导出与关闭确认，以及查看选区；状态只经迁移函数写入 */
import { toast } from "@heroui/react";
import { db, type ImageRow } from "../db/schema";
import { t } from "../i18n";
import { errorHint } from "../i18n/errors";
import { inpaintIssueText } from "../i18n/labels";
import { prepareInpaintBase, readImageMeta } from "../lib/image-orientation";
import {
  blankMask,
  checkInpaintBase,
  MASK_MAX_BYTES,
  validateMaskDocument,
} from "../lib/inpaint";
import { exportMaskPng } from "../lib/inpaint-canvas";
import { formSize } from "../lib/params";
import {
  blankSketch,
  freezeSketch,
  SKETCH_DEFAULT_SIZE,
  SKETCH_MAX_COMMANDS,
  sketchSnapshotKey,
  validateSketchDocument,
} from "../lib/sketch";
import { exportSketchPng } from "../lib/sketch-canvas";
import {
  MAX_INPUT_IMAGES,
  type InpaintDraft,
  type InpaintEntry,
  type InpaintIssue,
  type InputSource,
  type MaskImage,
} from "../lib/types";
import { uuid } from "../lib/uuid";
import { inputNaming, workIndexOf, type InputNaming } from "../lib/view-models";
import { canOpenDrawing, isDrawingChanged } from "../lib/workspace-rules";
import { useWorkspace } from "../store/workspace";
import {
  applyInpaintSelection,
  applySketchAttachment,
  beginInpaintOpening,
  closeDrawing,
  closeViewMask,
  openInpaint,
  openSketch,
  setConfirm,
  setDrawingConfirming,
  setDrawingError,
  setPreviewId,
  showViewMask,
} from "../store/workspace/actions";
import {
  selectDisplayRow,
  selectRows,
  selectRun,
} from "../store/workspace/selectors";
import { downloadFile } from "./export";
import { adjustInpaint, requestLeave } from "./navigation";

/** 各画板/重绘入口共用的可用判定，规则见 canOpenDrawing；await 之后要重新调用 */
function workspaceFree(): boolean {
  const state = useWorkspace.getState();
  const run = selectRun(state);
  const { draft, confirm, drawing } = state;
  return canOpenDrawing({
    run: run.phase,
    reading: draft.readId !== null,
    confirming: confirm !== null,
    drawing: drawing !== null,
  });
}

/** 异步结果回来后，确认还是打开时的那个画板；已关闭或换了会话就丢弃结果 */
const sameDrawing = (id: string) => useWorkspace.getState().drawing?.id === id;

/** 画板绘制上限提示（草图与选区共用文案） */
export function notifyDrawLimit(kind: "commands" | "points") {
  toast(
    kind === "commands"
      ? t("toast.drawLimitCommands", { max: SKETCH_MAX_COMMANDS })
      : t("toast.drawLimitPoints"),
  );
}

/* ── 草图：只产出附件，确认落回创作条，不发请求 ── */

/** 新画布 = 当前输出尺寸，auto 时 1024×1024 */
export function openSketchNew() {
  if (!workspaceFree()) return;
  const { draft } = useWorkspace.getState();
  if (
    !draft.inputs.some((input) => input.upload?.sketch) &&
    draft.inputs.length >= MAX_INPUT_IMAGES
  ) {
    toast(errorHint("too-many-images", t));
    return;
  }
  const size = formSize(draft.form);
  const [width, height] =
    size === "auto"
      ? [SKETCH_DEFAULT_SIZE, SKETCH_DEFAULT_SIZE]
      : [size.w, size.h];
  openSketch(blankSketch(width, height), { kind: "new" }, null);
}

/** 编辑草稿里已确认的草图附件：确认后原位替换 */
export function editSketchAttachment(imageId: string) {
  if (!workspaceFree()) return;
  const { inputs } = useWorkspace.getState().draft;
  const index = inputs.findIndex((input) => input.imageId === imageId);
  const raw = inputs[index]?.upload?.sketch;
  if (!raw) return;
  const doc = validateSketchDocument(raw);
  if (!doc) {
    toast(t("toast.sketchUnreadable"));
    return;
  }
  openSketch(doc, { kind: "attachment", index: index + 1 }, imageId);
}

/** 历史来源草图：以新草稿打开，不改旧记录 */
export function continueHistorySketch(imageId: string) {
  if (!workspaceFree()) return;
  setPreviewId(null);
  void (async () => {
    const row = await db.images.get(imageId);
    if (!workspaceFree()) return;
    const doc = validateSketchDocument(row?.sketch);
    if (!doc) {
      toast(t("toast.sketchSourceUnavailable"));
      return;
    }
    openSketch(doc, { kind: "history" }, null);
  })();
}

/** 保存当前草图为原尺寸白底 PNG；不修改附件或关闭画板，URL 生命周期由 hook 管理。 */
export async function downloadSketch(createUrl: (blob: Blob) => string) {
  const drawing = useWorkspace.getState().drawing;
  if (drawing?.kind !== "sketch" || drawing.confirming) return;
  const { id, doc, cursor } = drawing;
  setDrawingConfirming(true);
  try {
    const frozen = freezeSketch(doc, cursor);
    const blob = await exportSketchPng(frozen);
    if (!sameDrawing(id)) return;
    if (!blob) {
      toast(t("toast.sketchExportFailed"));
      return;
    }
    downloadFile(
      createUrl(blob),
      `PicMake-sketch-${id.slice(0, 8)}-${frozen.width}x${frozen.height}.png`,
    );
  } catch {
    if (sameDrawing(id)) toast(t("toast.sketchExportFailed"));
  } finally {
    if (sameDrawing(id)) setDrawingConfirming(false);
  }
}

/** 使用草图：导出 PNG 落成附件；失败或超过张数上限时画板保留 */
export function confirmSketch() {
  const drawing = useWorkspace.getState().drawing;
  if (drawing?.kind !== "sketch" || drawing.confirming) return;
  const { id, doc, cursor, replacesImageId, openKey } = drawing;
  setDrawingConfirming(true);
  void (async () => {
    const frozen = freezeSketch(doc, cursor);
    // 无实质修改：沿用原附件，不重复分配图片
    if (replacesImageId !== null && sketchSnapshotKey(frozen) === openKey) {
      closeDrawing(id);
      return;
    }
    const blob = await exportSketchPng(frozen);
    if (!sameDrawing(id)) return;
    if (!blob) {
      setDrawingConfirming(false);
      toast(t("toast.sketchExportFailed"));
      return;
    }
    const image: ImageRow = {
      id: uuid(),
      blob,
      width: frozen.width,
      height: frozen.height,
      format: "png",
      sketch: frozen,
    };
    // 尺寸、描述补全与展开创作条都在 applySketchAttachment 里一次完成
    const result = applySketchAttachment(image, replacesImageId, (index) =>
      t("sketch.seedPrompt", { index }),
    );
    if (!result.ok) {
      setDrawingConfirming(false);
      toast(errorHint("too-many-images", t));
      return;
    }
    closeDrawing(id);
    if (result.sizeSetTo)
      toast(
        t("toast.sizeSetToSketch", {
          w: result.sizeSetTo.w,
          h: result.sizeSetTo.h,
        }),
      );
  })();
}

/** 关闭草图：有修改先确认；确认过程中忽略。是否有修改此时才计算（要序列化全部笔画） */
export function requestCloseSketch() {
  const drawing = useWorkspace.getState().drawing;
  if (drawing?.kind !== "sketch" || drawing.confirming) return;
  if (isDrawingChanged(drawing)) {
    setConfirm({
      title: t("confirm.sketch.title"),
      desc: t("confirm.sketch.desc"),
      okLabel: t("confirm.sketch.ok"),
      cancelLabel: t("confirm.sketch.cancel"),
      onOk: () => closeDrawing(drawing.id),
    });
    return;
  }
  closeDrawing(drawing.id);
}

/* ── 局部重绘：弹层涂选只产出草稿附件，确认回创作条，不发请求 ── */

interface OpenInpaintParams {
  blob: Blob;
  /** 用户文件名（有才传）：归一化时写进保留的原文件来源 */
  name?: string;
  /** 画板标题与 alt 用的名字种类 */
  naming: InputNaming;
  entry: InpaintEntry;
  /** 已在库中的来源身份：归一化时原文件引用它而非新建行 */
  existing?: InputSource;
  /** draft-input 入口被涂选的原输入 id（确认后重排为图1） */
  chosenInputId?: string;
  /** 重开已确认选区：实际底图与已保存 mask 资源 */
  reedit?: {
    base: ImageRow;
    mask: MaskImage;
    original?: InpaintDraft["original"];
  };
}

/** 打开局部重绘：先占住画板槽位，再异步准备底图；准备期间被关闭则丢弃结果，不合格就关闭并提示 */
async function openInpaintSession(params: OpenInpaintParams) {
  const id = beginInpaintOpening();
  if (!id) return;
  const fail = (issue: InpaintIssue) => {
    if (!sameDrawing(id)) return;
    closeDrawing(id);
    toast(inpaintIssueText(issue, t));
  };
  const chosenInputId = params.chosenInputId ?? null;

  // 先读头拦截超像素/超比例，再准备素材
  let meta;
  try {
    meta = await readImageMeta(params.blob);
  } catch {
    return fail("canvas-failed");
  }
  if (!sameDrawing(id)) return;
  if ("issue" in meta) return fail(meta.issue);
  const pre = checkInpaintBase(meta.width, meta.height);
  if (!pre.ok) return fail(pre.issue);

  if (params.reedit) {
    // 重开：底图已归一，直接验证文档绑定
    const { base, original } = params.reedit;
    const check = checkInpaintBase(base.width, base.height);
    if (!check.ok) return fail(check.issue);
    const validated = validateMaskDocument(params.reedit.mask.mask);
    if ("issue" in validated) return fail(validated.issue);
    openInpaint(id, {
      entry: "reedit",
      base,
      original,
      normalized: false,
      doc: structuredClone(validated.doc),
      naming: params.naming,
      chosenInputId,
    });
    return;
  }

  const prepared = await prepareInpaintBase(params.blob, params.name, meta);
  if (!sameDrawing(id)) return;
  if (!prepared.ok) return fail(prepared.issue);
  const base = prepared.base;
  // 解码后复核：头尺寸与真实尺寸可能不同
  const recheck = checkInpaintBase(base.width, base.height);
  if (!recheck.ok) return fail(recheck.issue);
  const original = prepared.original
    ? params.existing
      ? { source: params.existing, image: prepared.original.image }
      : prepared.original
    : undefined;
  openInpaint(id, {
    entry: params.entry,
    base,
    original,
    normalized: !!original,
    doc: blankMask(base.id, base.width, base.height),
    naming: params.naming,
    chosenInputId,
  });
}

/** 对展示记录的某一张结果发起；打开前经放弃确认 */
export function startInpaintFromResult(imageId: string) {
  // 请求时确定来源记录：确认框和读取之后不再重新推断
  const row = selectDisplayRow(useWorkspace.getState());
  if (!workspaceFree() || !row) return;
  requestLeave(() => {
    void (async () => {
      const image = await db.images.get(imageId);
      if (!workspaceFree()) return;
      if (!image) {
        toast(errorHint("source-unavailable", t));
        return;
      }
      await openInpaintSession({
        blob: image.blob,
        naming: {
          kind: "work",
          workIndex: workIndexOf([row], row.id, imageId),
        },
        entry: "result",
        existing: { imageId, generationId: row.id },
      });
    })();
  }, true);
}

/** 对草稿中的普通图发起；确认后重排为图1（✎ 按钮已保证草图走画板） */
export function startInpaintFromInput(imageId: string) {
  if (!workspaceFree()) return;
  const input = useWorkspace
    .getState()
    .draft.inputs.find((item) => item.imageId === imageId);
  if (!input) return;
  void (async () => {
    const row = input.upload ?? (await db.images.get(imageId));
    if (!workspaceFree()) return;
    if (!row) {
      toast(errorHint("source-unavailable", t));
      return;
    }
    await openInpaintSession({
      blob: row.blob,
      name: input.name,
      naming: inputNaming(input, {
        sketch: false,
        base: false,
        workIndex: workIndexOf(
          selectRows(useWorkspace.getState()),
          input.generationId,
          imageId,
        ),
      }),
      entry: "draft-input",
      existing: input.generationId
        ? { imageId, generationId: input.generationId }
        : { imageId },
      chosenInputId: imageId,
    });
  })();
}

/** 重开已确认选区：底图缩略图 ✎（选区存在时 inputs[0] 恒为绑定底图） */
export function editMask() {
  const { draft } = useWorkspace.getState();
  const confirmed = draft.inpaint;
  const baseInput = draft.inputs[0];
  if (!workspaceFree() || !confirmed || !baseInput) return;
  void (async () => {
    const base = baseInput.upload ?? (await db.images.get(baseInput.imageId));
    if (!workspaceFree()) return;
    if (!base) {
      toast(errorHint("source-unavailable", t));
      return;
    }
    await openInpaintSession({
      blob: base.blob,
      name: baseInput.name,
      naming: { kind: "base" },
      entry: "reedit",
      existing: { imageId: base.id },
      reedit: {
        base,
        mask: confirmed.mask,
        ...(confirmed.original ? { original: confirmed.original } : {}),
      },
    });
  })();
}

/** 使用选区：导出 + 校验，成功才替换草稿；空选区、导出失败、过大就地报错，工作内容保留 */
export function confirmInpaint() {
  const drawing = useWorkspace.getState().drawing;
  if (drawing?.kind !== "inpaint" || drawing.confirming) return;
  const { id, doc, cursor, base, original, entry, chosenInputId } = drawing;
  setDrawingConfirming(true);
  void (async () => {
    const frozen = freezeSketch(doc, cursor);
    const result = await exportMaskPng(frozen);
    if (!sameDrawing(id)) return;
    if (result.issue === "empty-mask") {
      setDrawingError("empty-mask");
      return;
    }
    if (!result.blob) {
      setDrawingError("canvas-failed");
      return;
    }
    if (result.blob.size >= MASK_MAX_BYTES) {
      setDrawingError("mask-too-large");
      return;
    }
    const mask: MaskImage = {
      id: uuid(),
      blob: result.blob,
      width: frozen.width,
      height: frozen.height,
      format: "png",
      mask: frozen,
    };
    const { reordered } = applyInpaintSelection({
      base,
      mask,
      original,
      entry,
      chosenInputId,
    });
    closeDrawing(id);
    toast(
      entry === "reedit"
        ? t("toast.maskUpdated")
        : reordered
          ? t("toast.maskBaseReordered")
          : t("toast.maskApplied"),
    );
  })();
}

/** 关闭局部重绘：有修改先确认；确认过程中忽略 */
export function requestCloseInpaint() {
  const drawing = useWorkspace.getState().drawing;
  if (drawing?.kind !== "inpaint" || drawing.confirming) return;
  if (isDrawingChanged(drawing)) {
    setConfirm({
      title: t("confirm.mask.title"),
      desc: t("confirm.mask.desc"),
      okLabel: t("confirm.mask.ok"),
      cancelLabel: t("confirm.mask.cancel"),
      onOk: () => closeDrawing(drawing.id),
    });
    return;
  }
  closeDrawing(drawing.id);
}

/* ── 查看选区（只读），可发起「调整上次重绘」 ── */

export function openViewMask() {
  const row = selectDisplayRow(useWorkspace.getState());
  const inpaint = row?.inpaint;
  if (!row || !inpaint) return;
  void (async () => {
    const maskRow = await db.images.get(inpaint.maskImageId);
    const baseRow = maskRow?.mask
      ? await db.images.get(maskRow.mask.baseImageId)
      : null;
    if (!maskRow?.mask || !baseRow) {
      toast(inpaintIssueText("invalid-mask", t));
      return;
    }
    showViewMask({
      base: baseRow,
      commands: maskRow.mask.commands,
      rowId: row.id,
    });
  })();
}

export function adjustFromViewMask() {
  const viewMask = useWorkspace.getState().view.viewMask;
  if (!viewMask) return;
  closeViewMask();
  adjustInpaint(viewMask.rowId);
}
