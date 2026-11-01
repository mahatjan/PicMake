/** 色键抠图：把接近指定颜色的像素变透明。纯函数，直接改 ImageData。 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

const clamp = (v: number, min: number, max: number) =>
  Math.min(max, Math.max(min, v));

/** #rgb / #rrggbb → RGB */
export function parseHexColor(hex: string): Rgb {
  const value = hex.trim().replace("#", "");
  const full =
    value.length === 3
      ? value
          .split("")
          .map((c) => c + c)
          .join("")
      : value;
  const num = Number.parseInt(full, 16);
  if (!Number.isFinite(num)) return { r: 255, g: 255, b: 255 };
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

/** 容差 0–100 映射到 RGB 空间的最大距离（RGB 最远距离约 441） */
export function toleranceToDistance(tolerance: number): number {
  return (clamp(tolerance, 0, 100) / 100) * 441;
}

/**
 * 就地处理像素：距离小于阈值的像素变透明，边缘做羽化。
 * tolerance 为百分比，feather 为过渡宽度（RGB 距离单位）。
 */
export function applyChromaKey(
  data: Uint8ClampedArray,
  key: Rgb,
  tolerance: number,
  feather = 24,
): void {
  const max = toleranceToDistance(tolerance);
  if (max <= 0) return;
  const edge = Math.max(1, Math.min(feather, max));
  const start = max - edge;
  for (let i = 0; i < data.length; i += 4) {
    const dr = data[i] - key.r;
    const dg = data[i + 1] - key.g;
    const db = data[i + 2] - key.b;
    const dist = Math.sqrt(dr * dr + dg * dg + db * db);
    if (dist >= max) continue;
    const ratio = dist <= start ? 0 : (dist - start) / edge;
    data[i + 3] = Math.round(data[i + 3] * ratio);
  }
}
