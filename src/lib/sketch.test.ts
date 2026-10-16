import { describe, expect, it } from "vitest";
import {
  SKETCH_MAX_COMMANDS,
  SKETCH_TEXT_MAX_CHARS,
  arrowHead,
  blankSketch,
  clampToCanvas,
  commitCommand,
  constrainShapeEnd,
  eraserWidth,
  freezeSketch,
  makeShape,
  makeStroke,
  normalizeBox,
  penWidth,
  ratioMismatch,
  shapeFitsMinSize,
  sketchSnapshotKey,
  toLogicalPoint,
  totalPoints,
  textSize,
  validateSketchDocument,
  resolveSketchCommands,
  transformSketchText,
  resizeSketchText,
} from "./sketch";
import type {
  SketchCommand,
  SketchDocument,
  SketchShape,
  SketchText,
  SketchTextTransform,
} from "./types";

type StrokeCmd = Extract<SketchCommand, { type: "stroke" }>;
type ShapeCmd = Extract<SketchCommand, { type: "shape" }>;

function strokeCmd(overrides: Partial<StrokeCmd> = {}): StrokeCmd {
  return {
    type: "stroke",
    tool: "pen",
    color: "#1A1A1A",
    width: 8,
    points: [
      { x: 10, y: 10 },
      { x: 20, y: 20 },
    ],
    ...overrides,
  };
}

function shapeCmd(overrides: Partial<ShapeCmd> = {}): ShapeCmd {
  return {
    type: "shape",
    shape: "rect",
    fill: "none",
    color: "#1A1A1A",
    width: 8,
    from: { x: 10, y: 10 },
    to: { x: 60, y: 50 },
    ...overrides,
  };
}

describe("toLogicalPoint", () => {
  const doc = { width: 1024, height: 768 };
  it("按显示矩形缩放到逻辑画布坐标", () => {
    const rect = { left: 100, top: 50, width: 512, height: 384 };
    expect(toLogicalPoint(100, 50, rect, doc)).toEqual({ x: 0, y: 0 });
    expect(toLogicalPoint(356, 242, rect, doc)).toEqual({ x: 512, y: 384 });
  });

  it("显示缩放不改变文档坐标（2x 与 0.5x 一致）", () => {
    const big = { left: 0, top: 0, width: 2048, height: 1536 };
    const small = { left: 0, top: 0, width: 512, height: 384 };
    expect(toLogicalPoint(1024, 768, big, doc)).toEqual(
      toLogicalPoint(256, 192, small, doc),
    );
  });
});

describe("笔宽", () => {
  const doc = { width: 1024, height: 768 };
  it("滑杆上大下小：t 越大笔越粗", () => {
    expect(penWidth(1, doc)).toBeGreaterThan(penWidth(0, doc));
    expect(eraserWidth(1, doc)).toBeGreaterThan(eraserWidth(0, doc));
  });

  it("下限保护：细笔 ≥1.5、橡皮 ≥5", () => {
    expect(penWidth(0, doc)).toBeGreaterThanOrEqual(1.5);
    expect(eraserWidth(0, doc)).toBeGreaterThanOrEqual(5);
  });
});

describe("草图文字", () => {
  const text: SketchText = {
    type: "text",
    content: "测试 Text",
    x: 0,
    y: 100,
    color: "#1A1A1A",
    fontSize: 32,
  };

  it("字号随滑杆与画布短边缩放，并保护最小字号", () => {
    for (const t of [0, 0.5, 1]) {
      expect(textSize(t, { width: 1536, height: 1024 })).toBeCloseTo(
        (0.015 + 0.065 * t) * 1024,
      );
      expect(textSize(t, { width: 1024, height: 1536 })).toBeCloseTo(
        textSize(t, { width: 1536, height: 1024 }),
      );
      expect(textSize(t, { width: 10, height: 10 })).toBe(12);
    }
  });

  it("兼容旧文档，接受单行文字和 200 字符边界", () => {
    for (const commands of [
      [],
      [text],
      [{ ...text, content: "字".repeat(SKETCH_TEXT_MAX_CHARS) }],
    ]) {
      const doc = { ...blankSketch(1024, 1024), commands };
      expect(validateSketchDocument(doc)).toEqual(doc);
    }
  });

  it("读取与提交均拒绝空白、换行、超长和非法属性", () => {
    for (const overrides of [
      { content: "" },
      { content: "   " },
      { content: "a\nb" },
      { content: "a\rb" },
      { content: "a\u2028b" },
      { content: "x".repeat(SKETCH_TEXT_MAX_CHARS + 1) },
      { content: 123 },
      { x: Number.NaN },
      { y: Infinity },
      { x: "5" },
      { color: "" },
      { color: null },
      { fontSize: 0 },
      { fontSize: -1 },
      { fontSize: Infinity },
      { fontSize: "20" },
    ]) {
      const command = { ...text, ...overrides } as SketchText;
      expect(
        validateSketchDocument({
          ...blankSketch(1024, 1024),
          commands: [command],
        }),
      ).toBeNull();
      expect(commitCommand(blankSketch(1024, 1024), 0, command)).toBeNull();
    }
  });

  it("文字计入命令上限，不计入采样点，保留在快照中", () => {
    const doc = blankSketch(1024, 1024);
    const next = commitCommand(doc, 0, text)!;
    expect(next.cursor).toBe(1);
    expect(totalPoints(next.doc)).toBe(0);
    expect(freezeSketch(next.doc, 1).commands).toEqual([text]);
    expect(sketchSnapshotKey(next.doc)).not.toBe(sketchSnapshotKey(doc));
    expect(
      commitCommand(
        { ...doc, commands: Array(SKETCH_MAX_COMMANDS).fill(text) },
        SKETCH_MAX_COMMANDS,
        text,
      ),
    ).toBeNull();
  });
});

describe("文字移动与缩放", () => {
  const text: SketchText = {
    type: "text",
    content: "Text",
    x: 100,
    y: 200,
    fontSize: 40,
    color: "#000",
  };
  const doc: SketchDocument = { ...blankSketch(1024, 768), commands: [text] };
  const move: SketchTextTransform = {
    type: "text-transform",
    target: 0,
    x: 200,
    y: 300,
    fontSize: 60,
  };

  it("移动保留抓取偏移并限制锚点在画布内", () => {
    expect(
      transformSketchText(
        text,
        0,
        "move",
        { x: 120, y: 190 },
        { x: 170, y: 230 },
        doc,
      ),
    ).toEqual({ ...move, x: 150, y: 240, fontSize: 40 });
    expect(
      transformSketchText(
        text,
        0,
        "move",
        { x: 120, y: 190 },
        { x: -1000, y: 1000 },
        doc,
      ),
    ).toMatchObject({ x: 0, y: 768 });
  });

  it("角点缩放保持基线锚点，保护最小与最大字号", () => {
    expect(
      transformSketchText(
        text,
        0,
        "resize",
        { x: 200, y: 160 },
        { x: 300, y: 120 },
        doc,
      ),
    ).toMatchObject({ x: 100, y: 200, fontSize: 80 });
    expect(resizeSketchText(40, 0.001, doc)).toBe(12);
    expect(resizeSketchText(40, 100, doc)).toBe(768);
    expect(
      transformSketchText(text, 0, "resize", text, text, doc).fontSize,
    ).toBe(40);
  });

  it("重放前缀与临时预览分别求值，不改原始命令与绘制层次", () => {
    const ink = strokeCmd();
    const document = {
      ...doc,
      commands: [text, ink, move, { ...move, x: 500 }],
    };
    expect(resolveSketchCommands(document, 2)).toEqual([text, ink]);
    expect(resolveSketchCommands(document, 3)[0]).toMatchObject({
      x: 200,
      fontSize: 60,
    });
    expect(resolveSketchCommands(document)[0]).toMatchObject({ x: 500 });
    expect(
      resolveSketchCommands(document, 3, { ...move, x: 700 })[0],
    ).toMatchObject({ x: 700 });
    expect(document.commands[0]).toBe(text);
    expect(resolveSketchCommands(document)[1]).toBe(ink);
    expect(text.x).toBe(100);
  });

  it("调整被保存在确认快照中，文字本身不被替换", () => {
    const next = commitCommand(doc, 1, move)!;
    expect(validateSketchDocument(next.doc)).toEqual(next.doc);
    expect(freezeSketch(next.doc, 2).commands).toEqual([text, move]);
    expect(totalPoints(next.doc)).toBe(0);
    expect(sketchSnapshotKey(next.doc)).not.toBe(sketchSnapshotKey(doc));
  });

  it("读取与提交拒绝无效引用、非有限属性和清空之前的文字", () => {
    for (const command of [
      { ...move, target: -1 },
      { ...move, target: 1 },
      { ...move, target: 0.5 },
      { ...move, x: NaN },
      { ...move, y: Infinity },
      { ...move, fontSize: 0 },
      { ...move, fontSize: Infinity },
    ]) {
      expect(commitCommand(doc, 1, command)).toBeNull();
      expect(
        validateSketchDocument({ ...doc, commands: [text, command] }),
      ).toBeNull();
    }
    expect(commitCommand(doc, 0, move)).toBeNull();
    expect(
      commitCommand(
        { ...doc, commands: [strokeCmd()] } as SketchDocument,
        1,
        move,
      ),
    ).toBeNull();
    expect(
      commitCommand(
        { ...doc, commands: [text, { type: "clear" }] } as SketchDocument,
        2,
        move,
      ),
    ).toBeNull();
    expect(
      validateSketchDocument({
        ...doc,
        commands: [text, { type: "clear" }, move],
      }),
    ).toBeNull();
    expect(
      commitCommand(
        { ...doc, commands: Array(SKETCH_MAX_COMMANDS).fill(text) },
        SKETCH_MAX_COMMANDS,
        move,
      ),
    ).toBeNull();
  });
});

describe("commitCommand", () => {
  it("追加命令并推进游标", () => {
    const doc = blankSketch(1024, 1024);
    const next = commitCommand(doc, 0, strokeCmd());
    expect(next?.doc.commands).toHaveLength(1);
    expect(next?.cursor).toBe(1);
  });

  it("撤销后提交丢弃重做分支", () => {
    let doc = blankSketch(1024, 1024);
    let cursor = 0;
    for (let i = 0; i < 3; i++) {
      const next = commitCommand(doc, cursor, strokeCmd({ width: i + 1 }));
      doc = next!.doc;
      cursor = next!.cursor;
    }
    cursor = 1; // 撤销两步
    const next = commitCommand(doc, cursor, { type: "clear" });
    expect(next?.doc.commands).toHaveLength(2);
    expect(next?.doc.commands[1]).toEqual({ type: "clear" });
    expect(next?.cursor).toBe(2);
  });

  it("达到命令上限拒绝提交且不改原数组", () => {
    const doc: SketchDocument = {
      version: 1,
      width: 1024,
      height: 1024,
      commands: Array.from({ length: SKETCH_MAX_COMMANDS }, () => strokeCmd()),
    };
    expect(commitCommand(doc, doc.commands.length, strokeCmd())).toBeNull();
    expect(doc.commands).toHaveLength(SKETCH_MAX_COMMANDS);
  });
});

describe("totalPoints / 快照", () => {
  it("只统计提交前缀内的点", () => {
    const doc: SketchDocument = {
      version: 1,
      width: 1024,
      height: 1024,
      commands: [
        strokeCmd(),
        { type: "clear" },
        strokeCmd({ points: [{ x: 1, y: 1 }] }),
      ],
    };
    expect(totalPoints(doc, 2)).toBe(2);
    expect(totalPoints(doc)).toBe(3);
  });

  it("snapshotKey 随前缀内容变化，freezeSketch 丢弃重做分支", () => {
    const doc: SketchDocument = {
      version: 1,
      width: 1024,
      height: 1024,
      commands: [strokeCmd()],
    };
    const before = sketchSnapshotKey(doc, 1);
    expect(sketchSnapshotKey(doc, 0)).not.toBe(before);
    const frozen = freezeSketch(doc, 0);
    expect(frozen.commands).toHaveLength(0);
    expect(doc.commands).toHaveLength(1); // 原文档不被修改
  });
});

describe("validateSketchDocument", () => {
  const valid = (): SketchDocument => ({
    version: 1,
    width: 1024,
    height: 1024,
    commands: [
      strokeCmd(),
      { type: "stroke", tool: "eraser", width: 30, points: [{ x: 5, y: 5 }] },
    ],
  });

  it("接受合法文档（含橡皮与 clear）", () => {
    const doc = {
      ...valid(),
      commands: [...valid().commands, { type: "clear" }],
    };
    expect(validateSketchDocument(doc)).toEqual(doc);
  });

  it("拒绝不支持的版本与非法输入", () => {
    expect(validateSketchDocument(null)).toBeNull();
    expect(validateSketchDocument({})).toBeNull();
    expect(validateSketchDocument({ ...valid(), version: 2 })).toBeNull();
    expect(validateSketchDocument({ ...valid(), width: 0 })).toBeNull();
    expect(validateSketchDocument({ ...valid(), commands: "x" })).toBeNull();
  });

  it("拒绝缺 points 的笔画命令（防止渲染崩溃）", () => {
    expect(
      validateSketchDocument({
        ...valid(),
        commands: [{ type: "stroke", tool: "pen" } as never],
      }),
    ).toBeNull();
  });

  it("接受合法形状命令，四种种类与两种填充都算合法", () => {
    const shapes: SketchShape[] = [
      { ...shapeCmd(), shape: "rect", fill: "none" },
      { ...shapeCmd(), shape: "rect", fill: "solid" },
      { ...shapeCmd(), shape: "ellipse", fill: "none" },
      { ...shapeCmd(), shape: "ellipse", fill: "solid" },
      { ...shapeCmd(), shape: "line", fill: "none" },
      { ...shapeCmd(), shape: "arrow", fill: "none" },
    ];
    const doc = { ...valid(), commands: [...valid().commands, ...shapes] };
    expect(validateSketchDocument(doc)).toEqual(doc);
  });

  it("拒绝未知形状种类与填充值", () => {
    for (const bad of [
      { ...shapeCmd(), shape: "triangle" },
      { ...shapeCmd(), fill: "dashed" },
    ]) {
      expect(
        validateSketchDocument({ ...valid(), commands: [bad] }),
      ).toBeNull();
    }
  });

  it("拒绝形状的非法坐标与线宽", () => {
    for (const bad of [
      { ...shapeCmd(), to: { x: Number.NaN, y: 5 } },
      { ...shapeCmd(), from: { x: 0, y: Number.POSITIVE_INFINITY } },
      { ...shapeCmd(), width: 0 },
      { ...shapeCmd(), width: -4 },
      { ...shapeCmd(), width: Number.NaN },
      { ...shapeCmd(), color: "" },
      { ...shapeCmd(), to: undefined },
    ]) {
      expect(
        validateSketchDocument({ ...valid(), commands: [bad] }),
      ).toBeNull();
    }
  });

  it("边界坐标 0 是合法起点", () => {
    const doc = {
      ...valid(),
      commands: [shapeCmd({ from: { x: 0, y: 0 }, to: { x: 0, y: 40 } })],
    };
    expect(validateSketchDocument(doc)).toEqual(doc);
  });
});

describe("ratioMismatch", () => {
  it("1% 容差内视为一致", () => {
    expect(ratioMismatch({ w: 1024, h: 1024 }, { w: 2048, h: 2048 })).toBe(
      false,
    );
    expect(ratioMismatch({ w: 1024, h: 1024 }, { w: 1024, h: 1034 })).toBe(
      false,
    );
    expect(ratioMismatch({ w: 1536, h: 1024 }, { w: 1024, h: 1024 })).toBe(
      true,
    );
  });
});

describe("makeStroke", () => {
  it("画笔带颜色、橡皮不带", () => {
    expect(makeStroke("pen", "#E53935", 10)).toMatchObject({
      type: "stroke",
      tool: "pen",
      color: "#E53935",
      width: 10,
      points: [],
    });
    expect(makeStroke("eraser", undefined, 30)).toMatchObject({
      type: "stroke",
      tool: "eraser",
      width: 30,
      points: [],
    });
    expect("color" in makeStroke("eraser", undefined, 30)).toBe(false);
  });
});

describe("形状几何", () => {
  const doc = { width: 100, height: 100 };

  it("起点归到画布内", () => {
    expect(clampToCanvas({ x: -20, y: 140 }, doc)).toEqual({ x: 0, y: 100 });
  });

  it("四个拖动方向归一为同一包围盒", () => {
    const tl = { x: 20, y: 30 };
    const tr = { x: 70, y: 30 };
    const bl = { x: 20, y: 80 };
    const br = { x: 70, y: 80 };
    const box = { left: 20, top: 30, right: 70, bottom: 80 };
    expect(normalizeBox(tl, br)).toEqual(box);
    expect(normalizeBox(br, tl)).toEqual(box);
    expect(normalizeBox(tr, bl)).toEqual(box);
    expect(normalizeBox(bl, tr)).toEqual(box);
  });

  it("不带 Shift：终点夹在画布内", () => {
    expect(
      constrainShapeEnd(
        "rect",
        { x: 20, y: 20 },
        { x: 150, y: -30 },
        { shift: false, doc },
      ),
    ).toEqual({ x: 100, y: 0 });
  });

  it("Shift 矩形 / 椭圆：取横纵较大者作边长", () => {
    expect(
      constrainShapeEnd(
        "rect",
        { x: 20, y: 20 },
        { x: 60, y: 40 },
        { shift: true, doc },
      ),
    ).toEqual({ x: 60, y: 60 });
    expect(
      constrainShapeEnd(
        "rect",
        { x: 40, y: 20 },
        { x: 10, y: 70 },
        { shift: true, doc },
      ),
    ).toEqual({ x: 0, y: 60 });
    expect(
      constrainShapeEnd(
        "ellipse",
        { x: 20, y: 20 },
        { x: 55, y: 30 },
        { shift: true, doc },
      ),
    ).toEqual({ x: 55, y: 55 });
  });

  it("Shift 与画布边界同时生效：等比缩短到边界", () => {
    expect(
      constrainShapeEnd(
        "rect",
        { x: 90, y: 10 },
        { x: 99, y: 80 },
        { shift: true, doc },
      ),
    ).toEqual({ x: 100, y: 20 });
  });

  it("Shift 直线与箭头：吸附到 45° 的倍数，保留拖动长度", () => {
    const line = constrainShapeEnd(
      "line",
      { x: 50, y: 50 },
      { x: 90, y: 55 },
      { shift: true, doc },
    );
    expect(line.x).toBeCloseTo(50 + Math.hypot(40, 5));
    expect(line.y).toBeCloseTo(50);
    const arrow = constrainShapeEnd(
      "arrow",
      { x: 50, y: 50 },
      { x: 80, y: 85 },
      { shift: true, doc },
    );
    const offset = Math.hypot(30, 35) / Math.SQRT2;
    expect(arrow.x).toBeCloseTo(50 + offset);
    expect(arrow.y).toBeCloseTo(50 + offset);
  });

  it("Shift 短线不延伸到边缘，零长度不生成长线", () => {
    for (const kind of ["line", "arrow"] as const) {
      expect(
        constrainShapeEnd(
          kind,
          { x: 50, y: 50 },
          { x: 60, y: 50 },
          { shift: true, doc },
        ),
      ).toEqual({ x: 60, y: 50 });
      expect(
        constrainShapeEnd(
          kind,
          { x: 50, y: 50 },
          { x: 50, y: 50 },
          { shift: true, doc },
        ),
      ).toEqual({ x: 50, y: 50 });
    }
  });

  it("Shift 线段越界时沿吸附方向缩短，朝外时停在起点", () => {
    const end = constrainShapeEnd(
      "arrow",
      { x: 90, y: 50 },
      { x: 140, y: 100 },
      { shift: true, doc },
    );
    expect(end.x).toBeCloseTo(100);
    expect(end.y).toBeCloseTo(60);
    expect(
      constrainShapeEnd(
        "line",
        { x: 100, y: 50 },
        { x: 105, y: 52 },
        { shift: true, doc },
      ),
    ).toEqual({ x: 100, y: 50 });
  });

  it("最小尺寸按显示像素判定", () => {
    // 显示缩放 0.5：4 显示像素 = 8 逻辑像素
    expect(shapeFitsMinSize("rect", { x: 0, y: 0 }, { x: 8, y: 8 }, 0.5)).toBe(
      true,
    );
    expect(
      shapeFitsMinSize("rect", { x: 0, y: 0 }, { x: 8, y: 7.9 }, 0.5),
    ).toBe(false);
    expect(shapeFitsMinSize("line", { x: 0, y: 0 }, { x: 0, y: 8 }, 0.5)).toBe(
      true,
    );
    expect(
      shapeFitsMinSize("arrow", { x: 0, y: 0 }, { x: 0, y: 7.9 }, 0.5),
    ).toBe(false);
  });

  it("零尺寸（单击）不占撤销步骤", () => {
    expect(shapeFitsMinSize("rect", { x: 1, y: 1 }, { x: 1, y: 1 }, 1)).toBe(
      false,
    );
    expect(shapeFitsMinSize("ellipse", { x: 1, y: 1 }, { x: 1, y: 1 }, 1)).toBe(
      false,
    );
    expect(shapeFitsMinSize("line", { x: 1, y: 1 }, { x: 1, y: 1 }, 1)).toBe(
      false,
    );
  });

  it("箭头：实心三角形随线宽变化，短箭头不超过线长的 40%", () => {
    const long = arrowHead({ x: 0, y: 0 }, { x: 100, y: 0 }, 10)!;
    expect(long.tip).toEqual({ x: 100, y: 0 });
    expect(long.base.x).toBeCloseTo(66);
    expect(long.left.y).toBeCloseTo(-17);
    expect(long.right.y).toBeCloseTo(17);
    const short = arrowHead({ x: 0, y: 0 }, { x: 20, y: 0 }, 10)!;
    expect(short.base.x).toBeCloseTo(12); // 线长的 40% = 8 < 10 × 3.4
    expect(arrowHead({ x: 1, y: 1 }, { x: 1, y: 1 }, 10)).toBeNull();
  });

  it("makeShape：直线与箭头不带填充", () => {
    expect(
      makeShape("line", "solid", "#000", 8, { x: 1, y: 1 }, { x: 2, y: 2 }),
    ).toMatchObject({ type: "shape", shape: "line", fill: "none" });
    expect(
      makeShape("arrow", "solid", "#000", 8, { x: 1, y: 1 }, { x: 2, y: 2 }),
    ).toMatchObject({ type: "shape", shape: "arrow", fill: "none" });
    expect(
      makeShape("rect", "solid", "#E53935", 12, { x: 1, y: 1 }, { x: 2, y: 2 }),
    ).toEqual({
      type: "shape",
      shape: "rect",
      fill: "solid",
      color: "#E53935",
      width: 12,
      from: { x: 1, y: 1 },
      to: { x: 2, y: 2 },
    });
  });
});

describe("形状命令的撤销与上限", () => {
  it("形状计入命令上限", () => {
    const doc: SketchDocument = {
      version: 1,
      width: 1024,
      height: 1024,
      commands: Array.from({ length: SKETCH_MAX_COMMANDS }, () => shapeCmd()),
    };
    expect(commitCommand(doc, doc.commands.length, shapeCmd())).toBeNull();
  });

  it("撤销一步只回退一个形状，重做恢复；撤销后新形状丢弃重做分支", () => {
    let doc = blankSketch(1024, 1024);
    let cursor = 0;
    const rect = shapeCmd();
    const ellipse = shapeCmd({ shape: "ellipse", fill: "solid" });
    for (const cmd of [rect, ellipse]) {
      const next = commitCommand(doc, cursor, cmd);
      doc = next!.doc;
      cursor = next!.cursor;
    }
    doc = freezeSketch(doc, 1);
    cursor = 1;
    expect(doc.commands).toEqual([rect]);
    const next = commitCommand(doc, cursor, shapeCmd({ shape: "arrow" }));
    expect(next?.doc.commands).toEqual([rect, shapeCmd({ shape: "arrow" })]);
    expect(next?.cursor).toBe(2);
  });

  it("形状不计入笔画采样点上限", () => {
    const doc: SketchDocument = {
      version: 1,
      width: 1024,
      height: 1024,
      commands: [strokeCmd(), shapeCmd(), shapeCmd({ shape: "arrow" })],
    };
    expect(totalPoints(doc)).toBe(2);
  });
});
