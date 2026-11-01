/** GIF 图层：创建、变换、文本排版、命中测试与排序。纯函数；文本度量用离屏 Canvas。 */
import { uuid } from "../uuid";
import {
  GIF_LAYER_DEFAULT_WIDTH,
  GIF_MAX_LAYER_WIDTH,
  GIF_MAX_TEXT,
  GIF_MAX_TEXT_STROKE,
  GIF_MIN_LAYER_WIDTH,
  GIF_TEXT_DEFAULT_SIZE,
  type GifCanvas,
  type GifDoodleLayer,
  type GifImageLayer,
  type GifGifLayer,
  type GifLayer,
  type GifTextLayer,
} from "./types";

export interface LayerAssetSize {
  width: number;
  height: number;
}

export interface LayerBox {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

const clamp = (v: number, min: number, max: number) =>
  Math.min(max, Math.max(min, v));

const FONT_STACK =
  '"Space Grotesk", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif';

let measureCanvas: HTMLCanvasElement | null = null;
function measureCtx(): CanvasRenderingContext2D | null {
  if (typeof document === "undefined") return null;
  if (!measureCanvas) measureCanvas = document.createElement("canvas");
  return measureCanvas.getContext("2d");
}

export function fontString(layer: GifTextLayer, canvasWidth: number): string {
  const size = Math.max(4, layer.fontSize * canvasWidth);
  return `${layer.weight} ${size}px ${FONT_STACK}`;
}

/** 按字符换行；保留显式换行。中文/英文都按字符边界断开，保证宽度可控。 */
export function wrapTextLines(
  text: string,
  maxWidth: number,
  ctx: CanvasRenderingContext2D,
): string[] {
  const result: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    if (!paragraph) {
      result.push("");
      continue;
    }
    let line = "";
    for (const ch of Array.from(paragraph)) {
      const next = line + ch;
      if (line && ctx.measureText(next).width > maxWidth) {
        result.push(line);
        line = ch;
      } else {
        line = next;
      }
    }
    if (line) result.push(line);
  }
  return result.length ? result : [""];
}

export interface TextLayout {
  lines: string[];
  fontSize: number;
  lineHeight: number;
  boxWidth: number;
  boxHeight: number;
  padding: number;
  maxLineWidth: number;
}

export function layoutTextLayer(
  layer: GifTextLayer,
  canvas: Pick<GifCanvas, "width" | "height">,
): TextLayout {
  const ctx = measureCtx();
  const fontSize = Math.max(4, layer.fontSize * canvas.width);
  const padding = Math.max(0, layer.padding * canvas.width);
  const maxWidth = Math.max(fontSize, layer.width * canvas.width - padding * 2);
  if (!ctx) {
    return {
      lines: layer.text.split(/\r?\n/),
      fontSize,
      lineHeight: fontSize * 1.25,
      boxWidth: maxWidth + padding * 2,
      boxHeight:
        fontSize * 1.25 * Math.max(1, layer.text.split(/\r?\n/).length) +
        padding * 2,
      padding,
      maxLineWidth: maxWidth,
    };
  }
  ctx.font = fontString(layer, canvas.width);
  const lines = wrapTextLines(layer.text || " ", maxWidth, ctx);
  const maxLineWidth = lines.reduce(
    (max, line) => Math.max(max, ctx.measureText(line).width),
    0,
  );
  const lineHeight = fontSize * 1.25;
  return {
    lines,
    fontSize,
    lineHeight,
    boxWidth: Math.max(fontSize, maxLineWidth) + padding * 2,
    boxHeight: lineHeight * Math.max(1, lines.length) + padding * 2,
    padding,
    maxLineWidth,
  };
}

export function layerBox(
  layer: GifLayer,
  canvas: Pick<GifCanvas, "width" | "height">,
  asset?: LayerAssetSize | null,
): LayerBox {
  if (layer.kind === "text") {
    const layout = layoutTextLayer(layer, canvas);
    return {
      x: layer.x * canvas.width,
      y: layer.y * canvas.height,
      width: layout.boxWidth,
      height: layout.boxHeight,
      rotation: layer.rotation,
    };
  }
  if (layer.kind === "doodle") {
    const bounds = doodleBounds(layer, canvas);
    return {
      x: bounds.x || layer.x * canvas.width,
      y: bounds.y || layer.y * canvas.height,
      width: Math.max(bounds.width, 1),
      height: Math.max(bounds.height, 1),
      rotation: 0,
    };
  }
  const width = Math.max(2, layer.width * canvas.width);
  const aspect =
    asset && asset.width > 0 && asset.height > 0
      ? asset.height / asset.width
      : 1;
  return {
    x: layer.x * canvas.width,
    y: layer.y * canvas.height,
    width,
    height: Math.max(2, width * aspect),
    rotation: layer.rotation,
  };
}

/** 点是否落在旋转后的矩形内 */
export function hitLayer(
  layer: GifLayer,
  canvas: Pick<GifCanvas, "width" | "height">,
  asset: LayerAssetSize | null | undefined,
  px: number,
  py: number,
  /** 笔迹的额外命中余量（画布像素） */
  slop = 0,
): boolean {
  if (layer.kind === "doodle") return hitDoodle(layer, canvas, px, py, slop);
  const box = layerBox(layer, canvas, asset);
  const angle = (-box.rotation * Math.PI) / 180;
  const dx = px - box.x;
  const dy = py - box.y;
  const lx = dx * Math.cos(angle) - dy * Math.sin(angle);
  const ly = dx * Math.sin(angle) + dy * Math.cos(angle);
  return Math.abs(lx) <= box.width / 2 && Math.abs(ly) <= box.height / 2;
}

export interface LayerHitOptions {
  /** 忽略入/出点：用于「双击文字直接编辑」，哪怕当前不在显示区间内 */
  ignoreTime?: boolean;
  /** 笔迹的额外命中余量（画布像素）：笔迹很细，手指点不准时要留余量 */
  slop?: number;
}

export function layerAtPoint(
  layers: readonly GifLayer[],
  canvas: Pick<GifCanvas, "width" | "height">,
  assets: Record<string, LayerAssetSize | undefined>,
  px: number,
  py: number,
  time: number,
  options: LayerHitOptions = {},
): GifLayer | null {
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i];
    if (!layer.visible) continue;
    if (!options.ignoreTime && (time < layer.start || time >= layer.end))
      continue;
    const asset =
      layer.kind === "text" || layer.kind === "doodle"
        ? null
        : assets[layer.assetId];
    if (hitLayer(layer, canvas, asset, px, py, options.slop)) return layer;
  }
  return null;
}

export function layerActive(layer: GifLayer, time: number): boolean {
  return layer.visible && time >= layer.start && time < layer.end;
}

/** 图层在时间轴上的入/出点窗口（毫秒） */
export interface LayerWindow {
  start: number;
  end: number;
}

/** 图层至少存在这么久；与 clampLayer 的下限保持一致 */
const MIN_WINDOW_MS = 100;

/** 把毫秒吸附到帧网格 */
export function snapTime(value: number, step: number): number {
  if (!Number.isFinite(value)) return 0;
  if (!Number.isFinite(step) || step <= 0) return Math.round(value);
  return Math.round(value / step) * step;
}

/** 入/出点收进 [0, duration]，并保证至少留一帧 */
export function fitLayerWindow(
  window: LayerWindow,
  duration: number,
  step: number,
): LayerWindow {
  const max = Math.max(MIN_WINDOW_MS, duration);
  const start = clamp(
    snapTime(window.start, step),
    0,
    Math.max(0, max - MIN_WINDOW_MS),
  );
  const end = clamp(snapTime(window.end, step), start + MIN_WINDOW_MS, max);
  return { start: Math.round(start), end: Math.round(end) };
}

/** 拖整条：保持时长整体平移，撞到两端就停住 */
export function moveLayerWindow(
  window: LayerWindow,
  pointerMs: number,
  grabMs: number,
  duration: number,
  step: number,
): LayerWindow {
  const length = Math.max(MIN_WINDOW_MS, window.end - window.start);
  const max = Math.max(MIN_WINDOW_MS, duration);
  const start = clamp(
    snapTime(pointerMs - grabMs, step),
    0,
    Math.max(0, max - length),
  );
  return { start: Math.round(start), end: Math.round(start + length) };
}

/** 拖左边缘：改入点 */
export function resizeLayerStart(
  window: LayerWindow,
  valueMs: number,
  duration: number,
  step: number,
): LayerWindow {
  return fitLayerWindow({ start: valueMs, end: window.end }, duration, step);
}

/** 拖右边缘：改出点 */
export function resizeLayerEnd(
  window: LayerWindow,
  valueMs: number,
  duration: number,
  step: number,
): LayerWindow {
  return fitLayerWindow({ start: window.start, end: valueMs }, duration, step);
}

export function clampLayer(layer: GifLayer, duration: number): GifLayer {
  const start = clamp(layer.start, 0, Math.max(0, duration - 100));
  const end = clamp(layer.end, start + 100, Math.max(start + 100, duration));
  const next: GifLayer = {
    ...layer,
    opacity: clamp(layer.opacity, 0, 1),
    width: clamp(layer.width, GIF_MIN_LAYER_WIDTH, GIF_MAX_LAYER_WIDTH),
    x: clamp(layer.x, -0.5, 1.5),
    y: clamp(layer.y, -0.5, 1.5),
    rotation: ((((layer.rotation + 180) % 360) + 360) % 360) - 180,
    start: Math.round(start),
    end: Math.round(end),
  };
  if (next.kind === "text") {
    return {
      ...next,
      strokeWidth: clamp(next.strokeWidth, 0, GIF_MAX_TEXT_STROKE),
    };
  }
  return next;
}

export function updateLayer(
  layers: readonly GifLayer[],
  id: string,
  patch: Partial<GifLayer>,
  duration: number,
): GifLayer[] {
  return layers.map((layer) =>
    layer.id === id
      ? clampLayer({ ...layer, ...patch } as GifLayer, duration)
      : layer,
  );
}

/**
 * 图层留在画布内的位置（归一化坐标）。
 * 画板只显示画布范围，出去的图层会被裁掉；而指针要落在图层上才抓得住，
 * 一旦拖出画布就再也拖不回来，所以位置一律卡在边界。
 * 图层比画布还大时只能停在画布中心，保证还有一部分留在画面里。
 */
export function clampLayerPosition(
  layer: GifLayer,
  canvas: Pick<GifCanvas, "width" | "height">,
  asset: LayerAssetSize | null | undefined,
): { x: number; y: number } {
  const box = layerBox(layer, canvas, asset);
  const halfWidth = box.width / 2;
  const halfHeight = box.height / 2;
  const centerX = layer.x * canvas.width;
  const centerY = layer.y * canvas.height;
  const x =
    box.width >= canvas.width
      ? canvas.width / 2
      : clamp(centerX, halfWidth, canvas.width - halfWidth);
  const y =
    box.height >= canvas.height
      ? canvas.height / 2
      : clamp(centerY, halfHeight, canvas.height - halfHeight);
  return { x: x / canvas.width, y: y / canvas.height };
}

/** 把图层卡在画布边界内；涂鸦笔迹是画布绝对坐标，不参与 */
export function clampLayerInCanvas(
  layer: GifLayer,
  canvas: Pick<GifCanvas, "width" | "height">,
  asset: LayerAssetSize | null | undefined,
): GifLayer {
  if (layer.kind === "doodle") return layer;
  const { x, y } = clampLayerPosition(layer, canvas, asset);
  if (x === layer.x && y === layer.y) return layer;
  return { ...layer, x, y } as GifLayer;
}

/**
 * 图片 / GIF 图层的宽度上限：按素材比例收进画布高度，
 * 新加的图层整块留在画布里，不会一上来就超出画面。
 */
export function fitLayerWidth(
  width: number,
  canvas: Pick<GifCanvas, "width" | "height">,
  asset: LayerAssetSize | null | undefined,
): number {
  if (!asset || asset.width <= 0 || asset.height <= 0) return width;
  const maxWidth =
    (canvas.height * asset.width) / (asset.height * canvas.width);
  return clamp(
    width,
    GIF_MIN_LAYER_WIDTH,
    Math.min(GIF_MAX_LAYER_WIDTH, maxWidth),
  );
}

export function removeLayer(
  layers: readonly GifLayer[],
  id: string,
): GifLayer[] {
  return layers.filter((layer) => layer.id !== id);
}

/** delta: -1 下移一层，+1 上移一层；数组末尾是最上层 */
export function moveLayer(
  layers: readonly GifLayer[],
  id: string,
  delta: number,
): GifLayer[] {
  const index = layers.findIndex((layer) => layer.id === id);
  if (index < 0) return [...layers];
  const next = clamp(index + delta, 0, layers.length - 1);
  if (next === index) return [...layers];
  const copy = [...layers];
  const [item] = copy.splice(index, 1);
  copy.splice(next, 0, item);
  return copy;
}

export function duplicateLayer(
  layers: readonly GifLayer[],
  id: string,
): GifLayer[] {
  const source = layers.find((layer) => layer.id === id);
  if (!source) return [...layers];
  const copy = {
    ...source,
    id: uuid(),
    name: source.name ? `${source.name} 2` : "",
    x: clamp(source.x + 0.03, -0.5, 1.5),
    y: clamp(source.y + 0.03, -0.5, 1.5),
  } as GifLayer;
  return [...layers, copy];
}

export function createImageLayer(opts: {
  assetId: string;
  name?: string;
  duration: number;
  width?: number;
}): GifImageLayer {
  return {
    id: uuid(),
    kind: "image",
    name: opts.name ?? "",
    assetId: opts.assetId,
    visible: true,
    locked: false,
    opacity: 1,
    width: opts.width ?? GIF_LAYER_DEFAULT_WIDTH,
    x: 0.5,
    y: 0.5,
    rotation: 0,
    start: 0,
    end: opts.duration,
  };
}

export function createGifLayer(opts: {
  assetId: string;
  name?: string;
  duration: number;
  width?: number;
}): GifGifLayer {
  return {
    id: uuid(),
    kind: "gif",
    name: opts.name ?? "",
    assetId: opts.assetId,
    visible: true,
    locked: false,
    opacity: 1,
    width: opts.width ?? GIF_LAYER_DEFAULT_WIDTH,
    x: 0.5,
    y: 0.5,
    rotation: 0,
    start: 0,
    end: opts.duration,
    loop: true,
  };
}

export function createTextLayer(opts: {
  text: string;
  duration: number;
}): GifTextLayer {
  return {
    id: uuid(),
    kind: "text",
    name: "",
    visible: true,
    locked: false,
    opacity: 1,
    width: 0.7,
    x: 0.5,
    y: 0.5,
    rotation: 0,
    start: 0,
    end: opts.duration,
    text: opts.text.slice(0, GIF_MAX_TEXT),
    fontSize: GIF_TEXT_DEFAULT_SIZE,
    color: "#000000",
    weight: 400,
    align: "center",
    strokeColor: "#FFFFFF",
    strokeWidth: 0,
    backgroundColor: "transparent",
    padding: 0.02,
  };
}

export function createDoodleLayer(opts: {
  duration: number;
  color?: string;
  size?: number;
}): GifDoodleLayer {
  return {
    id: uuid(),
    kind: "doodle",
    name: "",
    visible: true,
    locked: false,
    opacity: 1,
    width: 1,
    x: 0.5,
    y: 0.5,
    rotation: 0,
    start: 0,
    end: opts.duration,
    color: opts.color ?? "#FF9A62",
    size: opts.size ?? 0.012,
    strokes: [],
  };
}

/** GIF 图层解码后的像素占用（估算内存用） */
export function gifLayerPixelUsage(
  layers: readonly GifLayer[],
  assets: Record<
    string,
    { width: number; height: number; frames?: number } | undefined
  >,
): number {
  let total = 0;
  for (const layer of layers) {
    if (layer.kind !== "gif") continue;
    const asset = assets[layer.assetId];
    if (!asset) continue;
    const frames = Math.max(1, asset.frames ?? 1);
    total += Math.max(0, asset.width) * Math.max(0, asset.height) * frames;
  }
  return total;
}

/** 笔迹包围盒（归一化坐标）；没有笔迹时返回 null */
function doodleExtent(layer: GifDoodleLayer): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
} | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const points of layer.strokes) {
    for (let i = 0; i + 1 < points.length; i += 2) {
      const x = points[i];
      const y = points[i + 1];
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, maxX, minY, maxY };
}

/** 笔迹包围盒（画布像素）；没有笔迹时给一个空盒 */
export function doodleBounds(
  layer: GifDoodleLayer,
  canvas: Pick<GifCanvas, "width" | "height">,
): LayerBox {
  const extent = doodleExtent(layer);
  if (!extent) {
    return { x: 0, y: 0, width: 0, height: 0, rotation: 0 };
  }
  const minX = extent.minX * canvas.width;
  const maxX = extent.maxX * canvas.width;
  const minY = extent.minY * canvas.height;
  const maxY = extent.maxY * canvas.height;
  return {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
    rotation: 0,
  };
}

/** 涂鸦平移边界：最多移出画布半屏，同时至少留一点笔迹在画面内 */
const DOODLE_MARGIN = 0.5;
const DOODLE_KEEP = 0.02;

/** 单轴位移夹取；区间为空时退回中点 */
function clampDoodleDelta(delta: number, min: number, max: number): number {
  const low = Math.max(-DOODLE_MARGIN - min, DOODLE_KEEP - max);
  const high = Math.min(1 + DOODLE_MARGIN - max, 1 - DOODLE_KEEP - min);
  if (low > high) return (low + high) / 2;
  return Math.min(high, Math.max(low, delta));
}

/**
 * 平移涂鸦笔迹：笔迹存的是画布绝对归一化坐标，没有可平移的图层位置，
 * 所以移动图层 = 整体平移每一笔的坐标。
 */
export function translateDoodle(
  layer: GifDoodleLayer,
  dx: number,
  dy: number,
): GifDoodleLayer {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return layer;
  if (dx === 0 && dy === 0) return layer;
  const extent = doodleExtent(layer);
  if (!extent) return layer;
  const nextX = clampDoodleDelta(dx, extent.minX, extent.maxX);
  const nextY = clampDoodleDelta(dy, extent.minY, extent.maxY);
  if (nextX === 0 && nextY === 0) return layer;
  return {
    ...layer,
    strokes: layer.strokes.map((points) =>
      points.map((value, index) =>
        index % 2 === 0 ? value + nextX : value + nextY,
      ),
    ),
  };
}

/**
 * 点到笔迹的距离是否小于笔刷半径。
 * slop 是额外的命中余量（画布像素）：手机上画布被缩得很小，
 * 光靠笔刷半径手指根本点不准，得按屏幕留出余量。
 */
export function hitDoodle(
  layer: GifDoodleLayer,
  canvas: Pick<GifCanvas, "width" | "height">,
  px: number,
  py: number,
  slop = 0,
): boolean {
  const radius = Math.max(2, (layer.size * canvas.width) / 2) + slop;
  for (const points of layer.strokes) {
    if (points.length === 2) {
      const dx = points[0] * canvas.width - px;
      const dy = points[1] * canvas.height - py;
      if (dx * dx + dy * dy <= radius * radius) return true;
      continue;
    }
    for (let i = 0; i + 3 < points.length; i += 2) {
      const x0 = points[i] * canvas.width;
      const y0 = points[i + 1] * canvas.height;
      const x1 = points[i + 2] * canvas.width;
      const y1 = points[i + 3] * canvas.height;
      const vx = x1 - x0;
      const vy = y1 - y0;
      const len = vx * vx + vy * vy;
      const t =
        len === 0
          ? 0
          : Math.max(0, Math.min(1, ((px - x0) * vx + (py - y0) * vy) / len));
      const dx = px - (x0 + vx * t);
      const dy = py - (y0 + vy * t);
      if (dx * dx + dy * dy <= radius * radius) return true;
    }
  }
  return false;
}

export function textLayerEmpty(layer: GifTextLayer): boolean {
  return !layer.text.trim();
}
