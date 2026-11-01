/** 导出降档：按目标体积估算并调整尺寸 / 色数 / 抽帧。纯函数，不碰 DOM。 */

const clamp = (v: number, min: number, max: number) =>
  Math.min(max, Math.max(min, v));

/** 调色板档位：从 256 逐级降到 16 */
const COLOR_LADDER = [256, 128, 64, 32, 16] as const;

/** 每像素码率（bit）：调色板越大越高。
 *  256 色按 4.5 bit/px 估——扁平色内容远低于此，高噪内容会高于此；
 *  真正兜底靠导出时用实测体积再降档（见 exportGif 的重试）。 */
function bitsPerPixel(colors: number): number {
  const c = clamp(Math.round(colors), 2, 256);
  return (4.5 * Math.log2(c)) / 8;
}

export interface GifSizeEstimate {
  width: number;
  height: number;
  frames: number;
  colors: number;
}

/** 画质预设：导出宽度 / 颜色数 / 目标体积的一组档位 */
export const GIF_QUALITY_PRESETS = [
  { id: "quality", width: 960, colors: 256, targetBytes: 0 },
  { id: "balanced", width: 480, colors: 128, targetBytes: 2 * 1024 * 1024 },
  { id: "small", width: 320, colors: 64, targetBytes: 1024 * 1024 },
] as const;

export type GifQualityPresetId = (typeof GIF_QUALITY_PRESETS)[number]["id"];

/** 当前导出设置最接近哪个预设 */
export function matchQualityPreset(input: {
  width: number;
  colors: number;
  targetBytes: number;
}): GifQualityPresetId | null {
  for (const preset of GIF_QUALITY_PRESETS) {
    if (
      Math.abs(preset.width - input.width) <= 20 &&
      preset.colors === input.colors &&
      preset.targetBytes === input.targetBytes
    )
      return preset.id;
  }
  return null;
}

/** 体积估算：偏保守（照片类内容接近实测，扁平色内容会偏大） */
export function estimateGifBytes(input: GifSizeEstimate): number {
  const frames = Math.max(1, Math.round(input.frames));
  const bpp = bitsPerPixel(input.colors);
  const perFrame = (input.width * input.height * bpp) / 8 + 64;
  return Math.round(frames * perFrame);
}

export interface GifExportPlanInput {
  width: number;
  height: number;
  frames: number;
  colors: number;
  /** 目标字节数；0 = 不限 */
  targetBytes: number;
  /** 上一次实际产出的字节数，用来修正估算偏差 */
  measuredBytes?: number;
}

export interface GifExportPlan {
  width: number;
  height: number;
  colors: number;
  /** 抽帧步长：1 = 不抽帧 */
  frameStep: number;
  frames: number;
  estimatedBytes: number;
  /** 是否相对原设置做过降档 */
  changed: boolean;
}

/**
 * 降档顺序：先降色数（画质损失最小）→ 再降尺寸 → 最后抽帧（保持总时长，靠延时补偿）。
 * 传入 measuredBytes 时按实测体积修正估算比例，二三次就能收敛。
 */
export function planGifExport(input: GifExportPlanInput): GifExportPlan {
  const target = Math.max(0, Math.round(input.targetBytes));
  const totalFrames = Math.max(1, Math.round(input.frames));
  let width = Math.max(16, Math.round(input.width));
  let height = Math.max(16, Math.round(input.height));
  let colors = clamp(Math.round(input.colors), 2, 256);
  let frameStep = 1;
  let frames = totalFrames;

  const estimate = () => estimateGifBytes({ width, height, frames, colors });
  const base = estimate();
  const measured = input.measuredBytes ?? 0;
  const factor = measured > 0 && base > 0 ? measured / base : 1;
  const current = () => Math.round(estimate() * factor);

  if (target > 0) {
    let estimateNow = current();
    // 1) 降色数
    for (const step of COLOR_LADDER) {
      if (estimateNow <= target) break;
      if (step >= colors) continue;
      colors = step;
      estimateNow = current();
    }
    // 2) 降尺寸（按面积比例，保留宽高比）
    if (estimateNow > target) {
      const ratio = Math.sqrt(target / estimateNow);
      width = Math.max(64, Math.round((width * ratio) / 4) * 4);
      height = Math.max(64, Math.round((height * ratio) / 4) * 4);
      estimateNow = current();
    }
    // 3) 抽帧：总时长不变，延时按步长补偿
    if (estimateNow > target && totalFrames > 4) {
      frameStep = clamp(Math.ceil(estimateNow / target), 1, 8);
      frames = Math.max(2, Math.ceil(totalFrames / frameStep));
    }
  }

  return {
    width,
    height,
    colors,
    frameStep,
    frames,
    estimatedBytes: current(),
    changed:
      width !== Math.round(input.width) ||
      height !== Math.round(input.height) ||
      colors !== Math.round(input.colors) ||
      frameStep > 1,
  };
}
