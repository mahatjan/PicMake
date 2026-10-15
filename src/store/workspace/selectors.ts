/** 工作区 selector：返回原始值或 store 内已有的引用，避免 zustand v5 因新引用反复渲染 */
import type { HistoryRow } from "../../db/schema";
import type { PreparedGeneration } from "../../lib/generation";
import {
  canWheelSwitch,
  hasUserWork,
  shouldCollapseBar,
} from "../../lib/workspace-rules";
import type { WorkspaceState } from "./index";

const EMPTY_ROWS: HistoryRow[] = [];

/** 历史列表；尚未加载时为固定的空数组 */
export const selectRows = (s: WorkspaceState) => s.history.rows ?? EMPTY_ROWS;

/** "返回结果"的目标记录仍在列表中 */
export const selectCanReturn = (s: WorkspaceState) =>
  !!s.nav.returnId &&
  (s.history.rows ?? EMPTY_ROWS).some((row) => row.id === s.nav.returnId);

/** 多尺寸生成中已完成的请求数；不是多尺寸生成中为 0 */
export const selectRunDone = (s: WorkspaceState): number =>
  s.run.phase === "generating" && s.run.slots
    ? s.run.slots.filter((slot) => slot.status === "done").length
    : 0;

/** 多尺寸生成中的请求总数；不是多尺寸生成中为 0 */
export const selectRunTotal = (s: WorkspaceState): number =>
  s.run.phase === "generating" ? (s.run.slots?.length ?? 0) : 0;

/** 只在内存里的结果：保存中、保存失败 */
export const selectPending = (s: WorkspaceState): PreparedGeneration | null =>
  s.run.phase === "saving" || s.run.phase === "unsaved" ? s.run.prepared : null;

/** 按 id 找记录：列表里的，或只在内存里的（保存中、保存失败、刚保存还没回推） */
export const findRow = (s: WorkspaceState, id: string): HistoryRow | null =>
  s.history.rows?.find((row) => row.id === id) ??
  [selectPending(s)?.row, s.history.recent?.row].find(
    (row) => row?.id === id,
  ) ??
  null;

/** 舞台展示的记录（数据层，不等图片 URL）：内存结果优先；列表还没回推刚保存的记录时用 recent 过渡 */
export const selectDisplayRow = (s: WorkspaceState): HistoryRow | null => {
  const pending = selectPending(s);
  if (pending) return pending.row;
  return s.nav.selectedId ? findRow(s, s.nav.selectedId) : null;
};

/** 当前选中的图片：单张取那张，多张取轮播所在的那张 */
export const selectSelectedImageId = (s: WorkspaceState): string | null => {
  const row = selectDisplayRow(s);
  if (!row) return null;
  if (row.imageIds.length === 1) return row.imageIds[0];
  return s.view.focusIdx !== null
    ? (row.imageIds[s.view.focusIdx] ?? null)
    : null;
};

/** 草稿有用户修改：改过，或上传正在读取 */
const selectHasUserWork = (s: WorkspaceState) =>
  hasUserWork({ dirty: s.draft.dirty, reading: s.draft.readId !== null });

/** 舞台滚轮是否响应：规则见 canWheelSwitch；返回布尔值，只在结果翻转时触发重渲染 */
export const selectCanWheelSwitch = (s: WorkspaceState) =>
  canWheelSwitch({
    run: s.run.phase,
    userWork: selectHasUserWork(s),
    inputCount: s.draft.inputs.length,
    overlayOpen:
      s.view.settingsOpen ||
      s.view.drawerOpen ||
      s.view.playgroundOpen ||
      s.view.lightboxId !== null ||
      s.view.viewMask !== null ||
      s.view.focusIdx !== null,
    drawing: s.drawing !== null,
    confirming: s.confirm !== null,
  });

/** 点创作条外是否收起：规则见 shouldCollapseBar，在点击事件里按当前状态计算 */
export const selectShouldCollapseBar = (s: WorkspaceState) =>
  shouldCollapseBar({
    userWork: selectHasUserWork(s),
    inputCount: s.draft.inputs.length,
    canReturn: selectCanReturn(s),
  });
