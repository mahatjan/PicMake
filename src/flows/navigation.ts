/** 导航流程：切换记录、新建、返回结果、复用参数、编辑此图、调整上次重绘、删除、收藏、设为参考图 */
import { toast } from "@heroui/react";
import { deleteHistory, toggleStar as toggleStarRow } from "../db/history";
import { db } from "../db/schema";
import { t } from "../i18n";
import { errorHint } from "../i18n/errors";
import { missingText } from "../i18n/labels";
import type { GenParams } from "../lib/types";
import {
  hasUserWork,
  leaveDecision,
  wheelTarget,
} from "../lib/workspace-rules";
import { useWorkspace } from "../store/workspace";
import {
  acceptSize,
  appendExisting,
  applyInpaintToDraft,
  clearDone,
  discardUnsaved,
  initializeDraft,
  openBar,
  recordDeleted,
  resetView,
  resetWorkspace,
  selectRecord,
  setBarMode,
  setConfirm,
  setReturnId,
  viewRecord,
} from "../store/workspace/actions";
import {
  findRow,
  selectRun,
  selectDisplayRow,
  selectRows,
  selectSelectedImageId,
} from "../store/workspace/selectors";
import { readInpaintDraft, toastError } from "./generate";

/** 延迟回调（确认之后、await 之后）按当前状态复核：已开始生成或正在保存时不再执行 */
function busyNow(): boolean {
  const { phase } = selectRun(useWorkspace.getState());
  return phase === "generating" || phase === "saving";
}

/** 离开或替换当前结果/草稿：规则见 leaveDecision；usesDisplayed = 以展示中的记录为来源 */
export function requestLeave(onLeave: () => void, usesDisplayed = false) {
  const state = useWorkspace.getState();
  const run = selectRun(state);
  const { draft } = state;
  const decision = leaveDecision({
    run: run.phase,
    userWork: hasUserWork({
      dirty: draft.dirty,
      reading: draft.readId !== null,
    }),
    usesDisplayed,
  });
  if (decision === "blocked") return;
  if (decision === "confirm-unsaved") {
    setConfirm({
      title: t("confirm.unsavedLeave.title"),
      desc: t("confirm.unsavedLeave.desc"),
      onOk: () => {
        if (busyNow()) return;
        discardUnsaved();
        onLeave();
      },
    });
    return;
  }
  if (decision === "confirm-draft") {
    setConfirm({
      title: t("confirm.draft.title"),
      desc: t("confirm.draft.desc"),
      onOk: () => {
        if (!busyNow()) onLeave();
      },
    });
    return;
  }
  onLeave();
}

export function selectHistory(id: string) {
  if (findRow(useWorkspace.getState(), id)) viewRecord(id);
}

export function newGeneration() {
  // 后台任务有自己的草稿快照，回首页只切换查看目标。
  if (useWorkspace.getState().tasks.length) {
    viewRecord(null);
    return;
  }
  requestLeave(() => resetWorkspace(null));
}

export function returnToResult() {
  const { returnId } = useWorkspace.getState().nav;
  if (!returnId) return;
  requestLeave(() => resetWorkspace(returnId));
}

export function reuseParams(id: string) {
  const row = findRow(useWorkspace.getState(), id);
  if (!row) return;
  requestLeave(() => {
    clearDone();
    initializeDraft(row.params);
    selectRecord(null);
    setReturnId(null);
    resetView();
    openBar();
    toast(t("toast.paramsRestored"));
  });
}

/** 编辑某张图的草稿参数：多尺寸记录的 params.size 只是第一个比例，
 *  草稿尺寸取被编辑那张图的实际尺寸，多比例关闭 */
async function editParams(
  params: GenParams,
  imageId: string,
): Promise<GenParams> {
  const { sizes: _sizes, ...single } = params;
  const image = await db.images.get(imageId).catch(() => undefined);
  const size =
    image && image.width > 0 && image.height > 0
      ? { w: image.width, h: image.height }
      : single.size;
  return { ...single, n: 1, size, prompt: "" };
}

export function editImage(imageId: string) {
  // 请求时确定来源记录：确认框之后执行时不再重新推断
  const row = selectDisplayRow(useWorkspace.getState());
  if (!row) return;
  const enter = (params: GenParams) => {
    clearDone();
    initializeDraft(params, [{ generationId: row.id, imageId }]);
    setReturnId(row.id);
    selectRecord(null);
    resetView();
    openBar();
  };
  requestLeave(() => {
    if (!row.params.sizes) {
      enter({ ...row.params, prompt: "" });
      return;
    }
    void editParams(row.params, imageId).then((params) => {
      // 读取期间已开始生成或正在保存：不再进入编辑
      if (!busyNow()) enter(params);
    });
  }, true);
}

/** 编辑当前选中的那张图（单张取那张，多张取轮播所在的那张）；没有选中时忽略 */
export function editSelectedImage() {
  const imageId = selectSelectedImageId(useWorkspace.getState());
  if (imageId) editImage(imageId);
}

/** 舞台滚轮：按时间向旧（deltaY > 0）或向新切换记录；是否响应由 selectCanWheelSwitch 决定 */
export function switchByWheel(deltaY: number) {
  const state = useWorkspace.getState();
  const target = wheelTarget(selectRows(state), state.nav.selectedId, deltaY);
  if (target) selectHistory(target);
}

/** 调整上次重绘：恢复为可编辑草稿，不生成 */
export function adjustInpaint(id: string) {
  const row = findRow(useWorkspace.getState(), id);
  if (!row) return;
  requestLeave(async () => {
    clearDone();
    const read = await readInpaintDraft(row);
    if (busyNow()) return;
    if (!read.ok) {
      toast(t("toast.cantRestore", { what: missingText(read.missing, t) }));
      return;
    }
    // 恢复为已确认草稿：接受状态沿用已保存目标（约束变化在生成前重新复核）
    initializeDraft(read.params, read.draft.inputs);
    applyInpaintToDraft({
      base: read.draft.inputs[0].upload!,
      mask: read.mask,
      original: read.draft.inpaint?.original,
      entry: "reedit",
    });
    acceptSize();
    selectRecord(null);
    setReturnId(null);
    resetView();
    openBar();
    toast(t("toast.inpaintRestored"));
  }, true);
}

export function deleteRecord(id: string) {
  const state = useWorkspace.getState();
  const row = findRow(state, id);
  if (selectRun(state).phase !== "idle" || !row) return;
  // 请求时确定是否删的是当前记录：liveQuery 可能先于删除完成回推并回退选中
  const wasCurrent = state.nav.selectedId === id;
  setConfirm({
    title: t("confirm.delete.title"),
    desc: t("confirm.delete.desc", { count: row.imageIds.length }),
    onOk: () => {
      if (busyNow()) return;
      void deleteHistory(id)
        .then(() => {
          toast(t("toast.deleted"));
          recordDeleted(id);
          // 删除期间已开始生成：草稿属于这次生成，不再复位
          if (wasCurrent && !busyNow()) resetWorkspace();
        })
        .catch((caught) => toastError(caught));
    },
  });
}

/** 记录不存在时静默忽略（如未保存的结果） */
export function toggleStar(id: string) {
  void toggleStarRow(id);
}

/** 设为参考图：把展示记录中选中的那张（或第一张）追加为输入，不打断当前草稿 */
export function addAsReference() {
  const state = useWorkspace.getState();
  const row = selectDisplayRow(state);
  if (selectRun(state).phase !== "idle" || !row) return;
  const imageId = selectSelectedImageId(state) ?? row.imageIds[0] ?? null;
  if (!imageId) return;
  const added = appendExisting(imageId, row.id);
  if (added === "too-many") toast(errorHint("too-many-images", t));
  clearDone();
  setBarMode("full");
  toast(t("toast.referenceAdded"));
}
