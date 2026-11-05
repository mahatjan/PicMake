/** 创作区：创作条与输入图预览；把草稿与资源投影成展示组件的 props，操作交给 flows。
 *  副作用：focusSeq 变化时聚焦描述框；创作条展开期间监听点击条外（收起规则见 selectShouldCollapseBar），
 *  回到 mini 即移除；监听页面粘贴，把剪贴板里的图片作为输入图（规则见 selectCanPasteImage） */
import { useEffect, useMemo, useRef } from "react";
import { CreateBar } from "../components/bar/CreateBar";
import { InputPreview } from "../components/overlays/InputPreview";
import {
  continueHistorySketch,
  editMask,
  editSketchAttachment,
  openSketchNew,
  startInpaintFromInput,
} from "../flows/drawing";
import {
  addClipboardImages,
  addFiles,
  removeInput,
  removeMask,
} from "../flows/draft";
import { downloadAll } from "../flows/export";
import { generate, regenerate } from "../flows/generate";
import {
  addAsReference,
  returnToResult,
  reuseParams,
} from "../flows/navigation";
import { useCreateBarInset } from "../hooks/useCreateBarInset";
import { useDraftImages } from "../hooks/useDraftImages";
import { useNarrowViewport } from "../hooks/useNarrowViewport";
import type { WorkspaceAssets } from "../hooks/useWorkspaceAssets";
import {
  clipboardHasText,
  clipboardImageFiles,
  isEditableTarget,
} from "../lib/clipboard";
import { customOk } from "../lib/params";
import { inpaintBarInfo } from "../lib/workspace-rules";
import { useWorkspace } from "../store/workspace";
import {
  acceptSize,
  expandBar,
  patchForm,
  setBarMode,
  setInputFidelity,
  setPreviewId,
} from "../store/workspace/actions";
import {
  selectCanReturn,
  selectRun,
  selectBusy,
  selectShouldCollapseBar,
  selectCanPasteImage,
} from "../store/workspace/selectors";

export function CreateArea({ assets }: { assets: WorkspaceAssets }) {
  const { display, sourceImages } = assets;
  const barMode = useWorkspace((s) => s.view.barMode);
  const focusSeq = useWorkspace((s) => s.view.focusSeq);
  const previewId = useWorkspace((s) => s.view.previewId);
  const lastDoneId = useWorkspace((s) => s.nav.lastDoneId);
  const generating = useWorkspace(selectBusy);
  const run = useWorkspace(selectRun);
  const canReturn = useWorkspace(selectCanReturn);
  // 草稿在 store：读取中 = readId 非空；附件缩略图与重绘尺寸在这里投影
  const draft = useWorkspace((s) => s.draft);
  const draftImages = useDraftImages(draft.inputs, !!draft.inpaint);
  const inpaintInfo = useMemo(
    () => inpaintBarInfo(draft.inpaint, draft.sizeAccepted),
    [draft.inpaint, draft.sizeAccepted],
  );
  /** 已确认草图的逻辑尺寸（比例不一致提示） */
  const sketchInput = draft.inputs.find((input) => input.upload?.sketch);
  const sketchSize = sketchInput?.upload
    ? { w: sketchInput.upload.width, h: sketchInput.upload.height }
    : null;
  /** complete 态：展示的正是刚保存的那次生成，或在画廊里由刚保存的结果兜底（见 useWorkspaceAssets） */
  const doneGen =
    run.phase === "unsaved" || draft.dirty
      ? null
      : display?.row.id === lastDoneId
        ? display
        : assets.lastDoneDisplay;
  /** 预览的图：有展示记录时看它的来源图，否则看草稿里的输入图 */
  const previewImages = display ? sourceImages : draftImages;
  const narrow = useNarrowViewport();

  // focusSeq 变化即聚焦描述框（展开创作条、草稿落位、描述为空时提交）
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const barRef = useRef<HTMLElement>(null);
  useCreateBarInset(barRef);
  useEffect(() => {
    if (focusSeq) requestAnimationFrame(() => promptRef.current?.focus());
  }, [focusSeq]);

  // full 态点条外收起：规则见 shouldCollapseBar；点击落在浮层上不收回
  useEffect(() => {
    if (barMode !== "full") return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (
        !t ||
        t.closest(".pm-bar") ||
        t.closest(".pm-detail") ||
        t.closest(".modal__backdrop") ||
        t.closest(".pm-sk-overlay") ||
        t.closest(".pm-ip-overlay") ||
        t.closest(".pm-vm-backdrop")
      )
        return;
      if (selectShouldCollapseBar(useWorkspace.getState())) setBarMode("mini");
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [barMode]);

  // 剪贴板图片：页面任意位置粘贴都作为输入图（能不能接收见 selectCanPasteImage）；
  // 粘贴目标里有文字时让文字优先，不劫持正常的文本粘贴
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const files = clipboardImageFiles(event.clipboardData);
      if (!files.length) return;
      if (!selectCanPasteImage(useWorkspace.getState())) return;
      if (
        isEditableTarget(event.target) &&
        clipboardHasText(event.clipboardData)
      )
        return;
      event.preventDefault();
      void addClipboardImages(files);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, []);

  return (
    <>
      <CreateBar
        mode={barMode}
        generating={generating}
        done={doneGen}
        form={draft.form}
        customValid={customOk(draft.form)}
        images={draftImages}
        inputFidelity={draft.inputFidelity}
        reading={draft.readId !== null}
        uploadIssues={draft.uploadIssues}
        canReturn={canReturn}
        sketchSize={sketchSize}
        inpaint={inpaintInfo}
        promptRef={promptRef}
        barRef={barRef}
        onPatch={patchForm}
        onGenerate={generate}
        onFiles={(files) => {
          void addFiles(files);
        }}
        onRemove={removeInput}
        onPreview={setPreviewId}
        onOpenSketch={openSketchNew}
        onEditSketch={editSketchAttachment}
        onInputFidelity={setInputFidelity}
        onExpand={expandBar}
        onReturn={returnToResult}
        onAgain={() => doneGen && regenerate(doneGen.row.id)}
        onTweak={() => doneGen && reuseParams(doneGen.row.id)}
        onDownloadAll={() => display && downloadAll(display)}
        onUseAsRef={addAsReference}
        onStartInpaint={startInpaintFromInput}
        onEditMask={editMask}
        onRemoveMask={removeMask}
        onAcceptSize={acceptSize}
        compact={narrow}
      />

      <InputPreview
        key={previewId ?? "closed"}
        image={previewImages.find((image) => image.id === previewId) ?? null}
        onContinueSketch={
          previewId &&
          previewImages.some(
            (image) => image.id === previewId && image.isSketch,
          )
            ? () => continueHistorySketch(previewId)
            : undefined
        }
        onClose={() => setPreviewId(null)}
      />
    </>
  );
}
