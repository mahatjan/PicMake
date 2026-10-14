/** 创作区：创作条与输入图预览；把草稿与资源投影成展示组件的 props，操作交给 flows。
 *  副作用：focusSeq 变化时聚焦描述框；创作条展开期间监听点击条外（收起规则见 selectShouldCollapseBar），
 *  回到 mini 即移除 */
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
import { addFiles, removeInput, removeMask } from "../flows/draft";
import { downloadAll } from "../flows/export";
import { cancelGenerate, generate, regenerate } from "../flows/generate";
import {
  addAsReference,
  returnToResult,
  reuseParams,
} from "../flows/navigation";
import { useCreateBarInset } from "../hooks/useCreateBarInset";
import { useDraftImages } from "../hooks/useDraftImages";
import type { WorkspaceAssets } from "../hooks/useWorkspaceAssets";
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
  selectRunDone,
  selectRunTotal,
  selectShouldCollapseBar,
} from "../store/workspace/selectors";

export function CreateArea({ assets }: { assets: WorkspaceAssets }) {
  const { display, sourceImages } = assets;
  const barMode = useWorkspace((s) => s.view.barMode);
  const focusSeq = useWorkspace((s) => s.view.focusSeq);
  const previewId = useWorkspace((s) => s.view.previewId);
  const lastDoneId = useWorkspace((s) => s.nav.lastDoneId);
  const generating = useWorkspace((s) => s.run.phase === "generating");
  const partialIndex = useWorkspace((s) =>
    s.run.phase === "generating" ? (s.run.partial?.index ?? 0) : 0,
  );
  // 多尺寸生成中的进度（已完成 / 总数）；单尺寸时总数为 0
  const runDone = useWorkspace(selectRunDone);
  const runTotal = useWorkspace(selectRunTotal);
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
  /** complete 态只在展示的确实是刚保存的那次生成时成立 */
  const doneGen = lastDoneId && display?.row.id === lastDoneId ? display : null;
  /** 预览的图：有展示记录时看它的来源图，否则看草稿里的输入图 */
  const previewImages = display ? sourceImages : draftImages;

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

  return (
    <>
      <CreateBar
        mode={barMode}
        generating={generating}
        done={doneGen}
        partialIndex={partialIndex}
        progress={runTotal > 0 ? { done: runDone, total: runTotal } : null}
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
        onCancel={cancelGenerate}
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
