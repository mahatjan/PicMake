import { beforeEach, describe, expect, it } from "vitest";
import type { ImageRow } from "../../db/schema";
import { blankMask } from "../../lib/inpaint";
import {
  blankSketch,
  SKETCH_MAX_COMMANDS,
  resolveSketchCommands,
} from "../../lib/sketch";
import type {
  MaskCommand,
  MaskImage,
  SketchCommand,
  SketchShapeKind,
} from "../../lib/types";
import { initialWorkspace, useWorkspace } from "./index";
import {
  applyInpaintSelection,
  beginInpaintOpening,
  closeDrawing,
  initializeDraft,
  openDrawer,
  openInpaint,
  openSketch,
  redoDrawing,
  selectRecord,
  setDrawingConfirming,
  setDrawingError,
  setFocusIdx,
  setLastDoneId,
  strokeMask,
  strokeSketch,
  undoDrawing,
} from "./actions";

const state = () => useWorkspace.getState();
const drawing = () => state().drawing;
const commands = () => {
  const d = drawing();
  return d && d.kind !== "opening" ? d.doc.commands : [];
};
/** 撤销游标之前的已提交前缀 */
const committed = () => {
  const d = drawing();
  return d && d.kind !== "opening" ? d.doc.commands.slice(0, d.cursor) : [];
};

const stroke = (x: number): SketchCommand => ({
  type: "stroke",
  tool: "pen",
  color: "#000",
  width: 3,
  points: [{ x, y: x }],
});
/** 选区只有笔触与清空：形状命令进不了这个入口 */
const maskStroke = (x: number): MaskCommand => ({
  type: "stroke",
  tool: "pen",
  width: 3,
  points: [{ x, y: x }],
});
/** 形状只提交给草图 */
const shape = (kind: SketchShapeKind): SketchCommand => ({
  type: "shape",
  shape: kind,
  fill: "none",
  color: "#000",
  width: 3,
  from: { x: 1, y: 1 },
  to: { x: 20, y: 14 },
});
const image = (id: string, width = 1024, height = 1024): ImageRow => ({
  id,
  blob: new Blob(),
  width,
  height,
  format: "png",
});
const maskOf = (base: ImageRow): MaskImage => ({
  ...image(`mask-${base.id}`, base.width, base.height),
  mask: blankMask(base.id, base.width, base.height),
});
const inpaintSession = (base = image("b1")) => ({
  entry: "result" as const,
  base,
  normalized: false,
  doc: blankMask(base.id, base.width, base.height),
  naming: { kind: "base" as const },
  chosenInputId: null,
});

beforeEach(() => {
  useWorkspace.setState(initialWorkspace(), true);
});

describe("草图", () => {
  it("文字变换一步撤销重做；撤销后调整丢弃旧分支，非法调整不写入", () => {
    const text = {
      type: "text" as const,
      content: "Text",
      x: 10,
      y: 50,
      color: "#000",
      fontSize: 32,
    };
    openSketch(
      { ...blankSketch(1024, 1024), commands: [text] },
      { kind: "new" },
      null,
    );
    const move = {
      type: "text-transform" as const,
      target: 0,
      x: 100,
      y: 200,
      fontSize: 64,
    };
    strokeSketch(move);
    const resolved = () => resolveSketchCommands({ commands: committed() });
    expect(resolved()[0]).toMatchObject({ x: 100, fontSize: 64 });
    undoDrawing();
    expect(resolved()[0]).toEqual(text);
    redoDrawing();
    expect(resolved()[0]).toMatchObject({ x: 100, fontSize: 64 });
    undoDrawing();
    strokeSketch({ ...move, x: 300 });
    expect(commands()).toEqual([text, { ...move, x: 300 }]);
    const before = state();
    strokeSketch({ ...move, target: 1 });
    expect(state()).toBe(before);
  });

  it("局部重绘不接受文字变换命令", () => {
    openInpaint(beginInpaintOpening()!, inpaintSession());
    const before = state();
    strokeSketch({
      type: "text-transform",
      target: 0,
      x: 100,
      y: 100,
      fontSize: 40,
    });
    expect(state()).toBe(before);
  });
  it("文字提交、撤销与重做，并在撤销后丢弃旧分支", () => {
    openSketch(blankSketch(1024, 1024), { kind: "new" }, null);
    const text: SketchCommand = {
      type: "text",
      content: "测试",
      x: 10,
      y: 50,
      color: "#000",
      fontSize: 32,
    };
    strokeSketch(text);
    expect(committed()).toEqual([text]);
    undoDrawing();
    expect(committed()).toEqual([]);
    redoDrawing();
    expect(committed()).toEqual([text]);
    undoDrawing();
    strokeSketch({ ...text, content: "新文字" });
    expect(commands()).toEqual([{ ...text, content: "新文字" }]);
  });

  it("局部重绘运行时也拒绝文字命令", () => {
    const id = beginInpaintOpening()!;
    openInpaint(id, inpaintSession());
    const before = state();
    strokeSketch({
      type: "text",
      content: "测试",
      x: 10,
      y: 50,
      color: "#000",
      fontSize: 32,
    });
    expect(state()).toBe(before);
    expect(commands()).toEqual([]);
  });

  it("openSketch：游标取已有命令数，openKey 是打开时的快照；已有画板时忽略", () => {
    const doc = { ...blankSketch(800, 600), commands: [stroke(1), stroke(2)] };
    expect(openSketch(doc, { kind: "attachment", index: 1 }, "img-1")).toBe(
      true,
    );
    expect(drawing()).toMatchObject({
      kind: "sketch",
      cursor: 2,
      replacesImageId: "img-1",
      origin: { kind: "attachment", index: 1 },
      confirming: false,
      openKey: JSON.stringify(doc.commands),
    });
    const before = state();
    expect(openSketch(blankSketch(1, 1), { kind: "new" }, null)).toBe(false);
    expect(state()).toBe(before);
  });

  it("笔画、撤销、重做：游标只在已提交范围内移动，新笔画丢弃重做分支", () => {
    openSketch(blankSketch(100, 100), { kind: "new" }, null);
    strokeSketch(stroke(1));
    strokeSketch(stroke(2));
    expect(drawing()).toMatchObject({ cursor: 2 });
    const atEnd = state();
    redoDrawing();
    expect(state()).toBe(atEnd);
    undoDrawing();
    undoDrawing();
    const atStart = state();
    undoDrawing();
    expect(state()).toBe(atStart);
    redoDrawing();
    expect(drawing()).toMatchObject({ cursor: 1 });
    strokeSketch(stroke(3));
    expect(commands()).toEqual([stroke(1), stroke(3)]);
    expect(drawing()).toMatchObject({ cursor: 2 });
  });

  it("形状：一步一撤、重做恢复；撤销后新画形状丢弃重做分支", () => {
    openSketch(blankSketch(100, 100), { kind: "new" }, null);
    const rect = shape("rect");
    const arrow = shape("arrow");
    strokeSketch(rect);
    strokeSketch(arrow);
    expect(committed()).toEqual([rect, arrow]);
    undoDrawing();
    expect(committed()).toEqual([rect]);
    redoDrawing();
    expect(committed()).toEqual([rect, arrow]);
    undoDrawing();
    undoDrawing();
    const solid = shape("ellipse");
    strokeSketch(solid);
    expect(commands()).toEqual([solid]); // 重做分支被丢弃
    expect(drawing()).toMatchObject({ cursor: 1 });
  });

  it("形状计入命令上限", () => {
    openSketch(
      {
        ...blankSketch(10, 10),
        commands: Array.from({ length: SKETCH_MAX_COMMANDS }, () =>
          shape("rect"),
        ),
      },
      { kind: "new" },
      null,
    );
    const before = state();
    strokeSketch(shape("line"));
    expect(state()).toBe(before);
  });

  it("超过命令上限时静默拒绝", () => {
    const full = Array.from({ length: SKETCH_MAX_COMMANDS }, () => stroke(1));
    openSketch(
      { ...blankSketch(10, 10), commands: full },
      { kind: "new" },
      null,
    );
    const before = state();
    strokeSketch(stroke(2));
    expect(state()).toBe(before);
  });

  it("没有画板或底图还在准备时，笔画、撤销、重做、确认中都不起作用", () => {
    const noop = () => {
      strokeSketch(stroke(1));
      undoDrawing();
      redoDrawing();
      setDrawingConfirming(true);
      setDrawingError("empty-mask");
    };
    const before = state();
    noop();
    expect(state()).toBe(before);
    beginInpaintOpening();
    const opening = state();
    noop();
    expect(state()).toBe(opening);
  });

  it("setDrawingConfirming 只改确认中标记", () => {
    openSketch(blankSketch(10, 10), { kind: "new" }, null);
    setDrawingConfirming(true);
    expect(drawing()).toMatchObject({ confirming: true, cursor: 0 });
    setDrawingConfirming(false);
    expect(drawing()).toMatchObject({ confirming: false });
  });

  it("closeDrawing：不传 id 关闭当前画板；过期的 id 关不掉新画板", () => {
    openSketch(blankSketch(10, 10), { kind: "new" }, null);
    const oldId = drawing()!.id;
    closeDrawing();
    expect(drawing()).toBeNull();
    openSketch(blankSketch(10, 10), { kind: "new" }, null);
    closeDrawing(oldId);
    expect(drawing()).not.toBeNull();
    closeDrawing(drawing()!.id);
    expect(drawing()).toBeNull();
  });
});

describe("局部重绘", () => {
  it("beginInpaintOpening：占用槽位并返回会话 id；已有画板时返回 null", () => {
    const id = beginInpaintOpening();
    expect(drawing()).toEqual({ kind: "opening", id });
    expect(beginInpaintOpening()).toBeNull();
    expect(drawing()).toEqual({ kind: "opening", id });
    closeDrawing();
    openSketch(blankSketch(10, 10), { kind: "new" }, null);
    expect(beginInpaintOpening()).toBeNull();
  });

  it("openInpaint：id 一致时才打开；准备期间被关闭或换了会话，结果被忽略", () => {
    const stale = beginInpaintOpening()!;
    closeDrawing(stale);
    expect(openInpaint(stale, inpaintSession())).toBe(false);
    expect(drawing()).toBeNull();

    const current = beginInpaintOpening()!;
    expect(openInpaint(stale, inpaintSession())).toBe(false);
    expect(drawing()).toEqual({ kind: "opening", id: current });
    expect(openInpaint(current, inpaintSession())).toBe(true);
    expect(drawing()).toMatchObject({
      kind: "inpaint",
      id: current,
      entry: "result",
      cursor: 0,
      confirming: false,
      error: null,
    });
    expect(openInpaint(current, inpaintSession())).toBe(false);
  });

  it("重开已确认的选区：游标在已有命令末尾", () => {
    const base = image("b1");
    const existing: MaskCommand = {
      type: "stroke",
      tool: "pen",
      width: 20,
      points: [{ x: 1, y: 1 }],
    };
    const session = {
      ...inpaintSession(base),
      entry: "reedit" as const,
      doc: { ...blankMask(base.id, 1024, 1024), commands: [existing] },
    };
    openInpaint(beginInpaintOpening()!, session);
    expect(drawing()).toMatchObject({
      cursor: 1,
      openKey: JSON.stringify([existing]),
    });
  });

  it("涂抹、撤销、重做都会清除就地错误；setDrawingError 同时结束确认中", () => {
    openInpaint(beginInpaintOpening()!, inpaintSession());
    setDrawingConfirming(true);
    setDrawingError("empty-mask");
    expect(drawing()).toMatchObject({ confirming: false, error: "empty-mask" });
    strokeMask(maskStroke(1));
    expect(drawing()).toMatchObject({ cursor: 1, error: null });
    setDrawingError("canvas-failed");
    undoDrawing();
    expect(drawing()).toMatchObject({ cursor: 0, error: null });
    setDrawingError("canvas-failed");
    redoDrawing();
    expect(drawing()).toMatchObject({ cursor: 1, error: null });
  });
});

describe("applyInpaintSelection", () => {
  it("result：以该结果为唯一底图开新草稿，离开当前记录并展开创作条", () => {
    const base = image("base", 1024, 1024);
    const mask = maskOf(base);
    selectRecord("rec");
    setLastDoneId("rec");
    setFocusIdx(2);
    openDrawer();
    initializeDraft(undefined, [{ imageId: "old", name: "旧图" }]);
    const seq = state().view.focusSeq;
    expect(
      applyInpaintSelection({
        base,
        mask,
        entry: "result",
        chosenInputId: null,
      }),
    ).toEqual({ reordered: false });
    expect(state().draft).toMatchObject({
      inputs: [{ imageId: "base", upload: base }],
      inpaint: { mask },
      dirty: true,
      sizeAccepted: true,
    });
    expect(state().nav).toMatchObject({ selectedId: null, lastDoneId: null });
    expect(state().view).toMatchObject({
      barMode: "full",
      focusSeq: seq + 1,
      focusIdx: null,
      drawerOpen: true,
    });
  });

  it("result：目标尺寸与原图不同时，建议尺寸等用户接受", () => {
    const base = image("base", 1000, 1000);
    applyInpaintSelection({
      base,
      mask: maskOf(base),
      entry: "result",
      chosenInputId: null,
    });
    expect(state().draft.sizeAccepted).toBe(false);
  });

  it("draft-input：底图重排为图1并移除被选中的原图，其他图保留；区分编号是否变化", () => {
    initializeDraft(undefined, [
      { imageId: "other", name: "其他", upload: image("other") },
      { imageId: "chosen", name: "图", upload: image("chosen") },
    ]);
    const base = image("base2");
    const seq = state().view.focusSeq;
    expect(
      applyInpaintSelection({
        base,
        mask: maskOf(base),
        entry: "draft-input",
        chosenInputId: "chosen",
      }),
    ).toEqual({ reordered: true });
    expect(state().draft.inputs.map((input) => input.imageId)).toEqual([
      "base2",
      "other",
    ]);
    expect(state().view).toMatchObject({ barMode: "full", focusSeq: seq + 1 });

    initializeDraft(undefined, [
      { imageId: "only", name: "唯一", upload: image("only") },
    ]);
    const base3 = image("base3");
    expect(
      applyInpaintSelection({
        base: base3,
        mask: maskOf(base3),
        entry: "draft-input",
        chosenInputId: "only",
      }),
    ).toEqual({ reordered: false });
    expect(state().draft.inputs.map((input) => input.imageId)).toEqual([
      "base3",
    ]);
  });

  it("reedit：只替换选区，草稿其余部分、记录选择与查看状态不变", () => {
    const base = image("base");
    initializeDraft(undefined, [
      { imageId: "base", name: "底图", upload: base },
    ]);
    selectRecord("rec");
    const before = state();
    const mask = maskOf(base);
    expect(
      applyInpaintSelection({
        base,
        mask,
        entry: "reedit",
        chosenInputId: null,
      }),
    ).toEqual({ reordered: false });
    expect(state().draft.inpaint?.mask).toBe(mask);
    expect(state().draft).toMatchObject({ dirty: true, sizeAccepted: false });
    expect(state().draft.inputs).toBe(before.draft.inputs);
    expect(state().nav).toBe(before.nav);
    expect(state().view).toBe(before.view);
  });
});
