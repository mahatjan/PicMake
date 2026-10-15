import type { SketchPoint } from "./types";

/** 编辑视图相对于「适应屏幕」纸面的变换，不进入文档或导出。 */
export interface SketchViewport {
  scale: number;
  x: number;
  y: number;
}

export const FIT_SKETCH_VIEW: SketchViewport = { scale: 1, x: 0, y: 0 };

/** 以双指中心为锚缩放，同时跟随中心平移；纸面始终覆盖初始可绘区域。 */
export function pinchSketchViewport(
  start: SketchViewport,
  from: SketchPoint,
  to: SketchPoint,
  ratio: number,
  paper: { left: number; top: number; width: number; height: number },
): SketchViewport {
  const scale = Math.min(4, Math.max(1, start.scale * ratio));
  const k = scale / start.scale;
  return {
    scale,
    x: Math.min(
      0,
      Math.max(
        paper.width * (1 - scale),
        to.x - paper.left - (from.x - paper.left - start.x) * k,
      ),
    ),
    y: Math.min(
      0,
      Math.max(
        paper.height * (1 - scale),
        to.y - paper.top - (from.y - paper.top - start.y) * k,
      ),
    ),
  };
}
