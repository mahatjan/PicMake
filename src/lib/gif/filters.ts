/** 画布滤镜：4×5 色彩矩阵，预览与导出共用同一套实现。 */
import type { GifFilterId, GifFilterSettings } from "./types";

export type { GifFilterId, GifFilterSettings };

export interface GifFilterPreset {
  id: GifFilterId;
  /** 行主序 4×5 矩阵：R/G/B 各一行，最后一列是 0..1 的偏移量 */
  matrix: number[];
}

export const DEFAULT_FILTER: GifFilterSettings = {
  preset: "none",
  intensity: 1,
  brightness: 0,
  contrast: 0,
  saturation: 0,
};

const IDENTITY = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0];

/** 可选滤镜；none 是恒等矩阵 */
export const GIF_FILTERS: GifFilterPreset[] = [
  { id: "none", matrix: IDENTITY },
  // 鲜艳：饱和度 1.35 + 对比度 1.04
  {
    id: "vivid",
    matrix: [
      1.3265, -0.2603, -0.0262, 0, -0.02, -0.0776, 1.1438, -0.0262, 0, -0.02,
      -0.0776, -0.2603, 1.3778, 0, -0.02, 0, 0, 0, 1, 0,
    ],
  },
  // 黑白：亮度加权 + 对比度 1.08
  {
    id: "mono",
    matrix: [
      0.2296, 0.7724, 0.078, 0, -0.04, 0.2296, 0.7724, 0.078, 0, -0.04, 0.2296,
      0.7724, 0.078, 0, -0.04, 0, 0, 0, 1, 0,
    ],
  },
  // 胶片：棕调 + 轻微对比
  {
    id: "film",
    matrix: [
      0.7705, 0.3669, 0.0902, 0, -0.03, 0.1665, 0.9102, 0.0801, 0, -0.03,
      0.1297, 0.2547, 0.6455, 0, -0.03, 0, 0, 0, 1, 0,
    ],
  },
  // 冷色
  {
    id: "cool",
    matrix: [
      0.88, 0.04, 0, 0, 0, 0.02, 0.96, 0.02, 0, 0, 0, 0.1, 1.05, 0, 0, 0, 0, 0,
      1, 0,
    ],
  },
  // 暖色
  {
    id: "warm",
    matrix: [
      1.08, 0.06, 0, 0, 0, 0.02, 0.94, 0.02, 0, 0, 0, 0.02, 0.88, 0, 0, 0, 0, 0,
      1, 0,
    ],
  },
];

const clamp = (v: number, min: number, max: number) =>
  Math.min(max, Math.max(min, v));

/** 矩阵线性插值：t=0 恒等，t=1 完整预设 */
function lerpMatrix(a: number[], b: number[], t: number): number[] {
  if (t <= 0) return [...a];
  if (t >= 1) return [...b];
  return a.map((value, index) => value + (b[index] - value) * t);
}

/** 矩阵相乘（先应用 m1，再应用 m2） */
function composeMatrices(m1: number[], m2: number[]): number[] {
  const out = new Array(20).fill(0);
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 5; col++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        const a = m1[row * 5 + k];
        const b = k === 4 ? (col === 4 ? 1 : 0) : m2[k * 5 + col];
        if (a && b) sum += a * b;
      }
      if (row === 3 && col === 4) sum = 1;
      out[row * 5 + col] = sum;
    }
  }
  return out;
}

function saturationMatrix(s: number): number[] {
  return [
    0.213 + 0.787 * s,
    0.715 - 0.715 * s,
    0.072 - 0.072 * s,
    0,
    0,
    0.213 - 0.213 * s,
    0.715 + 0.285 * s,
    0.072 - 0.072 * s,
    0,
    0,
    0.213 - 0.213 * s,
    0.715 - 0.715 * s,
    0.072 + 0.928 * s,
    0,
    0,
    0,
    0,
    0,
    1,
    0,
  ];
}

function contrastMatrix(c: number): number[] {
  const k = 1 + c;
  const offset = 0.5 * (1 - k);
  return [
    k,
    0,
    0,
    0,
    offset,
    0,
    k,
    0,
    0,
    offset,
    0,
    0,
    k,
    0,
    offset,
    0,
    0,
    0,
    1,
    0,
  ];
}

function brightnessMatrix(b: number): number[] {
  const add = b * 255;
  return [1, 0, 0, 0, add, 0, 1, 0, 0, add, 0, 0, 1, 0, add, 0, 0, 0, 1, 0];
}

/** 由设置算出最终矩阵；预览与导出用同一份 */
export function filterMatrix(settings: GifFilterSettings): number[] {
  const preset = GIF_FILTERS.find((item) => item.id === settings.preset);
  let matrix = lerpMatrix(
    IDENTITY,
    preset?.matrix ?? IDENTITY,
    clamp(settings.intensity, 0, 1),
  );
  if (settings.saturation !== 0)
    matrix = composeMatrices(
      matrix,
      saturationMatrix(1 + clamp(settings.saturation, -1, 1)),
    );
  if (settings.contrast !== 0)
    matrix = composeMatrices(
      matrix,
      contrastMatrix(clamp(settings.contrast, -1, 1)),
    );
  if (settings.brightness !== 0)
    matrix = composeMatrices(
      matrix,
      brightnessMatrix(clamp(settings.brightness, -1, 1)),
    );
  return matrix;
}

/** 滤镜是否真的会改变画面 */
export function filterActive(settings: GifFilterSettings): boolean {
  if (settings.preset !== "none" && settings.intensity > 0) return true;
  return (
    Math.abs(settings.brightness) > 0.001 ||
    Math.abs(settings.contrast) > 0.001 ||
    Math.abs(settings.saturation) > 0.001
  );
}

/** 对画布整帧做色彩变换；只改 RGB，alpha 原样保留。
 *  预览每帧都会跑，所以把矩阵系数取到局部变量、循环体内不做属性查找。 */
export function applyColorMatrix(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  matrix: number[],
): void {
  if (width <= 0 || height <= 0) return;
  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;
  const m0 = matrix[0];
  const m1 = matrix[1];
  const m2 = matrix[2];
  const m4 = matrix[4] * 255;
  const m5 = matrix[5];
  const m6 = matrix[6];
  const m7 = matrix[7];
  const m9 = matrix[9] * 255;
  const m10 = matrix[10];
  const m11 = matrix[11];
  const m12 = matrix[12];
  const m14 = matrix[14] * 255;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    data[i] = m0 * r + m1 * g + m2 * b + m4;
    data[i + 1] = m5 * r + m6 * g + m7 * b + m9;
    data[i + 2] = m10 * r + m11 * g + m12 * b + m14;
  }
  ctx.putImageData(image, 0, 0);
}
