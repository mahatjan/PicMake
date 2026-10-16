/** 工作区判定规则：纯函数，入参是最小快照，不依赖 store 或 hooks 的结构 */
import { inpaintTargetSize } from "./inpaint";
import {
  customOk,
  formToParams,
  validateParams,
  withoutMulti,
  type GenForm,
  type ParamIssue,
} from "./params";
import { sketchSnapshotKey } from "./sketch";
import type { GenParams, InpaintDraft, SketchDocument } from "./types";
import type { InpaintBarInfo } from "./view-models";

/** 生成生命周期：saving = 请求成功、正在写库；unsaved = 保存失败，结果留在内存 */
export type RunPhase = "idle" | "generating" | "saving" | "unsaved";

/** 离开会丢失用户的修改：草稿改过，或上传正在读取 */
export function hasUserWork(d: { dirty: boolean; reading: boolean }): boolean {
  return d.dirty || d.reading;
}

export type LeaveDecision =
  "blocked" | "confirm-unsaved" | "confirm-draft" | "ok";

/** 离开或替换草稿的入口：切换记录、新建、返回结果、复用参数、编辑此图、调整上次重绘、从结果发起局部重绘 */
export function leaveDecision(s: {
  run: RunPhase;
  userWork: boolean;
  /** 入口以当前展示的记录为来源：未保存的结果不能作为来源，直接拦截 */
  usesDisplayed: boolean;
}): LeaveDecision {
  if (s.run === "generating" || s.run === "saving") return "blocked";
  if (s.run === "unsaved")
    return s.usesDisplayed ? "blocked" : "confirm-unsaved";
  return s.userWork ? "confirm-draft" : "ok";
}

/** 草图与局部重绘入口：空闲、不在读取、没有确认框和已打开的画板 */
export function canOpenDrawing(s: {
  run: RunPhase;
  reading: boolean;
  confirming: boolean;
  drawing: boolean;
}): boolean {
  return s.run === "idle" && !s.reading && !s.confirming && !s.drawing;
}

/** 视频工作台：画板打开时不进入，避免两层编辑叠在一起 */
export function canOpenPlayground(s: { drawing: boolean }): boolean {
  return !s.drawing;
}

/** 画板打开以来是否有修改：撤销回打开时的状态视为没有修改。
 *  会序列化全部已提交命令，只在请求关闭画板时调用，不要放进 selector 或渲染路径 */
export function isDrawingChanged(d: {
  doc: Pick<SketchDocument, "commands">;
  cursor: number;
  /** 打开时的快照键 */
  openKey: string;
}): boolean {
  return d.cursor > 0 && sketchSnapshotKey(d.doc, d.cursor) !== d.openKey;
}

/** 舞台滚轮切换记录：空闲、草稿未改动且无输入图、没有弹层、画板和确认框 */
export function canWheelSwitch(s: {
  run: RunPhase;
  userWork: boolean;
  inputCount: number;
  /** 设置、抽屉、灯箱、选区查看、轮播任一打开 */
  overlayOpen: boolean;
  drawing: boolean;
  confirming: boolean;
}): boolean {
  return (
    s.run === "idle" &&
    !s.userWork &&
    s.inputCount === 0 &&
    !s.overlayOpen &&
    !s.drawing &&
    !s.confirming
  );
}

/** 点创作条外是否收起：草稿未改动、没有输入图、也没有可返回的结果 */
export function shouldCollapseBar(s: {
  userWork: boolean;
  inputCount: number;
  canReturn: boolean;
}): boolean {
  return !s.userWork && s.inputCount === 0 && !s.canReturn;
}

/** 舞台滚轮切换的目标记录：rows 按时间从新到旧；没有选中项时选最近一条；已在边界返回 null */
export function wheelTarget(
  rows: readonly { id: string }[],
  selectedId: string | null,
  deltaY: number,
): string | null {
  if (!rows.length) return null;
  const index = rows.findIndex((row) => row.id === selectedId);
  const next =
    index === -1
      ? 0
      : deltaY > 0
        ? Math.min(rows.length - 1, index + 1)
        : Math.max(0, index - 1);
  return next === index ? null : rows[next].id;
}

/** liveQuery 回推后的选中项：首次加载保留新建页面；只有原选中项确实从列表中删除时才回退 */
export function nextSelection(
  prev: readonly { id: string }[] | undefined,
  next: readonly { id: string }[],
  selectedId: string | null,
): string | null {
  if (!prev) return selectedId;
  // 写入完成可早于 liveQuery 回推：选中项不在旧列表里时保持不动
  if (
    selectedId &&
    prev.some((row) => row.id === selectedId) &&
    !next.some((row) => row.id === selectedId)
  )
    return next[0]?.id ?? null;
  return selectedId;
}

/** 局部重绘的输出目标与接受状态 */
export function inpaintBarInfo(
  inpaint: InpaintDraft | null,
  sizeAccepted: boolean,
): InpaintBarInfo | null {
  if (!inpaint) return null;
  const target = inpaintTargetSize(inpaint.mask.width, inpaint.mask.height);
  // 底图不合法：理论不可达（进入编辑器前已拦截），保守按需重新选择
  if (!target)
    return {
      tw: 0,
      th: 0,
      suggested: false,
      accepted: false,
      reason: { floor: null, scaled: false },
    };
  return {
    tw: target.w,
    th: target.h,
    suggested: target.suggested,
    accepted: target.suggested ? sizeAccepted : true,
    reason: target.reason,
  };
}

/** 提交前提示的问题码；界面文案见 i18n 资源 issues.* */
export type DraftIssue = "size-not-accepted" | "custom-size" | ParamIssue;

export type DraftParamsResult =
  | { ok: true; params: GenParams }
  | {
      ok: false;
      reason: "size-not-accepted" | "reading" | "custom-size" | "invalid";
      /** 需要提示用户的问题；读取中静默拦截，没有 */
      issue?: DraftIssue;
      /** 描述为空：调用方聚焦描述框 */
      focusPrompt?: boolean;
    };

/** 草稿 → 请求参数；检查顺序：重绘尺寸已接受 → 不在读取 → 自定义尺寸合法 → 参数校验 */
export function draftToParams(d: {
  form: GenForm;
  inpaint: InpaintDraft | null;
  sizeAccepted: boolean;
  reading: boolean;
}): DraftParamsResult {
  const info = inpaintBarInfo(d.inpaint, d.sizeAccepted);
  if (info?.suggested && !info.accepted)
    return {
      ok: false,
      reason: "size-not-accepted",
      issue: "size-not-accepted",
    };
  if (d.reading) return { ok: false, reason: "reading" };
  if (!info && !customOk(d.form))
    return { ok: false, reason: "custom-size", issue: "custom-size" };
  // 局部重绘：输出尺寸按目标尺寸，不开放任意比例，也不支持多比例
  const params = formToParams(info ? withoutMulti(d.form) : d.form);
  if (info) params.size = { w: info.tw, h: info.th };
  const issues = validateParams(params);
  if (issues.length)
    return {
      ok: false,
      reason: "invalid",
      issue: issues[0],
      focusPrompt: !params.prompt.trim(),
    };
  return { ok: true, params };
}
