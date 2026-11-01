/** GIF 舞台：把当前帧 + 图层合成到 Canvas；拖动图层移动，点击选中。纯展示 + 本地指针状态。 */
import { useEffect, useRef, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import type { DecodedGif } from "../../lib/gif/decode";
import {
  drawDoodleStrokes,
  drawLayerSelection,
  gifFrameAt,
  renderProjectFrame,
  type GifRenderAssets,
} from "../../lib/gif/render";
import { layerAtPoint, type LayerAssetSize } from "../../lib/gif/layers";
import { sourceTimeAt } from "../../lib/gif/timeline";
import type { GifDoodleLayer, GifProject } from "../../lib/gif/types";

export function GifStage(props: {
  project: GifProject;
  videoRef: RefObject<HTMLVideoElement | null>;
  sourceUrl: string | null;
  sourceImage: ImageBitmap | null;
  sourceGif: DecodedGif | null;
  render: GifRenderAssets;
  time: number;
  selectedLayerId: string | null;
  /** 涂鸦模式：指针拖动画笔迹 */
  doodleMode: boolean;
  doodleLayer: GifDoodleLayer | null;
  onSelectLayer: (id: string | null) => void;
  /** 双击文字图层：请求编辑器聚焦内容输入框 */
  onEditText: (id: string) => void;
  onBeginEdit: () => void;
  onMoveLayer: (id: string, x: number, y: number) => void;
  /** 拖动涂鸦笔迹：位移是归一化画布坐标的增量 */
  onMoveDoodle: (id: string, dx: number, dy: number) => void;
  onEndEdit: () => void;
  onStroke: (points: number[]) => void;
}) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [nonce, setNonce] = useState(0);
  const [draft, setDraft] = useState<number[] | null>(null);
  /** 视图缩放：只影响屏幕显示，不改变导出尺寸 */
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{
    distance: number;
    zoom: number;
    midX: number;
    midY: number;
    x: number;
    y: number;
  } | null>(null);
  const drag = useRef<{
    id: string;
    /** layer：拖图层位置；doodle：平移笔迹 */
    kind: "layer" | "doodle";
    dx: number;
    dy: number;
    /** 上一次指针位置（画布像素），算笔迹位移增量用 */
    lastX: number;
    lastY: number;
  } | null>(null);

  const assetSizes: Record<string, LayerAssetSize> = {};
  for (const [id, asset] of Object.entries(props.render)) {
    if (asset) assetSizes[id] = { width: asset.width, height: asset.height };
  }

  /** 方形画板里按比例撑满：宽素材占满宽度，高的素材占满高度（另一边等比缩） */
  const fillStyle =
    props.project.canvas.width >= props.project.canvas.height
      ? { width: "100%" }
      : { height: "100%" };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { width, height } = props.project.canvas;
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let sourceFrame: CanvasImageSource | null = null;
    const video = props.videoRef.current;
    if (
      props.project.source.kind === "video" &&
      video &&
      video.readyState >= 2
    ) {
      sourceFrame = video;
    } else if (props.sourceImage) {
      sourceFrame = props.sourceImage;
    } else if (props.sourceGif) {
      sourceFrame = gifFrameAt(
        {
          frames: props.sourceGif.frames,
          durations: props.sourceGif.durations,
          totalMs: props.sourceGif.totalMs,
          width: props.sourceGif.width,
          height: props.sourceGif.height,
        },
        sourceTimeAt(props.project.timeline, props.time),
        true,
      );
    }
    try {
      renderProjectFrame(ctx, {
        project: props.project,
        sourceFrame,
        time: props.time,
        assets: props.render,
      });
      if (draft && props.doodleLayer)
        drawDoodleStrokes(ctx, props.doodleLayer, props.project.canvas, [
          draft,
        ]);
      const selected = props.project.layers.find(
        (layer) => layer.id === props.selectedLayerId,
      );
      if (selected)
        drawLayerSelection(ctx, props.project, selected, props.render);
    } catch {
      /* 素材正在替换，旧位图可能已被释放；下一帧会重绘 */
    }
  }, [
    draft,
    nonce,
    props.doodleLayer,
    props.project,
    props.render,
    props.selectedLayerId,
    props.sourceGif,
    props.sourceImage,
    props.time,
    props.videoRef,
  ]);

  const point = (event: { clientX: number; clientY: number }) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0, w: 1, h: 1, scale: 1 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
      w: canvas.width,
      h: canvas.height,
      /** 一个屏幕像素等于多少画布像素：画布被缩小时命中余量要跟着放大 */
      scale: rect.width ? canvas.width / rect.width : 1,
    };
  };

  /** 笔迹命中余量（屏幕像素）：手机上笔迹只有几个像素宽，得留手指余量 */
  const hitSlop = (scale: number) => 12 * scale;

  /** 涂鸦用的归一化坐标（0..1） */
  const normPoint = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    };
  };

  return (
    <div className="pm-gif-stage">
      {/* oxlint-disable react/refs -- 视频元素由播放 hook 持有，ref 只交给 DOM */}
      {props.sourceUrl && (
        <video
          ref={props.videoRef}
          src={props.sourceUrl}
          muted
          playsInline
          preload="auto"
          className="pm-gif-video"
          onLoadedData={() => setNonce((n) => n + 1)}
          onSeeked={() => setNonce((n) => n + 1)}
        />
      )}
      {/* oxlint-enable react/refs */}
      {/* 方形画板：内容按比例落在 1:1 画板内，非 1:1 时上下或左右留边 */}
      <div className="pm-gif-artboard">
        <canvas
          ref={canvasRef}
          className="pm-gif-canvas"
          style={{
            ...fillStyle,
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`,
          }}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            pointers.current.set(event.pointerId, {
              x: event.clientX,
              y: event.clientY,
            });
            if (pointers.current.size === 2) {
              // 双指：进入缩放，放弃当前的拖拽与笔迹
              drag.current = null;
              setDraft(null);
              const [a, b] = [...pointers.current.values()];
              pinch.current = {
                distance: Math.hypot(a.x - b.x, a.y - b.y) || 1,
                zoom: view.zoom,
                midX: (a.x + b.x) / 2,
                midY: (a.y + b.y) / 2,
                x: view.x,
                y: view.y,
              };
              return;
            }
            const p = point(event);
            if (props.doodleMode) {
              // 画笔模式只负责画：移动笔迹要先关掉铅笔（按钮高亮会提示当前状态）
              if (!props.doodleLayer) return;
              const n = normPoint(event);
              setDraft([n.x, n.y]);
              event.currentTarget.setPointerCapture(event.pointerId);
              return;
            }
            const hit = layerAtPoint(
              props.project.layers,
              props.project.canvas,
              assetSizes,
              p.x,
              p.y,
              props.time,
              { slop: hitSlop(p.scale) },
            );
            if (!hit) {
              props.onSelectLayer(null);
              return;
            }
            props.onSelectLayer(hit.id);
            if (hit.locked) return;
            if (hit.kind === "doodle") {
              // 涂鸦笔迹画在画布绝对坐标上：拖动 = 平移整组笔迹
              drag.current = {
                id: hit.id,
                kind: "doodle",
                dx: 0,
                dy: 0,
                lastX: p.x,
                lastY: p.y,
              };
              props.onBeginEdit();
              event.currentTarget.setPointerCapture(event.pointerId);
              return;
            }
            const centerX = hit.x * p.w;
            const centerY = hit.y * p.h;
            drag.current = {
              id: hit.id,
              kind: "layer",
              dx: p.x - centerX,
              dy: p.y - centerY,
              lastX: p.x,
              lastY: p.y,
            };
            props.onBeginEdit();
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const tracked = pointers.current.get(event.pointerId);
            if (tracked) {
              tracked.x = event.clientX;
              tracked.y = event.clientY;
            }
            const pinching = pinch.current;
            if (pinching && pointers.current.size >= 2) {
              const [a, b] = [...pointers.current.values()];
              const distance = Math.hypot(a.x - b.x, a.y - b.y) || 1;
              const zoom = Math.min(
                4,
                Math.max(1, pinching.zoom * (distance / pinching.distance)),
              );
              const midX = (a.x + b.x) / 2;
              const midY = (a.y + b.y) / 2;
              setView({
                zoom,
                x: pinching.x + (midX - pinching.midX),
                y: pinching.y + (midY - pinching.midY),
              });
              return;
            }
            const current = drag.current;
            // 抓住笔迹的拖动优先于画新的一笔
            if (current && current.kind === "doodle") {
              const p = point(event);
              // 笔迹坐标是归一化的画布绝对坐标，按指针增量平移
              const dx = (p.x - current.lastX) / p.w;
              const dy = (p.y - current.lastY) / p.h;
              current.lastX = p.x;
              current.lastY = p.y;
              props.onMoveDoodle(current.id, dx, dy);
              return;
            }
            if (props.doodleMode) {
              if (!draft) return;
              const n = normPoint(event);
              const last = draft[draft.length - 2];
              const lastY = draft[draft.length - 1];
              if (Math.abs(n.x - last) < 0.002 && Math.abs(n.y - lastY) < 0.002)
                return;
              setDraft([...draft, n.x, n.y]);
              return;
            }
            if (!current) return;
            const p = point(event);
            const x = (p.x - current.dx) / p.w;
            const y = (p.y - current.dy) / p.h;
            props.onMoveLayer(current.id, x, y);
          }}
          onPointerUp={(event) => {
            pointers.current.delete(event.pointerId);
            if (pointers.current.size < 2) pinch.current = null;
            // 抓住笔迹拖完：结束这次编辑，别再当成画的一笔
            if (drag.current && drag.current.kind === "doodle") {
              drag.current = null;
              props.onEndEdit();
              event.currentTarget.releasePointerCapture(event.pointerId);
              return;
            }
            if (props.doodleMode) {
              if (draft) {
                if (draft.length >= 4) props.onStroke(draft);
                setDraft(null);
              }
              event.currentTarget.releasePointerCapture(event.pointerId);
              return;
            }
            if (!drag.current) return;
            drag.current = null;
            props.onEndEdit();
            event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={(event) => {
            pointers.current.delete(event.pointerId);
            if (pointers.current.size < 2) pinch.current = null;
            drag.current = null;
            setDraft(null);
          }}
          onDoubleClick={(event) => {
            const p = point(event);
            const hit = layerAtPoint(
              props.project.layers,
              props.project.canvas,
              assetSizes,
              p.x,
              p.y,
              props.time,
              { ignoreTime: true, slop: hitSlop(p.scale) },
            );
            // 双击文字：进入文字编辑；其他情况沿用「双击重置视图」
            if (hit && hit.kind === "text") {
              props.onEditText(hit.id);
              return;
            }
            setView({ zoom: 1, x: 0, y: 0 });
          }}
        />
        {view.zoom > 1 && (
          <button
            type="button"
            className="pm-gif-stage-reset"
            onClick={() => setView({ zoom: 1, x: 0, y: 0 })}
          >
            {t("gif.stage.resetView")}
          </button>
        )}
      </div>
    </div>
  );
}
