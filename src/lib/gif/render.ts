/** GIF 合成：背景、底图、图片/GIF/文字图层。预览与导出共用同一套绘制逻辑。 */
import { fontString, layerBox, layerActive, layoutTextLayer } from "./layers";
import { applyColorMatrix, filterActive, filterMatrix } from "./filters";
import type {
  GifCanvas,
  GifDoodleLayer,
  GifLayer,
  GifProject,
  GifTextLayer,
} from "./types";
import { GIF_MAX_TEXT_STROKE } from "./types";

export interface GifFrameSet {
  frames: CanvasImageSource[];
  durations: number[];
  totalMs: number;
  width: number;
  height: number;
}

export interface GifRenderAsset {
  image?: CanvasImageSource;
  gif?: GifFrameSet;
  width: number;
  height: number;
}

export type GifRenderAssets = Record<string, GifRenderAsset | undefined>;

export interface RenderOptions {
  project: GifProject;
  /** 当前底图帧（视频当前帧、图片、GIF 当前帧） */
  sourceFrame: CanvasImageSource | null;
  /** 项目时间轴上的时间，毫秒 */
  time: number;
  assets: GifRenderAssets;
  /** 输出画布相对项目画布的缩放；导出尺寸与画布尺寸不同时传入 */
  scale?: number;
}

function fillBackground(
  ctx: CanvasRenderingContext2D,
  canvas: GifCanvas,
): void {
  const { width, height, background } = canvas;
  ctx.clearRect(0, 0, width, height);
  if (background.kind === "solid") {
    ctx.fillStyle = background.color;
    ctx.fillRect(0, 0, width, height);
    return;
  }
  if (background.kind === "gradient") {
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, background.from);
    gradient.addColorStop(1, background.to);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }
}

function drawBase(
  ctx: CanvasRenderingContext2D,
  canvas: GifCanvas,
  source: { width: number; height: number },
  frame: CanvasImageSource,
): void {
  const { width: W, height: H, fit, zoom, rotate, flipX, flipY } = canvas;
  const rotateSwap = rotate === 90 || rotate === 270;
  const fitW = rotateSwap ? H : W;
  const fitH = rotateSwap ? W : H;
  const sw = Math.max(1, source.width);
  const sh = Math.max(1, source.height);
  const contain = Math.min(fitW / sw, fitH / sh);
  const cover = Math.max(fitW / sw, fitH / sh);
  const scale = (fit === "cover" ? cover : contain) * Math.max(0.1, zoom);
  const dw = sw * scale;
  const dh = sh * scale;
  ctx.save();
  ctx.translate(W / 2 + canvas.offsetX * W, H / 2 + canvas.offsetY * H);
  ctx.rotate((rotate * Math.PI) / 180);
  ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
  ctx.drawImage(frame, -dw / 2, -dh / 2, dw, dh);
  ctx.restore();
}

/** 取 GIF 在 elapsedMs 时刻的帧。loop=true 按自身节奏循环播放；
 *  loop=false 表示不循环（到末尾后停在最后一帧），用于图层关闭循环的场景。 */
export function gifFrameAt(
  gif: GifFrameSet,
  elapsedMs: number,
  loop = true,
): CanvasImageSource | null {
  if (!gif.frames.length) return null;
  let t = Math.max(0, elapsedMs);
  const total = Math.max(1, gif.totalMs);
  if (loop) t %= total;
  else if (t >= total) return gif.frames[gif.frames.length - 1] ?? null;
  let cursor = 0;
  for (let i = 0; i < gif.frames.length; i++) {
    cursor += Math.max(10, gif.durations[i] ?? 100);
    if (t < cursor) return gif.frames[i];
  }
  return gif.frames[gif.frames.length - 1] ?? null;
}

function drawTextLayer(
  ctx: CanvasRenderingContext2D,
  layer: GifTextLayer,
  canvas: GifCanvas,
): void {
  const layout = layoutTextLayer(layer, canvas);
  const left = -layout.boxWidth / 2;
  const top = -layout.boxHeight / 2;
  if (layer.backgroundColor !== "transparent") {
    ctx.fillStyle = layer.backgroundColor;
    ctx.fillRect(left, top, layout.boxWidth, layout.boxHeight);
  }
  ctx.font = fontString(layer, canvas.width);
  ctx.textBaseline = "top";
  ctx.textAlign = layer.align;
  ctx.lineJoin = "round";
  const x =
    layer.align === "left"
      ? left + layout.padding
      : layer.align === "right"
        ? -left - layout.padding
        : 0;
  layout.lines.forEach((line, index) => {
    const y = top + layout.padding + index * layout.lineHeight;
    if (layer.strokeWidth > 0) {
      ctx.strokeStyle = layer.strokeColor;
      // 描边按字号比例画：中文笔画密，按画布宽度画会把小字连成一坨黑块
      ctx.lineWidth = Math.max(
        0.5,
        Math.min(layer.strokeWidth, GIF_MAX_TEXT_STROKE) * layout.fontSize,
      );
      ctx.strokeText(line, x, y);
    }
    ctx.fillStyle = layer.color;
    ctx.fillText(line, x, y);
  });
}

/** 涂鸦笔迹：归一化坐标 → 画布像素，圆头圆角 */
export function drawDoodleStrokes(
  ctx: CanvasRenderingContext2D,
  layer: GifDoodleLayer,
  canvas: Pick<GifCanvas, "width" | "height">,
  strokes: readonly number[][] = layer.strokes,
): void {
  if (!strokes.length) return;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = layer.color;
  ctx.lineWidth = Math.max(1, layer.size * canvas.width);
  for (const points of strokes) {
    if (points.length < 2) continue;
    if (points.length === 2) {
      ctx.beginPath();
      ctx.arc(
        points[0] * canvas.width,
        points[1] * canvas.height,
        ctx.lineWidth / 2,
        0,
        Math.PI * 2,
      );
      ctx.fillStyle = layer.color;
      ctx.fill();
      continue;
    }
    ctx.beginPath();
    ctx.moveTo(points[0] * canvas.width, points[1] * canvas.height);
    for (let i = 2; i + 1 < points.length; i += 2) {
      ctx.lineTo(points[i] * canvas.width, points[i + 1] * canvas.height);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function drawLayer(
  ctx: CanvasRenderingContext2D,
  layer: GifLayer,
  canvas: GifCanvas,
  assets: GifRenderAssets,
  time: number,
): void {
  if (layer.kind === "doodle") {
    // 笔迹用的是画布绝对坐标，不做平移
    ctx.save();
    ctx.globalAlpha = layer.opacity;
    drawDoodleStrokes(ctx, layer, canvas);
    ctx.restore();
    return;
  }
  const asset = layer.kind === "text" ? null : assets[layer.assetId];
  const box = layerBox(
    layer,
    canvas,
    asset ? { width: asset.width, height: asset.height } : null,
  );
  ctx.save();
  ctx.globalAlpha = layer.opacity;
  ctx.translate(box.x, box.y);
  ctx.rotate((layer.rotation * Math.PI) / 180);
  if (layer.kind === "text") {
    drawTextLayer(ctx, layer, canvas);
  } else if (layer.kind === "image") {
    if (asset?.image) {
      ctx.drawImage(
        asset.image,
        -box.width / 2,
        -box.height / 2,
        box.width,
        box.height,
      );
    }
  } else if (layer.kind === "gif" && asset?.gif) {
    const frame = gifFrameAt(asset.gif, time - layer.start, layer.loop);
    if (frame) {
      ctx.drawImage(
        frame,
        -box.width / 2,
        -box.height / 2,
        box.width,
        box.height,
      );
    }
  }
  ctx.restore();
}

export function renderProjectFrame(
  ctx: CanvasRenderingContext2D,
  opts: RenderOptions,
): void {
  const { project, sourceFrame, time, assets } = opts;
  const canvas = project.canvas;
  // 布局一律用项目画布的坐标，再整体缩放到输出画布：
  // 导出尺寸与画布尺寸不一致时（体积预设、目标体积降档）才不会画偏。
  const scale = Math.max(0.01, opts.scale ?? 1);
  ctx.save();
  ctx.scale(scale, scale);
  fillBackground(ctx, canvas);
  if (sourceFrame) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, canvas.width, canvas.height);
    ctx.clip();
    drawBase(ctx, canvas, project.source, sourceFrame);
    ctx.restore();
  }
  for (const layer of project.layers) {
    if (layerActive(layer, time)) drawLayer(ctx, layer, canvas, assets, time);
  }
  ctx.restore();
  if (filterActive(canvas.filter)) {
    // 滤镜作用在合成结果上：预览与导出一致；按输出像素处理，不受缩放影响
    applyColorMatrix(
      ctx,
      ctx.canvas.width,
      ctx.canvas.height,
      filterMatrix(canvas.filter),
    );
  }
}

/** 选中图层的描边与角点；只用于编辑预览，不进入导出 */
export function drawLayerSelection(
  ctx: CanvasRenderingContext2D,
  project: GifProject,
  layer: GifLayer,
  assets: GifRenderAssets,
): void {
  const asset =
    layer.kind === "image" || layer.kind === "gif"
      ? assets[layer.assetId]
      : null;
  const box = layerBox(
    layer,
    project.canvas,
    asset ? { width: asset.width, height: asset.height } : null,
  );
  ctx.save();
  ctx.translate(box.x, box.y);
  ctx.rotate((box.rotation * Math.PI) / 180);
  ctx.strokeStyle = "#FF9A62";
  ctx.lineWidth = Math.max(1.5, project.canvas.width / 480);
  ctx.setLineDash([6, 4]);
  ctx.strokeRect(-box.width / 2, -box.height / 2, box.width, box.height);
  ctx.setLineDash([]);
  ctx.fillStyle = "#FF9A62";
  const r = Math.max(3, project.canvas.width / 160);
  for (const [x, y] of [
    [-box.width / 2, -box.height / 2],
    [box.width / 2, -box.height / 2],
    [-box.width / 2, box.height / 2],
    [box.width / 2, box.height / 2],
  ]) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
