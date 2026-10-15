import { describe, expect, it } from "vitest";
import { FIT_SKETCH_VIEW, pinchSketchViewport } from "./sketch-viewport";

const paper = { left: 50, top: 80, width: 200, height: 300 };
const center = { x: 150, y: 230 };

describe("草图编辑视图", () => {
  it("缩放保持双指中心下的纸面位置不变，并跟随双指平移", () => {
    const next = pinchSketchViewport(
      FIT_SKETCH_VIEW,
      center,
      { x: 170, y: 220 },
      2,
      paper,
    );
    expect(next).toEqual({ scale: 2, x: -80, y: -160 });
    expect((170 - paper.left - next.x) / next.scale).toBe(100);
    expect((220 - paper.top - next.y) / next.scale).toBe(150);
  });

  it("限制 1～4 倍，缩回适应屏幕时归位", () => {
    const enlarged = pinchSketchViewport(
      FIT_SKETCH_VIEW,
      center,
      center,
      20,
      paper,
    );
    expect(enlarged).toEqual({ scale: 4, x: -300, y: -450 });
    expect(pinchSketchViewport(enlarged, center, center, 0.01, paper)).toEqual(
      FIT_SKETCH_VIEW,
    );
  });

  it("平移两端不把纸面拖离初始可绘区域", () => {
    const start = { scale: 2, x: -100, y: -150 };
    expect(
      pinchSketchViewport(start, center, { x: 2000, y: 2000 }, 1, paper),
    ).toEqual({ scale: 2, x: 0, y: 0 });
    expect(
      pinchSketchViewport(start, center, { x: -2000, y: -2000 }, 1, paper),
    ).toEqual({ scale: 2, x: -200, y: -300 });
  });
});
