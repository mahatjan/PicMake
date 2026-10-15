/** 画板迁移函数：草图与局部重绘的会话、笔画、游标、确认 */
import type { ImageRow } from "../../../db/schema";
import { commitCommand, sketchSnapshotKey } from "../../../lib/sketch";
import { uuid } from "../../../lib/uuid";
import {
  type InpaintDraft,
  type InpaintEntry,
  type InpaintIssue,
  type MaskCommand,
  type MaskDocument,
  type SketchCommand,
  type SketchDocument,
  type SketchOrigin,
} from "../../../lib/types";
import type { InputNaming } from "../../../lib/view-models";
import { useWorkspace, type WorkspaceState } from "../index";
import { set, freshDraft, withInpaint, type InpaintPayload } from "./internal";

/** 打开草图画板：新建、编辑附件（replacesImageId）或继续历史草图；已有画板时忽略并返回 false */
export function openSketch(
  doc: SketchDocument,
  origin: SketchOrigin,
  replacesImageId: string | null,
): boolean {
  if (useWorkspace.getState().drawing) return false;
  set({
    drawing: {
      kind: "sketch",
      id: uuid(),
      doc,
      cursor: doc.commands.length,
      replacesImageId,
      origin,
      openKey: sketchSnapshotKey(doc),
      confirming: false,
    },
  });
  return true;
}

/** 开始准备局部重绘底图：返回会话 id；已有画板时返回 null */
export function beginInpaintOpening(): string | null {
  if (useWorkspace.getState().drawing) return null;
  const id = uuid();
  set({ drawing: { kind: "opening", id } });
  return id;
}

/** 底图准备完成：只在同一个 opening 会话仍在时生效（期间被关闭则忽略），返回是否已打开 */
export function openInpaint(
  id: string,
  session: {
    entry: InpaintEntry;
    base: ImageRow;
    original?: InpaintDraft["original"];
    normalized: boolean;
    doc: MaskDocument;
    naming: InputNaming;
    chosenInputId: string | null;
  },
): boolean {
  const current = useWorkspace.getState().drawing;
  if (current?.kind !== "opening" || current.id !== id) return false;
  set({
    drawing: {
      kind: "inpaint",
      id,
      ...session,
      cursor: session.doc.commands.length,
      openKey: sketchSnapshotKey(session.doc),
      confirming: false,
      error: null,
    },
  });
  return true;
}

/** 形状命令只属于草图：局部重绘的文档与提交入口都不接受它 */
function isMaskCommand(
  command: SketchCommand | MaskCommand,
): command is MaskCommand {
  return command.type !== "shape";
}

/** 提交一条命令：丢弃重做分支，超过上限静默拒绝；重绘同时清除就地错误。
 *  两个入口分开命名，形状命令在类型上就传不进局部重绘 */
function commitDrawing(command: SketchCommand | MaskCommand) {
  return (s: WorkspaceState) => {
    const d = s.drawing;
    if (d?.kind === "sketch") {
      const next = commitCommand(d.doc, d.cursor, command);
      return next ? { drawing: { ...d, ...next } } : s;
    }
    if (d?.kind === "inpaint" && isMaskCommand(command)) {
      const next = commitCommand(d.doc, d.cursor, command);
      return { drawing: { ...d, ...next, error: null } };
    }
    return s;
  };
}

/** 草图画板：笔触、形状或清空 */
export const strokeSketch = (command: SketchCommand) =>
  set(commitDrawing(command));

/** 局部重绘画板：只有笔触与清空 */
export const strokeMask = (command: MaskCommand) => set(commitDrawing(command));

/** 撤销、重做：游标只在已提交的命令范围内移动；重绘同时清除就地错误 */
const moveCursor = (delta: -1 | 1) =>
  set((s) => {
    const d = s.drawing;
    if (d?.kind !== "sketch" && d?.kind !== "inpaint") return s;
    const cursor = d.cursor + delta;
    const moved = cursor >= 0 && cursor <= d.doc.commands.length;
    if (d.kind === "sketch") return moved ? { drawing: { ...d, cursor } } : s;
    return { drawing: { ...d, ...(moved ? { cursor } : {}), error: null } };
  });
export const undoDrawing = () => moveCursor(-1);
export const redoDrawing = () => moveCursor(1);

/** 确认导出中：防重复确认 */
export const setDrawingConfirming = (confirming: boolean) =>
  set((s) =>
    s.drawing && s.drawing.kind !== "opening"
      ? { drawing: { ...s.drawing, confirming } }
      : s,
  );

/** 确认失败：回到可继续编辑，并在弹层内就地报错（仅局部重绘） */
export const setDrawingError = (error: InpaintIssue) =>
  set((s) =>
    s.drawing?.kind === "inpaint"
      ? { drawing: { ...s.drawing, confirming: false, error } }
      : s,
  );

/** 关闭画板；传 id 时只关闭这个会话（确认框、异步回调持有的 id 可能已过期），进行中的导出随之失效 */
export const closeDrawing = (id?: string) =>
  set((s) =>
    s.drawing && (id === undefined || s.drawing.id === id)
      ? { drawing: null }
      : s,
  );

/** 选区确认落回草稿，按入口分三种：
 *  result 以该结果为唯一底图开新草稿并离开当前记录；draft-input 底图重排为图1；reedit 只替换选区。
 *  reordered：draft-input 且还有其他图片，图片编号变了 */
export function applyInpaintSelection(
  payload: InpaintPayload & { chosenInputId: string | null },
): { reordered: boolean } {
  const { entry, chosenInputId } = payload;
  const reordered =
    entry === "draft-input" &&
    !!chosenInputId &&
    useWorkspace.getState().draft.inputs.length > 1;
  set((s) => {
    if (entry === "result")
      return {
        draft: withInpaint(
          freshDraft(s.draft, undefined, [
            { imageId: payload.base.id, upload: payload.base },
          ]),
          payload,
        ),
        nav: { ...s.nav, selectedId: null, lastDoneId: null },
        view: {
          ...s.view,
          focusIdx: null,
          lightboxId: null,
          previewId: null,
          barMode: "full",
          focusSeq: s.view.focusSeq + 1,
        },
      };
    if (entry === "draft-input")
      return {
        draft: withInpaint(s.draft, payload, chosenInputId ?? undefined),
        view: {
          ...s.view,
          barMode: "full",
          focusSeq: s.view.focusSeq + 1,
        },
      };
    return { draft: withInpaint(s.draft, payload) };
  });
  return { reordered };
}
