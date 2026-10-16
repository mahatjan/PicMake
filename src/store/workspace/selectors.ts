/** 工作区 selector：返回原始值或 store 内已有的引用，避免 zustand v5 因新引用反复渲染 */
import type { HistoryRow } from "../../db/schema";
import type { PreparedGeneration } from "../../lib/generation";
import {
  canWheelSwitch,
  hasUserWork,
  shouldCollapseBar,
} from "../../lib/workspace-rules";
import type { Run, WorkspaceState } from "./index";

const EMPTY_ROWS: HistoryRow[] = [];
const IDLE_RUN: Run = { phase: "idle" };

/** 全局任务状态：用于创作条、取消与离开页面提示，不代表当前查看的记录。 */
export const selectRun = (s: WorkspaceState): Run =>
  s.tasks.find((task) => task.run.phase === "generating")?.run ??
  s.tasks.find((task) => task.run.phase === "saving")?.run ??
  s.tasks.find((task) => task.run.phase === "unsaved")?.run ??
  IDLE_RUN;

export const selectActiveCount = (s: WorkspaceState) =>
  s.tasks.filter((task) => task.run.phase !== "unsaved").length;
export const selectBusy = (s: WorkspaceState) => selectActiveCount(s) > 0;

/** 历史列表；尚未加载时为固定的空数组 */
export const selectRows = (s: WorkspaceState) => s.history.rows ?? EMPTY_ROWS;

/** "返回结果"的目标记录仍在列表中 */
export const selectCanReturn = (s: WorkspaceState) =>
  !!s.nav.returnId &&
  (s.history.rows ?? EMPTY_ROWS).some((row) => row.id === s.nav.returnId);

/** 多尺寸生成中已完成的请求数；不是多尺寸生成中为 0 */
export const selectRunDone = (s: WorkspaceState): number => {
  const run = selectRun(s);
  return run.phase === "generating" && run.slots
    ? run.slots.filter((slot) => slot.status === "done").length
    : 0;
};

/** 多尺寸生成中的请求总数；不是多尺寸生成中为 0 */
export const selectRunTotal = (s: WorkspaceState): number => {
  const run = selectRun(s);
  return run.phase === "generating" ? (run.slots?.length ?? 0) : 0;
};

/** 只在内存里的结果：保存中、保存失败 */
export const selectPending = (s: WorkspaceState): PreparedGeneration | null => {
  const run = selectRun(s);
  return run.phase === "saving" || run.phase === "unsaved"
    ? run.prepared
    : null;
};

/** 按 id 找记录：列表里的，或只在内存里的（保存中、保存失败、刚保存还没回推） */
export const findRow = (s: WorkspaceState, id: string): HistoryRow | null =>
  s.history.rows?.find((row) => row.id === id) ??
  findTaskRow(s, id) ??
  [selectPending(s)?.row, s.history.recent?.row].find(
    (row) => row?.id === id,
  ) ??
  null;

function findTaskRow(s: WorkspaceState, id: string): HistoryRow | null {
  for (const { run } of s.tasks) {
    if (
      (run.phase === "saving" || run.phase === "unsaved") &&
      run.prepared.row.id === id
    )
      return run.prepared.row;
  }
  return null;
}

/** 舞台展示的记录：用户选中优先；没有选中时才展示内存结果。 */
export const selectDisplayRow = (s: WorkspaceState): HistoryRow | null => {
  if (s.nav.selectedId) return findRow(s, s.nav.selectedId);
  const pending = selectPending(s);
  if (pending) return pending.row;
  return null;
};

/** 查看历史作品时，后台生成、保存和保存失败都不接管舞台。 */
export const selectDisplayRun = (s: WorkspaceState): Run =>
  s.nav.selectedId && findRow(s, s.nav.selectedId) ? IDLE_RUN : selectRun(s);

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

/**
 * 首页画廊的状态。三种取值各有明确含义，避免"空数组"与"还没加载"混为一谈：
 *  - "loading"：历史列表还没加载完（首帧），先让空状态引导占位，避免有历史的老用户刷新后先看到一片空白；
 *  - "empty"：列表已加载但一条都没有，同上，显示空状态引导；
 *  - HistoryRow[]：画廊要展示的记录（列表本身的引用，不新建数组）。
 *  返回 null 表示舞台上该显示别的（选中了记录、草稿有输入图、视频工作台）。
 */
export type GalleryState = "loading" | "empty" | HistoryRow[];

/** 该不该由画廊占着舞台：没有**用户选中的**记录、也不在视频工作台。
 *  只看 nav.selectedId，不看 history.recent —— 刚保存成功时 selectedId 为空、recent 有值，
 *  此时必须留在画廊（新记录置顶），而不是停在详情页 */
const selectGalleryShow = (s: WorkspaceState): boolean => {
  if (s.nav.selectedId && selectDisplayRow(s)) return false;
  if (s.view.playgroundOpen) return false;
  // 后台生成与保存都显示任务卡，不会把首页切走。
  if (selectBusy(s)) return true;
  // 保存失败：结果在内存里，仍停在结果页
  if (selectRun(s).phase !== "idle") return false;
  // 写描述、调参数都还停在首页：创作条就在画廊下方，输入时不该把画廊换成空状态引导。
  // 上了输入图（或正在读取）才算"在编辑一张图"，让位给结果区
  return s.draft.inputs.length === 0 && s.draft.readId === null;
};

export const selectGallery = (s: WorkspaceState): GalleryState | null => {
  if (!selectGalleryShow(s)) return null;
  const rows = s.history.rows;
  if (!rows) return "loading";
  return rows.length ? rows : "empty";
};

/** 首页画廊是否占着舞台：空状态引导必须让位，否则会叠在画廊上。
 *  三种情况为真：有记录、正在生成（生成卡要显示，即使还没有任何记录）、列表已加载。
 *  列表已加载但为空、且没有生成 → 仍是空状态引导（否则首页会什么都没有） */
export const selectGalleryVisible = (s: WorkspaceState): boolean =>
  selectGalleryShow(s) && (selectBusy(s) || (s.history.rows?.length ?? 0) > 0);

/** 舞台上是不是首页（画廊，或列表还在加载/为空的空状态引导）。
 *  滚轮规则用它：首页要能滚动，不能让舞台的滚轮监听抢走事件 */
export const selectHomeScreen = (s: WorkspaceState): boolean =>
  selectGalleryShow(s);

/** 正在生成：画廊顶部显示生成卡（单尺寸随渐进预览，多尺寸显示已完成进度） */
export const selectGenerating = (s: WorkspaceState): boolean =>
  selectGalleryShow(s) && selectBusy(s);

/** 舞台滚轮是否响应：规则见 canWheelSwitch；返回布尔值，只在结果翻转时触发重渲染 */
export const selectCanWheelSwitch = (s: WorkspaceState) =>
  canWheelSwitch({
    run: selectDisplayRun(s).phase,
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
    atHome: selectHomeScreen(s),
  });

/** 点创作条外是否收起：规则见 shouldCollapseBar，在点击事件里按当前状态计算 */
export const selectShouldCollapseBar = (s: WorkspaceState) =>
  shouldCollapseBar({
    userWork: selectHasUserWork(s),
    inputCount: s.draft.inputs.length,
    canReturn: selectCanReturn(s),
  });
