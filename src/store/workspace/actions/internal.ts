/** actions 内部共用：写入助手与跨切片的纯计算；不经 index.ts 对外导出 */
import type { ImageRow } from "../../../db/schema";
import { inpaintTargetSize } from "../../../lib/inpaint";
import { DEFAULT_FORM, paramsToForm, withoutMulti } from "../../../lib/params";
import {
  type GenParams,
  type InpaintDraft,
  type InpaintEntry,
  type InputImage,
  type MaskImage,
} from "../../../lib/types";
import { useWorkspace, type WorkspaceState } from "../index";

export const set = useWorkspace.setState;
export const setDraft = (patch: Partial<WorkspaceState["draft"]>) =>
  set((s) => ({ draft: { ...s.draft, ...patch } }));
export const setNav = (patch: Partial<WorkspaceState["nav"]>) =>
  set((s) => ({ nav: { ...s.nav, ...patch } }));
export const setView = (patch: Partial<WorkspaceState["view"]>) =>
  set((s) => ({ view: { ...s.view, ...patch } }));

export function freshDraft(
  current: WorkspaceState["draft"],
  params?: GenParams,
  inputs: InputImage[] = [],
): WorkspaceState["draft"] {
  return {
    form: params ? paramsToForm(params) : { ...current.form, prompt: "" },
    inputs,
    inpaint: null,
    sizeAccepted: false,
    inputFidelity: "auto",
    dirty: false,
    readId: null,
    uploadIssues: [],
  };
}

/** 空草稿：描述、输入图与参数全部回到默认（提交后不保留时用） */
export function emptyDraft(): WorkspaceState["draft"] {
  return {
    form: { ...DEFAULT_FORM },
    inputs: [],
    inpaint: null,
    sizeAccepted: false,
    inputFidelity: "auto",
    dirty: false,
    readId: null,
    uploadIssues: [],
  };
}

export interface InpaintPayload {
  base: ImageRow;
  mask: MaskImage;
  original?: InpaintDraft["original"];
  entry: InpaintEntry;
}

/** 选区落进草稿（纯计算）：draft-input 把底图重排为图1 并移除被选中的原图；result 底图已由新草稿就位、reedit 底图已在位。
 *  局部重绘的输出尺寸由选区决定，不支持多比例：进入时退回单选 */
export function withInpaint(
  draft: WorkspaceState["draft"],
  payload: InpaintPayload,
  chosenInputId?: string,
): WorkspaceState["draft"] {
  const target =
    payload.entry === "reedit"
      ? undefined
      : inpaintTargetSize(payload.mask.width, payload.mask.height);
  return {
    ...draft,
    form: withoutMulti(draft.form),
    inputs:
      payload.entry === "draft-input"
        ? [
            { imageId: payload.base.id, upload: payload.base },
            ...draft.inputs.filter(
              (input) =>
                input.imageId !== chosenInputId &&
                input.imageId !== payload.base.id,
            ),
          ]
        : draft.inputs,
    ...(payload.entry === "reedit"
      ? {}
      : { sizeAccepted: target ? !target.suggested : false }),
    inpaint: { mask: payload.mask, original: payload.original },
    dirty: true,
  };
}
