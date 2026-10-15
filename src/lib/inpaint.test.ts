import { describe, expect, it } from "vitest";
import {
  MASK_ALPHA_THRESHOLD,
  blankMask,
  checkInpaintBase,
  inpaintTargetSize,
  maskBrushRange,
  maskOutputAlpha,
  sizeReason,
  suggestInpaintSize,
  validateMaskDocument,
} from "./inpaint";
import { commitCommand as commitMaskCommand } from "./sketch";
import type { MaskDocument } from "./types";

describe("suggestInpaintSize（TECH §7 样例表）", () => {
  it("原尺寸合法直出", () => {
    expect(suggestInpaintSize(1024, 1024)).toEqual({ w: 1024, h: 1024 });
  });

  it("向下对齐 16 的倍数", () => {
    expect(suggestInpaintSize(1920, 1080)).toEqual({ w: 1920, h: 1072 });
    expect(suggestInpaintSize(3000, 2000)).toEqual({ w: 2992, h: 2000 });
  });

  it("短边入 2160 框保持比例（12 MP 样例）", () => {
    expect(suggestInpaintSize(4032, 3024)).toEqual({ w: 2880, h: 2160 });
    expect(suggestInpaintSize(3024, 4032)).toEqual({ w: 2160, h: 2880 });
  });

  it("方图受短边约束", () => {
    expect(suggestInpaintSize(3840, 3840)).toEqual({ w: 2160, h: 2160 });
  });

  it("横竖对称", () => {
    for (const [w, h] of [
      [1536, 1024],
      [1920, 1072],
      [2992, 2000],
    ]) {
      const a = suggestInpaintSize(w, h) as { w: number; h: number };
      const b = suggestInpaintSize(h, w) as { w: number; h: number };
      expect(a.w).toBe(b.h);
      expect(a.h).toBe(b.w);
    }
  });

  it("非法输入", () => {
    expect(suggestInpaintSize(6000, 4000)).toEqual({ err: "pixel-limit" });
    expect(suggestInpaintSize(1000, 100)).toEqual({ err: "ratio-limit" });
    expect(suggestInpaintSize(15, 16)).toEqual({ err: "invalid-dimensions" });
    expect(suggestInpaintSize(1.5, 1024)).toEqual({
      err: "invalid-dimensions",
    });
  });
});

describe("checkInpaintBase / inpaintTargetSize", () => {
  it("合法底图直出且不标记建议", () => {
    const t = inpaintTargetSize(1024, 768);
    expect(t).toMatchObject({ w: 1024, h: 768, suggested: false });
  });

  it("1920×1080 触发建议与原因文案", () => {
    const t = inpaintTargetSize(1920, 1080)!;
    expect(t).toMatchObject({ w: 1920, h: 1072, suggested: true });
    expect(t.reason).toEqual({ floor: "h", scaled: false });
  });

  it("12MP 入框原因", () => {
    const t = inpaintTargetSize(4032, 3024)!;
    expect(t.reason).toEqual({ floor: null, scaled: true });
  });

  it("超像素与超比例拦截（D2/Q10）", () => {
    expect(checkInpaintBase(6000, 4000)).toEqual({
      ok: false,
      issue: "pixel-limit",
    });
    expect(checkInpaintBase(2000, 200)).toEqual({
      ok: false,
      issue: "ratio-limit",
    });
    expect(inpaintTargetSize(6000, 4000)).toBeNull();
  });

  it("sizeReason 组合原因", () => {
    expect(sizeReason(1920, 1080)).toEqual({ floor: "h", scaled: false });
    expect(sizeReason(1024, 1024)).toEqual({ floor: null, scaled: false });
    expect(sizeReason(1000, 1000)).toEqual({ floor: "both", scaled: false });
    expect(sizeReason(1001, 1024)).toEqual({ floor: "w", scaled: false });
    expect(sizeReason(4096, 2304)).toEqual({ floor: null, scaled: true });
    expect(sizeReason(4000, 3000)).toEqual({ floor: "h", scaled: true });
  });
});

describe("maskBrushRange（IP-05）", () => {
  it("1024 短边 → 默认 34、范围 1–256", () => {
    expect(maskBrushRange(1024, 1024)).toEqual({
      min: 1,
      max: 256,
      initial: 34,
    });
    expect(maskBrushRange(1536, 1024)).toEqual({
      min: 1,
      max: 256,
      initial: 34,
    });
  });

  it("极小边不出界", () => {
    expect(maskBrushRange(16, 16)).toEqual({ min: 1, max: 4, initial: 1 });
  });
});

describe("validateMaskDocument", () => {
  const base = { ...blankMask("img-1", 1024, 768) };

  it("接受空文档与合法笔画", () => {
    expect(validateMaskDocument(base)).toEqual({ doc: base });
    const doc: MaskDocument = {
      ...base,
      commands: [
        { type: "stroke", tool: "pen", width: 34, points: [{ x: 1, y: 2 }] },
      ],
    };
    expect(validateMaskDocument(doc)).toEqual({ doc });
  });

  it("拒绝坏版本 / 缺底图绑定 / 坏尺寸 / 非命令序列", () => {
    expect(validateMaskDocument({ ...base, version: 2 })).toEqual({
      issue: "invalid-mask",
    });
    expect(validateMaskDocument({ ...base, baseImageId: "" })).toEqual({
      issue: "invalid-mask",
    });
    expect(validateMaskDocument({ ...base, width: Number.NaN })).toEqual({
      issue: "invalid-mask",
    });
    expect(
      validateMaskDocument({ ...base, width: Number.MAX_SAFE_INTEGER + 1 }),
    ).toEqual({
      issue: "invalid-mask",
    });
    expect(validateMaskDocument({ ...base, commands: "x" })).toEqual({
      issue: "invalid-mask",
    });
    expect(
      validateMaskDocument({
        ...base,
        commands: [{ type: "stroke", tool: "pen", width: 10 } as never],
      }),
    ).toEqual({ issue: "invalid-mask" });
  });

  it("拒绝形状命令：形状只属于草图", () => {
    expect(
      validateMaskDocument({
        ...base,
        commands: [
          {
            type: "shape",
            shape: "rect",
            fill: "solid",
            color: "#000",
            width: 8,
            from: { x: 0, y: 0 },
            to: { x: 10, y: 10 },
          },
        ],
      }),
    ).toEqual({ issue: "invalid-mask" });
    expect(
      validateMaskDocument({
        ...base,
        commands: [
          { type: "stroke", tool: "pen", width: 10, points: [{ x: 1, y: 1 }] },
          {
            type: "shape",
            shape: "line",
            fill: "none",
            color: "#000",
            width: 4,
            from: { x: 0, y: 0 },
            to: { x: 9, y: 9 },
          },
        ],
      }),
    ).toEqual({ issue: "invalid-mask" });
  });

  it("大底图尺寸不继承草图 3840 上限（TECH §6.2）", () => {
    const doc = blankMask("img-big", 4032, 3024);
    expect(validateMaskDocument(doc)).toEqual({ doc: doc });
  });
});

describe("coverage 二值语义（D5 / A52）", () => {
  it("0/127 → mask 255；128/255 → mask 0", () => {
    expect(maskOutputAlpha(0)).toBe(255);
    expect(maskOutputAlpha(127)).toBe(255);
    expect(maskOutputAlpha(128)).toBe(0);
    expect(maskOutputAlpha(255)).toBe(0);
    expect(MASK_ALPHA_THRESHOLD).toBe(128);
  });
});

describe("commitMaskCommand 撤销分支", () => {
  it("提交丢弃重做分支（A09）", () => {
    const stroke = {
      type: "stroke" as const,
      tool: "pen" as const,
      width: 10,
      points: [{ x: 0, y: 0 }],
    };
    let doc = blankMask("img-1", 64, 64);
    let cursor = 0;
    const first = commitMaskCommand(doc, cursor, stroke);
    expect(first).not.toBeNull();
    doc = first!.doc;
    cursor = first!.cursor;
    // 撤销后提交新命令：重做分支被丢弃
    const next = commitMaskCommand(doc, cursor - 1, {
      type: "clear",
    })!;
    expect(next.doc.commands).toHaveLength(1);
    expect(next.doc.commands[0].type).toBe("clear");
    expect(next.cursor).toBe(1);
  });
});
