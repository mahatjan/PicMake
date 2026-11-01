/** GIF 工作台容器：把 store、素材 hooks 与播放时钟投影成首页/编辑器 props；IO 交给 flows。 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GifAiSticker } from "../components/gif/GifAiSticker";
import { GifEditor } from "../components/gif/GifEditor";
import {
  GifAssetPicker,
  type GifWorkItem,
} from "../components/gif/GifAssetPicker";
import { GifExportSheet } from "../components/gif/GifExportSheet";
import { GifFrameSheet } from "../components/gif/GifFrameSheet";
import { GifHome, type GifHomeRow } from "../components/gif/GifHome";
import {
  addGifAiSticker,
  addGifLayerFile,
  addGifTextLayer,
  applyGifAiCutout,
  applyGifChromaKey,
  cancelGifExport,
  clearGifExportResult,
  clearGifProjects,
  deleteGifProject,
  downloadGifExport,
  exportGif,
  importGifFile,
  listGifWorkImages,
  leaveGifProject,
  openGifFromImage,
  openGifProject,
  saveGifProjectNow,
  type GifWorkImage,
} from "../flows/gif";
import { useBlobUrls } from "../hooks/useBlobUrls";
import { useGifAssets } from "../hooks/useGifAssets";
import { useGifPlayback } from "../hooks/useGifPlayback";
import { useGifFilmstrip, useGifFrameThumbs } from "../hooks/useGifThumbs";
import { useLeaveGuard } from "../hooks/useLeaveGuard";
import { useNarrowViewport } from "../hooks/useNarrowViewport";
import { useObjectUrl } from "../hooks/useObjectUrl";
import {
  outputDuration,
  outputFrameCount,
  selectedIndices,
  sourceFrameCount,
} from "../lib/gif/timeline";
import { createDoodleLayer } from "../lib/gif/layers";
import { GIF_THUMB_MIME } from "../lib/gif/types";
import { useWorkspace } from "../store/workspace";
import {
  addGifLayer,
  applyGifTemplate,
  appendGifStroke,
  beginGifEdit,
  closeGif,
  duplicateGifLayer,
  endGifEdit,
  invertGifFrames,
  moveGifDoodle,
  moveGifLayer,
  patchGifLayer,
  removeGifLayer,
  redoGif,
  resetGifExport,
  sampleGifFrames,
  selectAllGifFrames,
  setGifCanvas,
  setGifExport,
  setGifSelectedFrames,
  setGifTimeline,
  setGifTitle,
  toggleGifFrame,
  undoGif,
} from "../store/workspace/actions";

export function GifArea() {
  const open = useWorkspace((s) => s.view.gifOpen);
  const project = useWorkspace((s) => s.gif.project);
  const assets = useWorkspace((s) => s.gif.assets);
  const rows = useWorkspace((s) => s.gif.rows);
  const importJob = useWorkspace((s) => s.gif.importJob);
  const exportJob = useWorkspace((s) => s.gif.exportJob);
  const saving = useWorkspace((s) => s.gif.saving);
  const dirty = useWorkspace((s) => s.gif.dirty);
  const past = useWorkspace((s) => s.gif.history.past);
  const future = useWorkspace((s) => s.gif.history.future);
  const [framesOpen, setFramesOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [workOpen, setWorkOpen] = useState(false);
  const [doodleMode, setDoodleMode] = useState(false);
  const [stickerOpen, setStickerOpen] = useState(false);
  const [stickerBusy, setStickerBusy] = useState(false);
  const [works, setWorks] = useState<GifWorkImage[] | null>(null);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const layerCountRef = useRef(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const sourceInputRef = useRef<HTMLInputElement>(null);
  const layerInputRef = useRef<HTMLInputElement>(null);
  const projectRef = useRef(project);
  const dirtyRef = useRef(dirty);

  const assetView = useGifAssets(project, assets);
  const narrow = useNarrowViewport();
  const playback = useGifPlayback({
    project,
    sourceUrl: assetView.sourceUrl,
    videoRef,
  });
  const filmstrip = useGifFilmstrip(
    project,
    assetView.sourceUrl,
    assetView.sourceImage,
    assetView.sourceGif,
  );
  const frameThumbs = useGifFrameThumbs(
    project,
    assetView.sourceUrl,
    assetView.sourceImage,
    assetView.sourceGif,
    framesOpen,
  );

  /** 首页缩略图：库里存的是字节，这里还原成 Blob 交给 Object URL */
  const homeThumbs = useMemo(
    () =>
      rows?.map((row) =>
        row.thumbBytes
          ? new Blob([row.thumbBytes], { type: GIF_THUMB_MIME })
          : null,
      ) ?? [],
    [rows],
  );
  const homeUrls = useBlobUrls(homeThumbs);

  const workBlobs = useMemo(
    () => (works ?? []).map((work) => work.blob),
    [works],
  );
  const workUrls = useBlobUrls(workBlobs);
  const workItems: GifWorkItem[] = useMemo(
    () =>
      (works ?? []).map((work, index) => ({
        id: work.id,
        url: workUrls[index] ?? null,
        width: work.width,
        height: work.height,
        prompt: work.prompt,
      })),
    [works, workUrls],
  );
  const homeRows: GifHomeRow[] | null = useMemo(
    () =>
      rows?.map((row) => ({
        id: row.id,
        title: row.title,
        updatedAt: row.updatedAt,
        frames: outputFrameCount(row.timeline),
        duration: outputDuration(row.timeline),
        thumbUrl: homeUrls[rows.indexOf(row)] ?? null,
      })) ?? null,
    [rows, homeUrls],
  );

  const exportBlob = project?.lastExportAssetId
    ? assets[project.lastExportAssetId]?.blob
    : undefined;
  const exportUrl = useObjectUrl(exportBlob);

  const selectedFrames = useMemo(
    () => new Set(project ? selectedIndices(project.timeline) : []),
    [project],
  );
  const totalFrames = project ? sourceFrameCount(project.timeline) : 0;
  const duration = project ? outputDuration(project.timeline) : 0;
  const frameCount = project ? outputFrameCount(project.timeline) : 0;

  const backToHome = leaveGifProject;

  const openWorkPicker = useCallback(() => {
    setWorkOpen(true);
    setWorks(null);
    void listGifWorkImages()
      .then((items) => setWorks(items))
      .catch(() => setWorks([]));
  }, []);

  const pickWork = useCallback((id: string) => {
    setWorkOpen(false);
    setWorks(null);
    void openGifFromImage(id);
  }, []);

  /** 涂鸦模式：没有涂鸦图层就新建一个并选中 */
  const toggleDoodle = useCallback(() => {
    if (doodleMode) {
      setDoodleMode(false);
      return;
    }
    const current = useWorkspace.getState().gif.project;
    if (!current) return;
    const existing = [...current.layers]
      .reverse()
      .find((layer) => layer.kind === "doodle");
    if (existing) setSelectedLayerId(existing.id);
    else {
      const layer = createDoodleLayer({
        duration: Math.max(100, outputDuration(current.timeline)),
      });
      if (addGifLayer(layer)) setSelectedLayerId(layer.id);
    }
    setDoodleMode(true);
  }, [doodleMode]);

  const doodleLayerId = useMemo(
    () => project?.layers.find((layer) => layer.kind === "doodle")?.id ?? null,
    [project],
  );

  const addStroke = useCallback(
    (points: number[]) => {
      if (!doodleLayerId) return;
      appendGifStroke(doodleLayerId, points);
    },
    [doodleLayerId],
  );

  useEffect(() => {
    projectRef.current = project;
  }, [project]);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  useLeaveGuard(!!exportJob || dirty);

  useEffect(() => {
    // 切换项目时重置本地 UI 状态（弹层/选中图层），属于外部状态同步
    // oxlint-disable-next-line react/set-state-in-effect
    setFramesOpen(false);
    setExportOpen(false);
    setSelectedLayerId(null);
    layerCountRef.current = 0;
  }, [project?.id]);

  const layerCount = project?.layers.length ?? 0;
  useEffect(() => {
    if (project && layerCount > layerCountRef.current)
      setSelectedLayerId(project.layers[project.layers.length - 1]?.id ?? null);
    layerCountRef.current = layerCount;
  }, [layerCount, project]);

  useEffect(() => {
    if (!project || !dirty || exportJob?.status === "running") return;
    const timer = window.setTimeout(() => {
      void saveGifProjectNow(project);
    }, 700);
    return () => window.clearTimeout(timer);
  }, [dirty, exportJob?.status, project]);

  useEffect(() => {
    return () => {
      const current = projectRef.current;
      if (current && dirtyRef.current) void saveGifProjectNow(current);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (workOpen) {
        setWorkOpen(false);
        return;
      }
      if (framesOpen) {
        setFramesOpen(false);
        return;
      }
      if (exportOpen) {
        if (exportJob?.status !== "running") {
          setExportOpen(false);
          clearGifExportResult();
        }
        return;
      }
      if (useWorkspace.getState().confirm) return;
      if (project) void backToHome();
      else closeGif();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [
    backToHome,
    exportJob?.status,
    exportOpen,
    framesOpen,
    open,
    project,
    workOpen,
  ]);

  if (!open) return null;

  const openSourcePicker = (kind: "video" | "gif" | "image") => {
    const input = sourceInputRef.current;
    if (!input) return;
    input.accept =
      kind === "video"
        ? "video/*"
        : kind === "gif"
          ? "image/gif"
          : "image/png,image/jpeg,image/webp,image/avif";
    input.value = "";
    input.click();
  };

  const openLayerPicker = (kind: "image" | "gif") => {
    const input = layerInputRef.current;
    if (!input) return;
    input.accept =
      kind === "gif"
        ? "image/gif"
        : "image/png,image/jpeg,image/webp,image/avif";
    input.value = "";
    input.click();
  };

  const share = async () => {
    if (!project?.lastExportAssetId) return;
    const asset = assets[project.lastExportAssetId];
    if (!asset) return;
    const file = new File([asset.blob], `${project.title || "PicMake"}.gif`, {
      type: "image/gif",
    });
    try {
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: project.title });
        return;
      }
    } catch {
      /* 用户取消或系统不支持，回退下载 */
    }
    downloadGifExport();
  };

  return (
    <>
      <input
        ref={sourceInputRef}
        type="file"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.currentTarget.value = "";
          void importGifFile(file);
        }}
      />
      <input
        ref={layerInputRef}
        type="file"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.currentTarget.value = "";
          void addGifLayerFile(file);
        }}
      />

      {!project ? (
        <GifHome
          rows={homeRows}
          importJob={importJob}
          onImport={openSourcePicker}
          onPickWork={openWorkPicker}
          onOpen={(id) => void openGifProject(id)}
          onDelete={deleteGifProject}
          onClear={clearGifProjects}
          onClose={closeGif}
        />
      ) : (
        <>
          <GifEditor
            project={project}
            narrow={narrow}
            videoRef={videoRef}
            sourceUrl={assetView.sourceUrl}
            sourceImage={assetView.sourceImage}
            sourceGif={assetView.sourceGif}
            render={assetView.render}
            urls={assetView.urls}
            thumbs={filmstrip.thumbs}
            time={playback.time}
            playing={playback.playing}
            duration={duration}
            frameCount={frameCount}
            selectedLayerId={selectedLayerId}
            saving={saving}
            dirty={dirty}
            canUndo={past.length > 0}
            canRedo={future.length > 0}
            onTitle={setGifTitle}
            onToggle={playback.toggle}
            onSeek={playback.seek}
            onTrim={setGifTimeline}
            onSelectLayer={setSelectedLayerId}
            onBeginEdit={beginGifEdit}
            onEndEdit={endGifEdit}
            onPatchLayer={patchGifLayer}
            onMoveLayer={(id, x, y) => patchGifLayer(id, { x, y }, false)}
            onMoveDoodle={moveGifDoodle}
            onRemoveLayer={(id) => {
              removeGifLayer(id);
              if (selectedLayerId === id) setSelectedLayerId(null);
            }}
            onDuplicateLayer={duplicateGifLayer}
            onMoveLayerOrder={moveGifLayer}
            onPatchCanvas={setGifCanvas}
            onTemplate={applyGifTemplate}
            onApplyChroma={(id, color, tolerance) =>
              void applyGifChromaKey(id, color, tolerance)
            }
            onApplyAiCutout={(id) => void applyGifAiCutout(id)}
            doodleMode={doodleMode}
            onToggleDoodle={toggleDoodle}
            onStroke={addStroke}
            onAddText={addGifTextLayer}
            onAddImage={() => openLayerPicker("image")}
            onAddGif={() => openLayerPicker("gif")}
            onAddSticker={() => setStickerOpen(true)}
            onOpenFrames={() => setFramesOpen(true)}
            onOpenExport={() => setExportOpen(true)}
            onUndo={undoGif}
            onRedo={redoGif}
            onBack={() => void backToHome()}
            onDownload={downloadGifExport}
          />
          {framesOpen && (
            <GifFrameSheet
              project={project}
              thumbs={frameThumbs.thumbs}
              loading={frameThumbs.loading}
              selected={selectedFrames}
              total={totalFrames}
              onToggle={toggleGifFrame}
              onSelectAll={selectAllGifFrames}
              onClear={() => setGifSelectedFrames([])}
              onInvert={invertGifFrames}
              onSample={sampleGifFrames}
              onClose={() => setFramesOpen(false)}
            />
          )}
          {exportOpen && (
            <GifExportSheet
              project={project}
              job={exportJob}
              exportUrl={exportUrl}
              onPatch={(patch) => setGifExport(patch)}
              onExport={() => void exportGif(assetView.sourceUrl)}
              onCancel={cancelGifExport}
              onClose={() => {
                setExportOpen(false);
                clearGifExportResult();
              }}
              onDownload={downloadGifExport}
              onShare={() => void share()}
              onReset={resetGifExport}
              onAgain={() => {
                setExportOpen(false);
                void backToHome();
              }}
            />
          )}
        </>
      )}
      {workOpen && (
        <GifAssetPicker
          items={workItems}
          loading={works === null}
          onPick={pickWork}
          onClose={() => {
            setWorkOpen(false);
            setWorks(null);
          }}
        />
      )}
      {stickerOpen && (
        <GifAiSticker
          busy={stickerBusy}
          onGenerate={(prompt) => {
            setStickerBusy(true);
            void addGifAiSticker(prompt).then((ok) => {
              setStickerBusy(false);
              if (ok) setStickerOpen(false);
            });
          }}
          onClose={() => setStickerOpen(false)}
        />
      )}
    </>
  );
}
