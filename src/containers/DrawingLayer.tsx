/** 画板层：草图与局部重绘弹层，以及底图准备中的提示；重绘底图 URL 随会话生成与回收 */
import { Suspense, lazy, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  confirmInpaint,
  confirmSketch,
  notifyDrawLimit,
  requestCloseInpaint,
  requestCloseSketch,
} from "../flows/drawing";
import { useObjectUrl } from "../hooks/useObjectUrl";
import { useWorkspace } from "../store/workspace";
import {
  redoDrawing,
  strokeMask,
  strokeSketch,
  undoDrawing,
} from "../store/workspace/actions";

// 画板代码只在打开时才需要，不进首屏 chunk
const loadInpaintModal = () => import("../components/InpaintModal");
const loadSketchModal = () => import("../components/SketchModal");
const InpaintModal = lazy(() =>
  loadInpaintModal().then((m) => ({ default: m.InpaintModal })),
);
const SketchModal = lazy(() =>
  loadSketchModal().then((m) => ({ default: m.SketchModal })),
);

export function DrawingLayer() {
  const { t } = useTranslation();
  const drawing = useWorkspace((s) => s.drawing);
  const inpaintBaseUrl = useObjectUrl(
    drawing?.kind === "inpaint" ? drawing.base.blob : null,
  );

  // 首屏之后空闲时预取两个画板 chunk，首次打开不用等网络；挂载期间一次性，卸载时取消
  useEffect(() => {
    const prefetch = () => {
      void loadSketchModal();
      void loadInpaintModal();
    };
    if (typeof requestIdleCallback === "function") {
      const id = requestIdleCallback(prefetch);
      return () => cancelIdleCallback(id);
    }
    const id = setTimeout(prefetch, 2000);
    return () => clearTimeout(id);
  }, []);

  return (
    <Suspense fallback={null}>
      {drawing?.kind === "sketch" && (
        <SketchModal
          key={drawing.id}
          doc={drawing.doc}
          cursor={drawing.cursor}
          origin={drawing.origin}
          confirming={drawing.confirming}
          onStroke={strokeSketch}
          onClear={() => strokeSketch({ type: "clear" })}
          onUndo={undoDrawing}
          onRedo={redoDrawing}
          onConfirm={confirmSketch}
          onRequestClose={requestCloseSketch}
          onLimit={notifyDrawLimit}
        />
      )}
      {drawing?.kind === "inpaint" && inpaintBaseUrl && (
        <InpaintModal
          key={drawing.id}
          baseUrl={inpaintBaseUrl}
          naming={drawing.naming}
          baseW={drawing.base.width}
          baseH={drawing.base.height}
          normalized={drawing.normalized}
          doc={drawing.doc}
          cursor={drawing.cursor}
          confirming={drawing.confirming}
          error={drawing.error}
          onStroke={strokeMask}
          onClear={() => strokeMask({ type: "clear" })}
          onUndo={undoDrawing}
          onRedo={redoDrawing}
          onConfirm={confirmInpaint}
          onRequestClose={requestCloseInpaint}
          onLimit={notifyDrawLimit}
        />
      )}
      {drawing?.kind === "opening" && (
        <p className="pm-saving" role="status">
          {t("status.openingBase")}
        </p>
      )}
    </Suspense>
  );
}
