/** GIF 工作台领域类型与限制：纯类型/常量，不依赖 React、store 或 db。
 *  时间统一毫秒；图层 x/y 为中心点的画布归一化坐标（0..1），width 为画布宽度占比。 */

export const GIF_DEFAULT_FPS = 10;
export const GIF_FPS_OPTIONS = [5, 10, 12.5, 15, 20, 25] as const;
export const GIF_MAX_FRAMES = 300;
export const GIF_MAX_SOURCE_MS = 60_000;
export const GIF_MAX_FILE_BYTES = 150 * 1024 * 1024;
export const GIF_MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const GIF_MAX_LAYERS = 20;
export const GIF_MAX_CANVAS_SIDE = 960;
export const GIF_DEFAULT_CANVAS_SIDE = 720;
export const GIF_MAX_GIF_LAYER_FRAMES = 120;
export const GIF_MAX_GIF_LAYER_SIDE = 640;
/** 所有 GIF 图层解码后的像素总量上限：约 96MB RGBA，超出就该拦住了 */
export const GIF_MAX_LAYER_PIXELS = 24_000_000;
export const GIF_MAX_GIF_BYTES = 20 * 1024 * 1024;
export const GIF_MAX_TEXT = 500;
export const GIF_IMAGE_DURATION_MS = 2000;
export const GIF_MIN_DELAY_MS = 20;
export const GIF_MAX_EXPORT_SIDE = 960;
export const GIF_DEFAULT_EXPORT_WIDTH = 480;
export const GIF_DEFAULT_COLORS = 256;
export const GIF_MAX_COLORS = 256;
export const GIF_DEFAULT_LOOP = 0;
export const GIF_TEXT_DEFAULT_SIZE = 0.075;
/** 描边宽度上限：字号的占比。中文笔画密，描边超过这个比例笔画会连成一块。 */
export const GIF_MAX_TEXT_STROKE = 0.06;
export const GIF_LAYER_DEFAULT_WIDTH = 0.32;
export const GIF_MIN_LAYER_WIDTH = 0.04;
export const GIF_MAX_LAYER_WIDTH = 1.6;
export const GIF_MIN_ZOOM = 0.5;
export const GIF_MAX_ZOOM = 3;
export const GIF_DEFAULT_TITLE = "GIF";
/** 项目缩略图统一用 JPEG 字节存 */
export const GIF_THUMB_MIME = "image/jpeg";

export type GifSourceKind = "video" | "gif" | "image";
export type GifDirection = "forward" | "reverse" | "boomerang";
export type GifFit = "contain" | "cover";
export type GifLayerKind = "image" | "gif" | "text" | "doodle";
export type GifFilterId = "none" | "vivid" | "mono" | "film" | "cool" | "warm";

/** 滤镜设置：预设 + 强度 + 手动微调 */
export interface GifFilterSettings {
  preset: GifFilterId;
  /** 预设强度 0..1 */
  intensity: number;
  /** 亮度 -1..1 */
  brightness: number;
  /** 对比度 -1..1 */
  contrast: number;
  /** 饱和度 -1..1 */
  saturation: number;
}
export type GifTextWeight = 400 | 600 | 700;
export type GifTextAlign = "left" | "center" | "right";

export type GifBackground =
  | { kind: "transparent" }
  | { kind: "solid"; color: string }
  | { kind: "gradient"; from: string; to: string };

export interface GifCanvas {
  width: number;
  height: number;
  fit: GifFit;
  zoom: number;
  offsetX: number;
  offsetY: number;
  rotate: 0 | 90 | 180 | 270;
  flipX: boolean;
  flipY: boolean;
  background: GifBackground;
  /** 整帧色彩滤镜；作用在底图与所有图层合成之后 */
  filter: GifFilterSettings;
}

export interface GifTimeline {
  /** 编辑器的源素材采样帧率；导出帧率独立设置，默认 10 */
  fps: number;
  trimStart: number;
  trimEnd: number;
  /** 0.2–5，只改变每帧延时，不改采样帧表 */
  speed: number;
  direction: GifDirection;
  /** 0 = 无限；1 = 播放一次 */
  loop: number;
  /** 采样帧下标；null = 全选。改 fps/裁剪区间时重置 */
  selected: number[] | null;
}

export interface GifSource {
  kind: GifSourceKind;
  assetId: string;
  width: number;
  height: number;
  durationMs: number;
}

export interface GifLayerBase {
  id: string;
  kind: GifLayerKind;
  /** 用户可改的显示名；为空时界面按类型和序号生成 */
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  /** 画布宽度占比 */
  width: number;
  /** 画布坐标中心点 */
  x: number;
  y: number;
  rotation: number;
  /** 项目时间轴上的入/出点，毫秒 */
  start: number;
  end: number;
}

export interface GifImageLayer extends GifLayerBase {
  kind: "image";
  assetId: string;
}

export interface GifGifLayer extends GifLayerBase {
  kind: "gif";
  assetId: string;
  /** true = 循环；false = 只播一次并停在末帧 */
  loop: boolean;
}

export interface GifTextLayer extends GifLayerBase {
  kind: "text";
  text: string;
  /** 画布宽度占比；实际字号 = fontSize × canvas.width */
  fontSize: number;
  color: string;
  weight: GifTextWeight;
  align: GifTextAlign;
  /** 描边颜色 */
  strokeColor: string;
  /** 描边宽度：字号的占比（0.06 = 6% 字号）。按字号算才不会把中文糊成一坨 */
  strokeWidth: number;
  /** transparent 表示不画底色 */
  backgroundColor: string;
  /** 内边距，画布宽度占比 */
  padding: number;
}

export interface GifDoodleLayer extends GifLayerBase {
  kind: "doodle";
  color: string;
  /** 笔刷粗细：画布宽度占比 */
  size: number;
  /** 每笔的归一化画布坐标 [x0,y0,x1,y1,…] */
  strokes: number[][];
}

export type GifLayer =
  GifImageLayer | GifGifLayer | GifTextLayer | GifDoodleLayer;

export interface GifExportSettings {
  width: number;
  /** 成品每秒采样数，不改变 timeline 的源帧选择或时长。 */
  fps: number;
  colors: number;
  loop: number;
  transparent: boolean;
  /** 目标体积（字节）；0 = 不限。超出时导出自动降档 */
  targetBytes: number;
}

export interface GifProject {
  id: string;
  title: string;
  source: GifSource;
  canvas: GifCanvas;
  timeline: GifTimeline;
  layers: GifLayer[];
  export: GifExportSettings;
  createdAt: number;
  updatedAt: number;
  /** 缩略图字节（JPEG）。存字节而不是 Blob：Safari 的 IndexedDB 存 Blob 会报
   *  "Error preparing Blob/File data to be stored in object store"，
   *  而项目文档每次自动保存都要整份重写，存 Blob 等于每写必败。 */
  thumbBytes?: Uint8Array<ArrayBuffer>;
  lastExportAssetId?: string;
  lastExportBytes?: number;
  lastExportWidth?: number;
  lastExportHeight?: number;
  lastExportFrames?: number;
  version: 2;
}

export interface GifAsset {
  id: string;
  projectId: string;
  kind: "source" | "image" | "gif" | "export";
  blob: Blob;
  mime: string;
  width: number;
  height: number;
  durationMs?: number;
  /** GIF 素材的帧数；用于估算解码后的内存占用 */
  frames?: number;
  name: string;
}

export type GifIssue =
  | "unsupported-type"
  | "unsupported-codec"
  | "file-too-large"
  | "too-long"
  | "read-failed"
  | "metadata-failed"
  | "no-frames"
  | "too-many-frames"
  | "decode-failed"
  | "gif-too-large"
  | "gif-too-many-frames"
  | "export-failed"
  | "cancelled"
  | "quota"
  | "missing-asset"
  | "cors"
  | "empty-text"
  | "text-too-long"
  | "too-many-layers"
  | "no-source"
  | "save-failed"
  | "load-failed";

/** 10/12.5 等帧率对应的实际延时；GIF 以 10ms 为单位 */
export function frameDelay(
  timeline: Pick<GifTimeline, "fps" | "speed">,
): number {
  const raw = 1000 / timeline.fps / Math.max(0.1, timeline.speed);
  return Math.max(GIF_MIN_DELAY_MS, Math.round(raw / 10) * 10);
}

/** 色板档位：画质优先 256、平衡 128、体积优先 64 */
export function colorsForQuality(
  quality: "high" | "balanced" | "small",
): number {
  return quality === "high" ? 256 : quality === "balanced" ? 128 : 64;
}
