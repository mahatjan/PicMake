import { describe, expect, it } from "vitest";
import {
  MULTI_GAP,
  MULTI_MIN_HEIGHT,
  layoutMulti,
  multiBox,
} from "./stage-layout";

const R = {
  "1:1": 1,
  "4:3": 4 / 3,
  "3:4": 3 / 4,
  "3:2": 3 / 2,
  "2:3": 2 / 3,
  "16:9": 16 / 9,
  "9:16": 9 / 16,
};
const aspects = (...ids: (keyof typeof R)[]) => ids.map((id) => R[id]);

/** 排版结果每一行的实际宽度 */
const rowWidths = (
  layout: ReturnType<typeof layoutMulti>,
  list: readonly number[],
) =>
  layout.rows.map(
    (row) =>
      row.reduce((sum, i) => sum + list[i] * layout.height, 0) +
      MULTI_GAP * (row.length - 1),
  );

describe("multiBox", () => {
  it("宽度取视口的 60%，但要让出右上角的详情浮卡；高度扣掉创作条、上下留白和说明行", () => {
    expect(multiBox({ w: 1920, h: 1080 })).toEqual({ w: 1152, h: 720 });
    // 1440 宽时 60% 是 864，会压到详情浮卡（左边缘 1156）：改取 1440 - 2 × 308
    expect(multiBox({ w: 1440, h: 900 })).toEqual({ w: 824, h: 540 });
  });

  it("窄屏详情浮卡默认收起：宽度用满屏宽，只留左右边距", () => {
    expect(multiBox({ w: 390, h: 844 }).w).toBe(362);
    expect(multiBox({ w: 760, h: 900 }).w).toBe(732);
  });

  it("很小的窗口也有下限", () => {
    const box = multiBox({ w: 200, h: 200 });
    expect(box.w).toBeGreaterThanOrEqual(280);
    expect(box.h).toBeGreaterThanOrEqual(200);
  });
});

describe("layoutMulti", () => {
  const box = multiBox({ w: 1440, h: 900 });

  it("3 个比例放得下就排成一行，按 chip 顺序", () => {
    const list = aspects("1:1", "16:9", "9:16");
    const layout = layoutMulti(list, box);
    expect(layout.rows).toEqual([[0, 1, 2]]);
    expect(layout.height).toBeGreaterThanOrEqual(MULTI_MIN_HEIGHT);
  });

  it("4 个横向比例一行太小，折成两行", () => {
    const list = aspects("1:1", "4:3", "3:2", "16:9");
    const layout = layoutMulti(list, box);
    expect(layout.rows).toEqual([
      [0, 1],
      [2, 3],
    ]);
    // 折行后格子比一行时更高
    const oneRow = (box.w - MULTI_GAP * 3) / list.reduce((a, b) => a + b, 0);
    expect(layout.height).toBeGreaterThan(oneRow);
  });

  it("4 个竖向比例一行就够高", () => {
    const layout = layoutMulti(aspects("3:4", "2:3", "9:16", "1:1"), box);
    expect(layout.rows).toHaveLength(1);
  });

  it("每一行都不超出可用宽度，也不超出可用高度（窄窗口不出现横向滚动）", () => {
    const sets = [
      aspects("1:1", "16:9"),
      aspects("1:1", "16:9", "9:16"),
      aspects("1:1", "4:3", "3:2", "16:9"),
      aspects("3:4", "2:3", "9:16", "1:1"),
      aspects("4:3", "3:2", "16:9"),
    ];
    for (const viewport of [
      { w: 1920, h: 1080 },
      { w: 1440, h: 900 },
      { w: 1280, h: 720 },
      { w: 900, h: 700 },
      { w: 600, h: 800 },
    ]) {
      const b = multiBox(viewport);
      for (const list of sets) {
        const layout = layoutMulti(list, b);
        for (const width of rowWidths(layout, list))
          expect(width, JSON.stringify([viewport, list])).toBeLessThanOrEqual(
            b.w + 1,
          );
        expect(layout.height).toBeGreaterThan(0);
        // 全部格子（含两行时的标注行）不超过可用高度
        expect(
          layout.rows.length * layout.height +
            (layout.rows.length - 1) * MULTI_GAP,
        ).toBeLessThanOrEqual(b.h);
        // 每个序号恰好出现一次，顺序不变
        expect(layout.rows.flat()).toEqual(list.map((_, i) => i));
      }
    }
  });

  it("只有一个格子时也能排", () => {
    expect(layoutMulti([1], box).rows).toEqual([[0]]);
  });
});
