/** 草稿迁移函数：描述与参数、输入图、选区、草图附件 */
import type { ImageRow } from "../../../db/schema";
import { formSize, type GenForm } from "../../../lib/params";
import {
  MAX_INPUT_IMAGES,
  type FidelityChoice,
  type GenParams,
  type InputImage,
  type UploadIssue,
} from "../../../lib/types";
import { useWorkspace, type WorkspaceState } from "../index";
import {
  set,
  setDraft,
  freshDraft,
  withInpaint,
  type InpaintPayload,
} from "./internal";

/** 新草稿：给参数就整体替换，否则保留参数只清空描述；同时让进行中的上传读取失效 */
export const initializeDraft = (
  params?: GenParams,
  inputs: InputImage[] = [],
) => set((s) => ({ draft: freshDraft(s.draft, params, inputs) }));

export const patchForm = (patch: Partial<GenForm>) =>
  set((s) => ({
    draft: { ...s.draft, form: { ...s.draft.form, ...patch }, dirty: true },
  }));

export const setInputFidelity = (inputFidelity: FidelityChoice) =>
  setDraft({ inputFidelity, dirty: true });

/** 提交生成：请求参数已快照，立即清空描述；保留参数和输入图供下一次创作。 */
export const markSubmitted = () =>
  set((s) => ({
    draft: { ...s.draft, form: { ...s.draft.form, prompt: "" }, dirty: false },
  }));

export const acceptSize = () => setDraft({ sizeAccepted: true });

/** 开始读取一批上传 */
export const beginRead = (readId: string) =>
  setDraft({ readId, uploadIssues: [] });

/** 第一批输入图：比例改为 auto。多比例开着时保持多比例与所选比例（多比例下没有「自动」） */
const withFirstInputs = (draft: WorkspaceState["draft"]): GenForm =>
  draft.inputs.length || draft.form.multi
    ? draft.form
    : { ...draft.form, ratio: "auto", cw: "", ch: "" };

/** 读取完成：批次已失效（读取中移除图片、切换记录等）时忽略并返回 false；超出上限的图片不添加并追加一条提示 */
export function finishRead(
  readId: string,
  added: InputImage[],
  issues: UploadIssue[],
): boolean {
  const { draft } = useWorkspace.getState();
  if (draft.readId !== readId) return false;
  const kept = added.slice(
    0,
    Math.max(0, MAX_INPUT_IMAGES - draft.inputs.length),
  );
  const skipped = added.length - kept.length;
  const nextIssues: UploadIssue[] = skipped
    ? [...issues, { kind: "overflow", kept: kept.length, skipped }]
    : issues;
  set((s) => ({
    draft: {
      ...s.draft,
      ...(kept.length
        ? {
            inputs: [...s.draft.inputs, ...kept],
            form: withFirstInputs(s.draft),
            dirty: true,
          }
        : {}),
      uploadIssues: nextIssues,
      readId: null,
    },
  }));
  return true;
}

/** 移除输入图；移除的是底图时连带移除选区（不留无底图的重绘状态），并让进行中的读取失效 */
export function removeDraftInput(id: string): "base-and-mask" | "renumbered" {
  const { draft } = useWorkspace.getState();
  const withMask = !!draft.inpaint && draft.inputs[0]?.imageId === id;
  setDraft({
    readId: null,
    inputs: draft.inputs.filter((input) => input.imageId !== id),
    ...(withMask ? { inpaint: null, sizeAccepted: false } : {}),
    dirty: true,
    uploadIssues: [],
  });
  return withMask ? "base-and-mask" : "renumbered";
}

/** 移除选区：保留底图与描述，切换为普通图片编辑 */
export const removeDraftMask = () =>
  setDraft({ inpaint: null, sizeAccepted: false, dirty: true });

/** 把选区放进草稿（恢复上次重绘时用）；画板确认走 applyInpaintSelection */
export const applyInpaintToDraft = (
  payload: InpaintPayload,
  chosenInputId?: string,
) => set((s) => ({ draft: withInpaint(s.draft, payload, chosenInputId) }));

/** 设为参考图：追加已有结果为输入源，不打断当前草稿 */
export function appendExisting(
  imageId: string,
  generationId: string | undefined,
): "duplicate" | "too-many" | "added" {
  const { draft } = useWorkspace.getState();
  if (draft.inputs.some((input) => input.imageId === imageId))
    return "duplicate";
  if (draft.inputs.length >= MAX_INPUT_IMAGES) return "too-many";
  set((s) => ({
    draft: {
      ...s.draft,
      inputs: [...s.draft.inputs, { imageId, generationId }],
      form: withFirstInputs(s.draft),
      dirty: true,
    },
  }));
  return "added";
}

/** 草图落附件并展开创作条：原位替换或追加；第一次加草图且尺寸为 auto 时改用草图尺寸，
 *  描述为空时填入起始文字（seedPrompt 由调用方按当前语言生成，参数是草图的图序号，从 1 起） */
export function applySketchAttachment(
  image: ImageRow,
  replaces: string | null,
  seedPrompt: (index: number) => string,
): { ok: false } | { ok: true; sizeSetTo: { w: number; h: number } | null } {
  const { draft } = useWorkspace.getState();
  const target =
    replaces ??
    draft.inputs.find((input) => input.upload?.sketch)?.imageId ??
    null;
  if (!target && draft.inputs.length >= MAX_INPUT_IMAGES) return { ok: false };
  const attachment: InputImage = { imageId: image.id, upload: image };
  const setSize =
    !replaces && draft.inputs.length === 0 && formSize(draft.form) === "auto";
  const seed = !replaces && !draft.form.prompt.trim();
  set((s) => ({
    draft: {
      ...s.draft,
      inputs: target
        ? s.draft.inputs.map((input) =>
            input.imageId === target ? attachment : input,
          )
        : [...s.draft.inputs, attachment],
      form: {
        ...s.draft.form,
        ...(setSize
          ? { cw: String(image.width), ch: String(image.height) }
          : {}),
        ...(seed ? { prompt: seedPrompt(draft.inputs.length + 1) } : {}),
      },
      dirty: true,
    },
    view: { ...s.view, barMode: "full", focusSeq: s.view.focusSeq + 1 },
  }));
  return {
    ok: true,
    sizeSetTo: setSize ? { w: image.width, h: image.height } : null,
  };
}
