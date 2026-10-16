import { describe, expect, it } from "vitest";
import { DEFAULT_FORM, type GenForm } from "./params";
import type { InpaintDraft, SketchCommand } from "./types";
import {
  canOpenDrawing,
  canOpenPlayground,
  canWheelSwitch,
  draftToParams,
  hasUserWork,
  inpaintBarInfo,
  isDrawingChanged,
  leaveDecision,
  nextSelection,
  shouldCollapseBar,
  wheelTarget,
  type RunPhase,
} from "./workspace-rules";

const rows = (...ids: string[]) => ids.map((id) => ({ id }));

describe("hasUserWork", () => {
  it("草稿改过或上传读取中都算有修改", () => {
    expect(hasUserWork({ dirty: true, reading: false })).toBe(true);
    expect(hasUserWork({ dirty: false, reading: true })).toBe(true);
    expect(hasUserWork({ dirty: false, reading: false })).toBe(false);
  });
});

describe("leaveDecision", () => {
  const decide = (run: RunPhase, userWork: boolean, usesDisplayed = false) =>
    leaveDecision({ run, userWork, usesDisplayed });

  it("生成中、保存中一律拦截", () => {
    for (const run of ["generating", "saving"] as const) {
      expect(decide(run, false)).toBe("blocked");
      expect(decide(run, true, true)).toBe("blocked");
    }
  });

  it("有未保存结果：普通离开先确认放弃，以展示记录为来源的入口直接拦截", () => {
    expect(decide("unsaved", false)).toBe("confirm-unsaved");
    expect(decide("unsaved", true)).toBe("confirm-unsaved");
    expect(decide("unsaved", false, true)).toBe("blocked");
  });

  it("空闲时：有用户修改先确认放弃草稿，否则直接离开（与舞台是否有结果无关）", () => {
    expect(decide("idle", true)).toBe("confirm-draft");
    expect(decide("idle", true, true)).toBe("confirm-draft");
    expect(decide("idle", false)).toBe("ok");
    expect(decide("idle", false, true)).toBe("ok");
  });
});

describe("canOpenPlayground", () => {
  it("画板打开时不能进入视频工作台", () => {
    expect(canOpenPlayground({ drawing: false })).toBe(true);
    expect(canOpenPlayground({ drawing: true })).toBe(false);
  });
});

describe("canOpenDrawing", () => {
  const free = {
    run: "idle",
    reading: false,
    confirming: false,
    drawing: false,
  } as const;

  it("空闲时可以打开", () => {
    expect(canOpenDrawing(free)).toBe(true);
  });

  it("任一阻断条件成立都不能打开", () => {
    for (const run of ["generating", "saving", "unsaved"] as const)
      expect(canOpenDrawing({ ...free, run })).toBe(false);
    expect(canOpenDrawing({ ...free, reading: true })).toBe(false);
    expect(canOpenDrawing({ ...free, confirming: true })).toBe(false);
    expect(canOpenDrawing({ ...free, drawing: true })).toBe(false);
  });
});

describe("isDrawingChanged", () => {
  const stroke = (x: number): SketchCommand => ({
    type: "stroke",
    tool: "pen",
    color: "#000",
    width: 3,
    points: [{ x, y: x }],
  });
  const doc = (n: number) => ({
    commands: Array.from({ length: n }, (_, i) => stroke(i)),
  });
  const openKeyOf = (n: number) => JSON.stringify(doc(n).commands);

  it("新建：游标在 0 没有修改，画了一笔就有修改", () => {
    expect(isDrawingChanged({ doc: doc(0), cursor: 0, openKey: "[]" })).toBe(
      false,
    );
    expect(isDrawingChanged({ doc: doc(1), cursor: 1, openKey: "[]" })).toBe(
      true,
    );
  });

  it("撤销回打开时的状态视为没有修改，撤销一半仍有修改，重做回来又没有", () => {
    const opened = { doc: doc(2), openKey: openKeyOf(2) };
    expect(isDrawingChanged({ ...opened, cursor: 2 })).toBe(false);
    expect(isDrawingChanged({ ...opened, cursor: 1 })).toBe(true);
    expect(isDrawingChanged({ ...opened, cursor: 0 })).toBe(false);
  });

  it("打开后又画了新的一笔：即使条数相同也算修改", () => {
    const opened = { doc: doc(2), openKey: openKeyOf(2) };
    const replaced = {
      commands: [...opened.doc.commands.slice(0, 1), stroke(9)],
    };
    expect(
      isDrawingChanged({ doc: replaced, cursor: 2, openKey: opened.openKey }),
    ).toBe(true);
  });
});

describe("canWheelSwitch", () => {
  const free = {
    run: "idle",
    userWork: false,
    inputCount: 0,
    overlayOpen: false,
    drawing: false,
    confirming: false,
  } as const;

  it("没有草稿、弹层和画板时可以切换", () => {
    expect(canWheelSwitch(free)).toBe(true);
  });

  it("任一阻断条件成立都不切换", () => {
    for (const run of ["generating", "saving", "unsaved"] as const)
      expect(canWheelSwitch({ ...free, run })).toBe(false);
    expect(canWheelSwitch({ ...free, userWork: true })).toBe(false);
    expect(canWheelSwitch({ ...free, inputCount: 1 })).toBe(false);
    expect(canWheelSwitch({ ...free, overlayOpen: true })).toBe(false);
    expect(canWheelSwitch({ ...free, drawing: true })).toBe(false);
    expect(canWheelSwitch({ ...free, confirming: true })).toBe(false);
  });
});

describe("wheelTarget", () => {
  const list = rows("c", "b", "a"); // 从新到旧

  it("没有记录时不切换", () => {
    expect(wheelTarget([], null, 100)).toBeNull();
  });

  it("没有选中项：不论方向都选最近一条", () => {
    expect(wheelTarget(list, null, 100)).toBe("c");
    expect(wheelTarget(list, null, -100)).toBe("c");
    expect(wheelTarget(list, "missing", 100)).toBe("c");
  });

  it("向下滚去更旧的，向上滚去更新的", () => {
    expect(wheelTarget(list, "b", 100)).toBe("a");
    expect(wheelTarget(list, "b", -100)).toBe("c");
  });

  it("已在最新或最旧的边界时不切换", () => {
    expect(wheelTarget(list, "a", 100)).toBeNull();
    expect(wheelTarget(list, "c", -100)).toBeNull();
    expect(wheelTarget(rows("only"), "only", 100)).toBeNull();
  });
});

describe("shouldCollapseBar", () => {
  const empty = { userWork: false, inputCount: 0, canReturn: false };

  it("空草稿时收起", () => {
    expect(shouldCollapseBar(empty)).toBe(true);
  });

  it("有修改（含读取中）、有输入图或可返回时不收起", () => {
    expect(shouldCollapseBar({ ...empty, userWork: true })).toBe(false);
    expect(shouldCollapseBar({ ...empty, inputCount: 2 })).toBe(false);
    expect(shouldCollapseBar({ ...empty, canReturn: true })).toBe(false);
  });
});

/** 指定底图尺寸的选区附件 */
function inpaintOf(width: number, height: number): InpaintDraft {
  return {
    mask: {
      id: "mask",
      blob: new Blob(),
      width,
      height,
      format: "png",
      mask: { version: 1, width, height, baseImageId: "base", commands: [] },
    },
  };
}

const form = (patch: Partial<GenForm> = {}): GenForm => ({
  ...DEFAULT_FORM,
  prompt: "一只猫",
  ...patch,
});

describe("nextSelection", () => {
  it("首次加载有历史也保留新建页面", () => {
    expect(nextSelection(undefined, rows("a", "b"), null)).toBeNull();
  });

  it("首次加载前已有选中项时保持不动", () => {
    expect(nextSelection(undefined, rows("a", "b"), "b")).toBe("b");
  });

  it("首次加载且没有记录时为 null", () => {
    expect(nextSelection(undefined, [], null)).toBeNull();
  });

  it("当前选中项被删除时回退到第一条", () => {
    expect(nextSelection(rows("a", "b", "c"), rows("a", "c"), "b")).toBe("a");
    expect(nextSelection(rows("a"), [], "a")).toBeNull();
  });

  it("写入早于回推：选中项不在旧列表里时保持不动", () => {
    expect(nextSelection(rows("a"), rows("a"), "new")).toBe("new");
    expect(nextSelection(rows("a"), rows("new", "a"), "new")).toBe("new");
  });

  it("删除的不是选中项时保持不动", () => {
    expect(nextSelection(rows("a", "b"), rows("a"), "a")).toBe("a");
  });

  it("没有选中项时保持 null", () => {
    expect(nextSelection(rows("a"), rows("b"), null)).toBeNull();
  });
});

describe("inpaintBarInfo", () => {
  it("没有选区时为 null", () => {
    expect(inpaintBarInfo(null, false)).toBeNull();
  });

  it("原尺寸合法：无需接受", () => {
    expect(inpaintBarInfo(inpaintOf(1024, 1024), false)).toMatchObject({
      tw: 1024,
      th: 1024,
      suggested: false,
      accepted: true,
    });
  });

  it("需要建议尺寸：接受状态取 sizeAccepted", () => {
    const info = inpaintBarInfo(inpaintOf(1000, 1000), false);
    expect(info).toMatchObject({ tw: 992, th: 992, suggested: true });
    expect(info?.accepted).toBe(false);
    expect(inpaintBarInfo(inpaintOf(1000, 1000), true)?.accepted).toBe(true);
  });
});

describe("draftToParams", () => {
  const base = {
    form: form(),
    inpaint: null,
    sizeAccepted: false,
    reading: false,
  };

  it("正常草稿得到参数", () => {
    const r = draftToParams(base);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.params.prompt).toBe("一只猫");
  });

  it("重绘建议尺寸未接受时最先拦截", () => {
    const r = draftToParams({
      ...base,
      inpaint: inpaintOf(1000, 1000),
      reading: true,
    });
    expect(r).toMatchObject({ ok: false, reason: "size-not-accepted" });
  });

  it("读取中静默拦截", () => {
    const r = draftToParams({ ...base, reading: true });
    expect(r).toEqual({ ok: false, reason: "reading" });
  });

  it("自定义尺寸非法", () => {
    const r = draftToParams({
      ...base,
      form: form({ cw: "1000", ch: "1000" }),
    });
    expect(r).toMatchObject({ ok: false, reason: "custom-size" });
  });

  it("局部重绘不检查自定义尺寸，输出尺寸取目标尺寸", () => {
    const r = draftToParams({
      ...base,
      form: form({ cw: "1000", ch: "1000" }),
      inpaint: inpaintOf(1000, 1000),
      sizeAccepted: true,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.params.size).toEqual({ w: 992, h: 992 });
  });

  it("描述为空：返回首条错误并要求聚焦描述框", () => {
    const r = draftToParams({ ...base, form: form({ prompt: "  " }) });
    expect(r).toEqual({
      ok: false,
      reason: "invalid",
      issue: "empty-prompt",
      focusPrompt: true,
    });
  });
});

describe("draftToParams：多比例", () => {
  const multiForm = (patch: Partial<GenForm> = {}): GenForm => ({
    ...DEFAULT_FORM,
    prompt: "一只猫",
    multi: true,
    ratios: ["1:1", "16:9"],
    n: 3,
    ...patch,
  });
  const base = {
    inpaint: null,
    sizeAccepted: false,
    reading: false,
  };

  it("多个比例：得到 sizes，n 固定为 1", () => {
    const r = draftToParams({ ...base, form: multiForm() });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.params.sizes).toEqual([
        { w: 1024, h: 1024 },
        { w: 1792, h: 1008 },
      ]);
      expect(r.params.n).toBe(1);
    }
  });

  it("局部重绘：不带 sizes，张数照常，输出尺寸取目标尺寸", () => {
    const r = draftToParams({
      ...base,
      form: multiForm(),
      inpaint: inpaintOf(1000, 1000),
      sizeAccepted: true,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.params.sizes).toBeUndefined();
      expect(r.params.n).toBe(3);
      expect(r.params.size).toEqual({ w: 992, h: 992 });
    }
  });
});
