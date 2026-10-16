/** 结果区：舞台、详情浮卡、轮播、灯箱与选区查看；把 store 与资源投影成展示组件的 props，操作交给 flows。
 *  副作用（都只在对应状态区间挂载，离开即移除）：
 *  - 舞台滚轮监听：selectCanWheelSwitch 成立期间
 *  - 离开页面前的浏览器确认：生成中与保存中（useLeaveGuard）
 *  - 窄屏判断：matchMedia，决定详情浮卡默认是否展开（useNarrowViewport）
 *  - 视口尺寸监听：多尺寸舞台显示期间（useViewportSize）
 *  - 多尺寸各格的 Object URL：生成中，卸载或格子内容变化时回收（useBlobUrls） */
import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { DetailCard, DetailToggle } from "../components/DetailCard";
import { Carousel } from "../components/overlays/Carousel";
import { Lightbox } from "../components/overlays/Lightbox";
import { Stage } from "../components/Stage";
import { copyPrompt, downloadAll, downloadImage } from "../flows/export";
import { openVideoFromImage } from "../flows/video";
import {
  adjustFromViewMask,
  openViewMask,
  startInpaintFromResult,
} from "../flows/drawing";
import { cancelGenerate } from "../flows/generate";
import {
  adjustInpaint,
  deleteRecord,
  editImage,
  editSelectedImage,
  newGeneration,
  reuseParams,
  switchByWheel,
  toggleStar,
} from "../flows/navigation";
import { useBlobUrls } from "../hooks/useBlobUrls";
import { useLeaveGuard } from "../hooks/useLeaveGuard";
import { useNarrowViewport } from "../hooks/useNarrowViewport";
import { useObjectUrl } from "../hooks/useObjectUrl";
import { useViewportSize } from "../hooks/useViewportSize";
import type { WorkspaceAssets } from "../hooks/useWorkspaceAssets";
import { sizeCaption } from "../i18n/labels";
import type { DisplaySlot } from "../lib/view-models";
import { useWorkspace } from "../store/workspace";
import {
  closeLightbox,
  closeViewMask,
  expandBar,
  openLightbox,
  setFocusIdx,
  setPreviewId,
} from "../store/workspace/actions";
import {
  selectCanWheelSwitch,
  selectRun,
  selectDisplayRun,
  selectBusy,
  selectGalleryVisible,
  selectSelectedImageId,
} from "../store/workspace/selectors";

// 选区查看弹层按需加载，不进首屏 chunk
const MaskViewModal = lazy(() =>
  import("../components/MaskViewModal").then((m) => ({
    default: m.MaskViewModal,
  })),
);

export function ResultArea({ assets }: { assets: WorkspaceAssets }) {
  const { display, sourceImages } = assets;
  // 查看已完成记录时，后台任务的进度不接管舞台、详情与轮播。
  const run = useWorkspace(selectRun);
  const displayRun = useWorkspace(selectDisplayRun);
  const gen = displayRun.phase === "generating" ? displayRun : null;
  const pending = run.phase !== "idle";
  const partialUrl = useObjectUrl(gen?.partial?.blob);
  // 多尺寸生成中：每格显示终稿或最新预览
  const slots = gen?.slots ?? null;
  const slotBlobs = useMemo(
    () => slots?.map((slot) => slot.final ?? slot.partial) ?? [],
    [slots],
  );
  const slotUrls = useBlobUrls(slotBlobs);
  const displaySlots = useMemo<DisplaySlot[] | null>(
    () =>
      slots?.map((slot, index) => ({
        size: slot.size,
        status: slot.status,
        url: slotUrls[index] ?? null,
        failure: slot.failure,
      })) ?? null,
    [slots, slotUrls],
  );
  const multiDone =
    !!display &&
    !gen &&
    !!display.row.params.sizes &&
    display.images.length > 1;
  const viewport = useViewportSize(!!slots || multiDone);
  const busy = useWorkspace(selectBusy);
  useLeaveGuard(busy);
  const selectedImageId = useWorkspace(selectSelectedImageId);
  const focusIdx = useWorkspace((s) => s.view.focusIdx);
  const lightboxId = useWorkspace((s) => s.view.lightboxId);
  const viewMask = useWorkspace((s) => s.view.viewMask);
  const viewMaskUrl = useObjectUrl(viewMask?.base.blob);
  const wheelEnabled = useWorkspace(selectCanWheelSwitch);
  /** 画廊占着舞台：空状态引导让位，舞台也不再画生成态（生成卡在画廊网格里） */
  const galleryVisible = useWorkspace(selectGalleryVisible);
  const selectedId = useWorkspace((s) => s.nav.selectedId);
  /** 详情浮卡、轮播、放大等只属于"用户点开的那条记录"，而不是刚保存的过渡结果 */
  const onDetail = !!selectedId && !!display;
  const narrow = useNarrowViewport();
  /** 宽屏：默认展开，收起按记录 id 记忆，换记录后重新出现。
   *  窄屏：默认收起（浮卡会盖住结果和工具条），只在用户点开的那条记录上展开 */
  const [detailClosedFor, setDetailClosedFor] = useState<string | null>(null);
  const [detailOpenedFor, setDetailOpenedFor] = useState<string | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const lightbox =
    display?.images.find((image) => image.id === lightboxId) ?? null;
  const detailVisible =
    onDetail &&
    !gen &&
    detailClosedFor !== display.row.id &&
    (!narrow || detailOpenedFor === display.row.id);

  // 舞台滚轮切换历史：规则见 canWheelSwitch，不满足时不挂监听
  useEffect(() => {
    const el = stageRef.current;
    if (!el || !wheelEnabled) return;
    let last = 0;
    const onWheel = (e: WheelEvent) => {
      if (e.defaultPrevented) return;
      e.preventDefault();
      const now = performance.now();
      if (now - last < 300 || Math.abs(e.deltaY) < 16) return;
      last = now;
      switchByWheel(e.deltaY);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [wheelEnabled]);

  return (
    <>
      <div className="pm-stage-col" ref={stageRef}>
        <Stage
          phase={gen ? "generating" : "idle"}
          hideEmpty={galleryVisible}
          hidden={galleryVisible}
          partial={
            gen?.partial && partialUrl
              ? { url: partialUrl, index: gen.partial.index }
              : null
          }
          genPlan={gen?.plan ?? null}
          slots={displaySlots}
          viewport={viewport}
          display={display}
          onFocus={setFocusIdx}
          onLightbox={openLightbox}
          onDownload={(index) => display && downloadImage(display, index)}
          onDownloadAll={() => display && downloadAll(display)}
          onReuse={() => display && reuseParams(display.row.id)}
          onEdit={pending ? undefined : editSelectedImage}
          onDelete={() => display && deleteRecord(display.row.id)}
          onCancel={() => cancelGenerate()}
          onStart={expandBar}
        />
      </div>

      {onDetail && !gen && narrow && !detailVisible && (
        <DetailToggle
          onOpen={() => {
            setDetailClosedFor(null);
            setDetailOpenedFor(display.row.id);
          }}
        />
      )}

      {onDetail && detailVisible && (
        <DetailCard
          display={display}
          selectedImageId={selectedImageId}
          canEdit={run.phase === "idle"}
          sources={sourceImages}
          onViewSource={setPreviewId}
          onDownload={() => downloadImage(display, focusIdx ?? 0)}
          onCopyPrompt={() => copyPrompt(display.row.prompt)}
          onReuse={() => reuseParams(display.row.id)}
          onEdit={editImage}
          onToVideo={(id) => void openVideoFromImage(id)}
          onInpaint={startInpaintFromResult}
          onViewMask={display.row.inpaint ? openViewMask : undefined}
          onAdjustInpaint={
            display.row.inpaint
              ? () => adjustInpaint(display.row.id)
              : undefined
          }
          onDelete={() => deleteRecord(display.row.id)}
          onToggleStar={() => toggleStar(display.row.id)}
          onNew={newGeneration}
          onClose={() => setDetailClosedFor(display.row.id)}
        />
      )}

      {onDetail && !gen && display.images.length > 1 && focusIdx !== null && (
        <Carousel
          img={display.images[focusIdx]}
          prompt={display.row.prompt}
          index={focusIdx}
          total={display.images.length}
          meta={
            display.row.params.sizes
              ? sizeCaption({
                  w: display.images[focusIdx].width,
                  h: display.images[focusIdx].height,
                })
              : undefined
          }
          onPrev={() => {
            const n = display.images.length;
            setFocusIdx((focusIdx - 1 + n) % n);
          }}
          onNext={() => {
            const n = display.images.length;
            setFocusIdx((focusIdx + 1) % n);
          }}
          onClose={() => setFocusIdx(null)}
          onZoom={() => openLightbox(display.images[focusIdx].id)}
          onDownload={() => downloadImage(display, focusIdx)}
          onReuse={() => reuseParams(display.row.id)}
          onEdit={pending ? undefined : editSelectedImage}
          onDelete={() => deleteRecord(display.row.id)}
        />
      )}

      <Lightbox
        img={lightbox}
        prompt={display?.row.prompt ?? ""}
        onDownload={() => {
          const index =
            display?.images.findIndex((image) => image.id === lightbox?.id) ??
            -1;
          if (display && index >= 0) downloadImage(display, index);
        }}
        onReuse={() => {
          closeLightbox();
          if (display) reuseParams(display.row.id);
        }}
        onClose={closeLightbox}
      />

      {viewMask && viewMaskUrl && (
        <Suspense fallback={null}>
          <MaskViewModal
            baseUrl={viewMaskUrl}
            baseW={viewMask.base.width}
            baseH={viewMask.base.height}
            commands={viewMask.commands}
            onAdjust={adjustFromViewMask}
            onClose={closeViewMask}
          />
        </Suspense>
      )}
    </>
  );
}
