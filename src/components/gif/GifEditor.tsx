/** GIF 编辑器布局：顶栏、舞台、时间轴与图层/属性/画布面板。纯展示。 */
import { useEffect, useRef, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  Download,
  Pencil,
  Redo2,
  Undo2,
  Upload,
} from "lucide-react";
import type { DecodedGif } from "../../lib/gif/decode";
import type { GifRenderAssets } from "../../lib/gif/render";
import type { GifCanvas, GifLayer, GifProject } from "../../lib/gif/types";
import type { GifThumb } from "../../hooks/useGifThumbs";
import { GifStage } from "./GifStage";
import { GifTimeline } from "./GifTimeline";
import { GifCanvasPanel, GifInspector, GifLayersPanel } from "./GifSidePanel";
import type { GifTemplateId } from "../../lib/gif/templates";

export function GifEditor(props: {
  project: GifProject;
  /** 手机宽度：侧栏改成可收起的底部抽屉，预览区始终留在上方 */
  narrow: boolean;
  videoRef: RefObject<HTMLVideoElement | null>;
  sourceUrl: string | null;
  sourceImage: ImageBitmap | null;
  sourceGif: DecodedGif | null;
  render: GifRenderAssets;
  urls: Record<string, string>;
  thumbs: GifThumb[];
  time: number;
  playing: boolean;
  duration: number;
  frameCount: number;
  selectedLayerId: string | null;
  saving: boolean;
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onTitle: (title: string) => void;
  onToggle: () => void;
  onSeek: (time: number) => void;
  onTrim: (patch: Partial<GifProject["timeline"]>, record: boolean) => void;
  onSelectLayer: (id: string | null) => void;
  onBeginEdit: () => void;
  onEndEdit: () => void;
  onPatchLayer: (id: string, patch: Partial<GifLayer>, record: boolean) => void;
  onMoveLayer: (id: string, x: number, y: number) => void;
  onMoveDoodle: (id: string, dx: number, dy: number) => void;
  onRemoveLayer: (id: string) => void;
  onDuplicateLayer: (id: string) => void;
  onMoveLayerOrder: (id: string, delta: number) => void;
  onPatchCanvas: (patch: Partial<GifCanvas>, record: boolean) => void;
  onTemplate: (id: GifTemplateId) => void;
  onApplyChroma: (id: string, color: string, tolerance: number) => void;
  onApplyAiCutout: (id: string) => void;
  doodleMode: boolean;
  onToggleDoodle: () => void;
  onStroke: (points: number[]) => void;
  onAddText: () => void;
  onAddImage: () => void;
  onAddGif: () => void;
  onAddSticker: () => void;
  onOpenFrames: () => void;
  onOpenExport: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onBack: () => void;
  onDownload: () => void;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<"layers" | "props" | "canvas">("layers");
  /** 窄屏抽屉：收起后只留一条把手，把高度还给舞台 */
  const [drawerOpen, setDrawerOpen] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const selected =
    props.project.layers.find((layer) => layer.id === props.selectedLayerId) ??
    null;
  /** 舞台上双击文字后，让属性面板的内容输入框获得焦点 */
  const [textFocus, setTextFocus] = useState<{ id: string } | null>(null);
  const doodleLayer =
    props.project.layers.find((layer) => layer.kind === "doodle") ?? null;
  /** 上次渲染看到的选中项：只对「选中项真的变了」做响应，避免重复抢标签页 */
  const lastSelected = useRef(props.selectedLayerId);

  useEffect(() => {
    const id = props.selectedLayerId;
    if (id === lastSelected.current) return;
    lastSelected.current = id;
    if (!props.narrow || !id) return;
    // 涂鸦是画布上的持续模式，切到属性页会把「涂鸦」开关藏起来，所以留在图层页
    const layer = props.project.layers.find((item) => item.id === id);
    if (layer?.kind === "doodle") return;
    // 选中项变化时切到属性页。不碰抽屉开合：拖动舞台上的图层时抽屉突然弹出会改变画布尺寸
    // oxlint-disable-next-line react/set-state-in-effect
    setTab("props");
  }, [props.narrow, props.project.layers, props.selectedLayerId]);

  useEffect(() => {
    // 换标签页时回到顶部：属性内容很长，保留上一次的滚动位置会让人以为点错了
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [tab]);

  useEffect(() => {
    // 窄屏换选中图层时也回到顶部；桌面图层列表和属性共用滚动，不能跟着跳
    if (!props.narrow) return;
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [props.narrow, props.selectedLayerId]);

  /** 桌面没有「属性」页签：从窄屏切回来时把残留的 props 视作图层页 */
  const visibleTab = !props.narrow && tab === "props" ? "layers" : tab;

  const layersPanel = (
    <GifLayersPanel
      project={props.project}
      selectedId={props.selectedLayerId}
      urls={props.urls}
      doodleMode={props.doodleMode}
      onSelect={props.onSelectLayer}
      onToggleDoodle={props.onToggleDoodle}
      onToggleVisible={(id) => {
        const layer = props.project.layers.find((item) => item.id === id);
        if (layer) props.onPatchLayer(id, { visible: !layer.visible }, true);
      }}
      onToggleLock={(id) => {
        const layer = props.project.layers.find((item) => item.id === id);
        if (layer) props.onPatchLayer(id, { locked: !layer.locked }, true);
      }}
      onMove={props.onMoveLayerOrder}
      onDuplicate={props.onDuplicateLayer}
      onDelete={props.onRemoveLayer}
      onAddText={props.onAddText}
      onAddImage={props.onAddImage}
      onAddGif={props.onAddGif}
      onAddSticker={props.onAddSticker}
    />
  );
  const inspectorPanel = selected ? (
    <GifInspector
      key={selected.id}
      project={props.project}
      layer={selected}
      duration={props.duration}
      focusText={textFocus}
      onPatch={props.onPatchLayer}
      onBegin={props.onBeginEdit}
      onEnd={props.onEndEdit}
      onApplyChroma={props.onApplyChroma}
      onApplyAiCutout={props.onApplyAiCutout}
      onDelete={() => props.onRemoveLayer(selected.id)}
      onDuplicate={() => props.onDuplicateLayer(selected.id)}
      onToggleVisible={() =>
        props.onPatchLayer(selected.id, { visible: !selected.visible }, true)
      }
      onToggleLock={() =>
        props.onPatchLayer(selected.id, { locked: !selected.locked }, true)
      }
    />
  ) : (
    <p className="pm-gif-panel-empty">{t("gif.editor.noSelection")}</p>
  );
  const canvasPanel = (
    <GifCanvasPanel
      project={props.project}
      onPatch={props.onPatchCanvas}
      onTemplate={props.onTemplate}
      onBegin={props.onBeginEdit}
      onEnd={props.onEndEdit}
    />
  );
  return (
    <div className="pm-gif pm-gif-editor">
      <header className="pm-gif-editor-head">
        <button
          type="button"
          className="pm-gif-iconbtn"
          aria-label={t("gif.back")}
          onClick={props.onBack}
        >
          <ArrowLeft size={18} />
        </button>
        <input
          className="pm-gif-title"
          value={props.project.title}
          aria-label={t("gif.editor.projectTitle")}
          onChange={(event) => props.onTitle(event.target.value)}
        />
        <span className="pm-gif-save">
          {props.saving ? t("gif.saving") : props.dirty ? "" : t("gif.saved")}
        </span>
        <div className="pm-gif-head-actions">
          <button
            type="button"
            className="pm-gif-iconbtn"
            aria-label={t("gif.editor.undo")}
            disabled={!props.canUndo}
            onClick={props.onUndo}
          >
            <Undo2 size={16} />
          </button>
          <button
            type="button"
            className="pm-gif-iconbtn"
            aria-label={t("gif.editor.redo")}
            disabled={!props.canRedo}
            onClick={props.onRedo}
          >
            <Redo2 size={16} />
          </button>
          {props.project.lastExportAssetId && (
            <button
              type="button"
              className="pm-gif-iconbtn"
              aria-label={t("gif.export.download")}
              onClick={props.onDownload}
            >
              <Download size={16} />
            </button>
          )}
          <button
            type="button"
            className="pm-gif-primary"
            onClick={props.onOpenExport}
          >
            {t("gif.editor.export")}
          </button>
        </div>
      </header>

      <div className="pm-gif-editor-body">
        <div className="pm-gif-editor-main">
          <GifStage
            project={props.project}
            videoRef={props.videoRef}
            sourceUrl={props.sourceUrl}
            sourceImage={props.sourceImage}
            sourceGif={props.sourceGif}
            render={props.render}
            time={props.time}
            selectedLayerId={props.selectedLayerId}
            doodleMode={props.doodleMode}
            doodleLayer={doodleLayer}
            onStroke={props.onStroke}
            onSelectLayer={(id) => {
              props.onSelectLayer(id);
              // 桌面：选中后在右栏里显示属性；窄屏由选中项变化统一切到属性页
              if (id && !props.narrow) setTab("layers");
            }}
            onEditText={(id) => {
              props.onSelectLayer(id);
              setTab(props.narrow ? "props" : "layers");
              setDrawerOpen(true);
              setTextFocus({ id });
            }}
            onBeginEdit={props.onBeginEdit}
            onMoveLayer={props.onMoveLayer}
            onMoveDoodle={props.onMoveDoodle}
            onEndEdit={props.onEndEdit}
          />
          {/* 画笔开着的时候把状态说清楚：不然用户以为关掉了，画笔其实还在画 */}
          {props.doodleMode ? (
            <div className="pm-gif-stage-hint">
              <Pencil size={13} />
              {t("gif.doodle.penHint")}
            </div>
          ) : (
            props.project.layers.length === 0 && (
              <div className="pm-gif-stage-hint">
                <Upload size={13} />
                {t("gif.layers.empty")}
              </div>
            )
          )}
        </div>

        <aside
          className={"pm-gif-side" + (props.narrow ? " pm-gif-drawer" : "")}
          data-open={props.narrow ? drawerOpen : undefined}
        >
          {props.narrow && (
            <button
              type="button"
              className="pm-gif-drawer-grip"
              aria-expanded={drawerOpen}
              aria-controls="gif-side-panel"
              aria-label={
                drawerOpen
                  ? t("gif.editor.collapsePanel")
                  : t("gif.editor.expandPanel")
              }
              onClick={() => setDrawerOpen((open) => !open)}
            >
              <span aria-hidden="true" />
            </button>
          )}
          <div className="pm-gif-tabs">
            <button
              type="button"
              aria-pressed={visibleTab === "layers"}
              onClick={() => {
                setTab("layers");
                setDrawerOpen(true);
              }}
            >
              {t("gif.editor.layers")}
            </button>
            {props.narrow && (
              <button
                type="button"
                aria-pressed={visibleTab === "props"}
                onClick={() => {
                  setTab("props");
                  setDrawerOpen(true);
                }}
              >
                {t("gif.editor.properties")}
              </button>
            )}
            <button
              type="button"
              aria-pressed={visibleTab === "canvas"}
              onClick={() => {
                setTab("canvas");
                setDrawerOpen(true);
              }}
            >
              {t("gif.editor.canvas")}
            </button>
          </div>
          <div
            className="pm-gif-side-scroll"
            id="gif-side-panel"
            ref={scrollRef}
          >
            {visibleTab === "canvas" ? (
              canvasPanel
            ) : props.narrow ? (
              visibleTab === "props" ? (
                inspectorPanel
              ) : (
                layersPanel
              )
            ) : (
              <>
                {layersPanel}
                {inspectorPanel}
              </>
            )}
          </div>
        </aside>
      </div>

      <GifTimeline
        project={props.project}
        thumbs={props.thumbs}
        time={props.time}
        playing={props.playing}
        duration={props.duration}
        frameCount={props.frameCount}
        selectedLayerId={props.selectedLayerId}
        onToggle={props.onToggle}
        onSeek={props.onSeek}
        onTrim={props.onTrim}
        onPatchLayer={props.onPatchLayer}
        onBeginEdit={props.onBeginEdit}
        onEndEdit={props.onEndEdit}
        onSelectLayer={props.onSelectLayer}
        onOpenFrames={props.onOpenFrames}
      />
    </div>
  );
}
