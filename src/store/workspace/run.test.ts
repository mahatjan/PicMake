import { beforeEach, describe, expect, it } from "vitest";
import type { HistoryRow } from "../../db/schema";
import type { PreparedGeneration } from "../../lib/generation";
import { initialWorkspace, useWorkspace } from "./index";
import {
  beginRun,
  beginSave,
  discardUnsaved,
  endRun,
  finishSave,
  initializeDraft,
  markSubmitted,
  markUnsaved,
  openDrawer,
  openLightbox,
  patchForm,
  recordDeleted,
  resetWorkspace,
  rowsLoaded,
  selectRecord,
  setFocusIdx,
  setLastDoneId,
  setPartial,
  setPreviewId,
  setReturnId,
  setSlotDone,
  setSlotFailed,
  setSlotPartial,
} from "./actions";
import {
  findRow,
  selectDisplayRow,
  selectPending,
  selectRun,
  selectRunDone,
  selectRunTotal,
  selectSelectedImageId,
} from "./selectors";

const state = () => useWorkspace.getState();
const plan = { n: 1, size: "auto" } as const;
const row = (id: string, imageIds = [`${id}-1`]) =>
  ({ id, imageIds }) as HistoryRow;
const prepared = (id: string, imageCount = 1): PreparedGeneration => {
  const imageIds = Array.from({ length: imageCount }, (_, i) => `${id}-${i}`);
  return {
    row: row(id, imageIds),
    images: imageIds.map((imageId) => ({
      id: imageId,
      blob: new Blob(),
      width: 1024,
      height: 1024,
      format: "png",
    })),
    sources: [],
  };
};

beforeEach(() => {
  useWorkspace.setState(initialWorkspace(), true);
});

describe("生成生命周期", () => {
  it("markSubmitted：只清空描述，保留参数、输入图与提交前快照", () => {
    initializeDraft(undefined, [{ imageId: "reference" }]);
    patchForm({ prompt: "猫", ratio: "9:16", quality: "high" });
    const before = state().draft;
    markSubmitted();
    expect(state().draft.form).toEqual({ ...before.form, prompt: "" });
    expect(state().draft.inputs).toBe(before.inputs);
    expect(state().draft.dirty).toBe(false);
    expect(before.form.prompt).toBe("猫");
  });

  it("beginRun：只能从 idle 进入；清空选中、完成标记、过渡结果与查看状态，保留返回目标与草稿", () => {
    finishSave(prepared("old"));
    setReturnId("src");
    patchForm({ prompt: "猫" });
    setFocusIdx(1);
    openLightbox("img");
    setPreviewId("in");
    openDrawer();
    expect(beginRun(plan)).toBe(true);
    expect(selectRun(state())).toEqual({
      phase: "generating",
      plan,
      partial: null,
      slots: null,
    });
    expect(state().history.recent).toBeNull();
    expect(state().nav).toEqual({
      selectedId: null,
      returnId: "src",
      lastDoneId: null,
    });
    expect(state().view).toMatchObject({
      focusIdx: null,
      lightboxId: null,
      previewId: null,
      drawerOpen: true,
    });
    expect(state().draft.form.prompt).toBe("猫");

    const before = state();
    const id = state().tasks[0].id;
    expect(beginRun(plan, { id, prompt: "duplicate", model: "flare" })).toBe(
      false,
    );
    expect(state()).toBe(before);
    expect(beginRun({ n: 2, size: "auto" })).toBe(true);
    expect(state().tasks).toHaveLength(2);
  });

  it("setPartial：只在生成中更新，其余阶段忽略", () => {
    const blob = new Blob();
    setPartial(blob, 0);
    expect(selectRun(state())).toEqual({ phase: "idle" });
    beginRun(plan);
    setPartial(blob, 2);
    expect(selectRun(state())).toMatchObject({ partial: { blob, index: 2 } });
    beginSave(prepared("a"));
    const before = state();
    setPartial(new Blob(), 3);
    expect(state()).toBe(before);
  });

  it("endRun：取消或失败回到 idle，草稿保留；保存阶段不受影响", () => {
    patchForm({ prompt: "猫" });
    beginRun(plan);
    endRun();
    expect(selectRun(state())).toEqual({ phase: "idle" });
    expect(state().draft).toMatchObject({ dirty: true });
    beginRun(plan);
    beginSave(prepared("a"));
    endRun();
    expect(selectRun(state()).phase).toBe("saving");
  });

  it("保存失败：saving → unsaved，结果留在内存并作为展示记录；放弃后回到 idle", () => {
    const p = prepared("a");
    beginRun(plan);
    beginSave(p);
    expect(selectPending(state())).toBe(p);
    expect(selectDisplayRow(state())).toBe(p.row);
    markUnsaved();
    expect(selectRun(state())).toEqual({ phase: "unsaved", prepared: p });
    expect(selectDisplayRow(state())).toBe(p.row);
    discardUnsaved();
    expect(selectRun(state())).toEqual({ phase: "idle" });
    expect(selectPending(state())).toBeNull();
  });

  it("markUnsaved、discardUnsaved：不在对应阶段时忽略", () => {
    const before = state();
    markUnsaved();
    discardUnsaved();
    expect(state()).toBe(before);
    beginRun(plan);
    beginSave(prepared("a"));
    discardUnsaved();
    expect(selectRun(state()).phase).toBe("saving");
  });

  it("finishSave：留在首页画廊并进入 complete 态，草稿重置但保留参数", () => {
    const p = prepared("a");
    patchForm({ prompt: "猫", quality: "high" });
    setReturnId("src");
    markSubmitted();
    beginRun(plan);
    beginSave(p);
    finishSave(p);
    expect(selectRun(state())).toEqual({ phase: "idle" });
    expect(state().history.recent).toBe(p);
    // 不选中新记录：画廊据此展示它（列表回推前由 recent 过渡）
    expect(state().nav).toEqual({
      selectedId: null,
      returnId: null,
      lastDoneId: "a",
    });
    expect(state().draft).toMatchObject({ inputs: [], dirty: false });
    expect(state().draft.form).toMatchObject({ prompt: "", quality: "high" });
  });

  it("finishSave：提交后草稿又被改过（正在写下一条）就原样留着，不冲掉", () => {
    const p = prepared("a");
    patchForm({ prompt: "猫" });
    markSubmitted();
    beginRun(plan);
    // 生成期间用户接着写下一条
    patchForm({ prompt: "狗" });
    beginSave(p);
    finishSave(p);
    expect(state().draft).toMatchObject({ dirty: true });
    expect(state().draft.form.prompt).toBe("狗");
  });
});

describe("展示记录", () => {
  it("列表回推前不占着舞台（画廊展示刚保存的记录）；点开它才从列表取记录", () => {
    const p = prepared("a");
    rowsLoaded([row("old")]);
    finishSave(p);
    // 没有选中：舞台无展示记录，画廊负责显示新记录
    expect(state().nav.selectedId).toBeNull();
    expect(selectDisplayRow(state())).toBeNull();
    const listed = row("a", p.row.imageIds);
    rowsLoaded([listed, row("old")]);
    expect(state().history.recent).toBe(p);
    // 点开该记录后从列表解析
    selectRecord("a");
    expect(selectDisplayRow(state())).toBe(listed);
  });

  it("过渡结果只对它自己的 id 生效；删除后不再从内存显示", () => {
    const p = prepared("a");
    rowsLoaded([row("old")]);
    finishSave(p);
    selectRecord("old");
    expect(selectDisplayRow(state())?.id).toBe("old");
    selectRecord("a");
    recordDeleted("other");
    expect(state().history.recent).toBe(p);
    recordDeleted("a");
    expect(state().history.recent).toBeNull();
    expect(selectDisplayRow(state())).toBeNull();
  });

  it("findRow：列表里的、保存中或保存失败的、刚保存还没回推的都能找到", () => {
    const listed = row("listed");
    const unsaved = prepared("unsaved");
    const saved = prepared("saved");
    rowsLoaded([listed]);
    beginRun(plan);
    beginSave(unsaved);
    markUnsaved();
    expect(findRow(state(), "listed")).toBe(listed);
    expect(findRow(state(), "unsaved")).toBe(unsaved.row);
    expect(findRow(state(), "missing")).toBeNull();
    discardUnsaved();
    expect(findRow(state(), "unsaved")).toBeNull();
    beginRun(plan);
    beginSave(saved);
    finishSave(saved);
    expect(findRow(state(), "saved")).toBe(saved.row);
    beginRun(plan);
    expect(findRow(state(), "saved")).toBeNull();
  });

  it("selectSelectedImageId：单张取那张，多张取轮播所在的那张", () => {
    rowsLoaded([row("one"), row("many", ["m0", "m1", "m2"])]);
    selectRecord("one");
    expect(selectSelectedImageId(state())).toBe("one-1");
    selectRecord("many");
    expect(selectSelectedImageId(state())).toBeNull();
    setFocusIdx(2);
    expect(selectSelectedImageId(state())).toBe("m2");
    setFocusIdx(5);
    expect(selectSelectedImageId(state())).toBeNull();
  });
});

describe("resetWorkspace", () => {
  it("清空返回目标、完成标记、草稿与查看状态；不传参数保留选中项", () => {
    rowsLoaded([row("a"), row("b")]);
    selectRecord("a");
    setReturnId("b");
    setLastDoneId("a");
    initializeDraft(undefined, [{ imageId: "x" }]);
    patchForm({ prompt: "猫", quality: "high" });
    setFocusIdx(1);
    openLightbox("img");
    openDrawer();
    resetWorkspace();
    expect(state().nav).toEqual({
      selectedId: "a",
      returnId: null,
      lastDoneId: null,
    });
    expect(state().draft).toMatchObject({ inputs: [], dirty: false });
    expect(state().draft.form).toMatchObject({ prompt: "", quality: "high" });
    expect(state().view).toMatchObject({
      focusIdx: null,
      lightboxId: null,
      drawerOpen: true,
    });
  });

  it("传 id 切换选中，传 null 清空选中；不改变生成阶段", () => {
    rowsLoaded([row("a"), row("b")]);
    resetWorkspace("b");
    expect(state().nav.selectedId).toBe("b");
    resetWorkspace(null);
    expect(state().nav.selectedId).toBeNull();
    beginRun(plan);
    beginSave(prepared("c"));
    markUnsaved();
    resetWorkspace("a");
    expect(selectRun(state()).phase).toBe("unsaved");
  });
});

describe("多尺寸生成中的槽位", () => {
  const sizes = [
    { w: 1024, h: 1024 },
    { w: 1792, h: 1008 },
    { w: 1008, h: 1792 },
  ];
  const multiPlan = { n: 1, size: sizes[0], sizes };
  const slots = () => {
    const run = selectRun(state());
    if (run.phase !== "generating" || !run.slots) throw new Error("no slots");
    return run.slots;
  };

  it("beginRun：每个尺寸一个运行中的槽位；单尺寸没有槽位", () => {
    expect(beginRun(multiPlan)).toBe(true);
    expect(slots().map((slot) => [slot.size, slot.status])).toEqual(
      sizes.map((size) => [size, "running"]),
    );
    expect(selectRunTotal(state())).toBe(3);
    expect(selectRunDone(state())).toBe(0);
    endRun();
    beginRun(plan);
    expect(selectRun(state())).toMatchObject({ slots: null });
    expect(selectRunTotal(state())).toBe(0);
  });

  it("各槽位独立：预览、完成、失败互不影响，完成数随之递增", () => {
    beginRun(multiPlan);
    const preview = new Blob(["p"]);
    const final = new Blob(["f"]);
    setSlotPartial(1, preview);
    expect(slots()[1]).toMatchObject({ status: "running", partial: preview });
    expect(slots()[0].partial).toBeNull();

    setSlotDone(1, final);
    expect(slots()[1]).toMatchObject({
      status: "done",
      partial: null,
      final,
    });
    expect(selectRunDone(state())).toBe(1);

    setSlotFailed(2, "rate-limit");
    expect(slots()[2]).toMatchObject({
      status: "failed",
      failure: "rate-limit",
    });
    // 失败不算已完成；其余槽位继续
    expect(selectRunDone(state())).toBe(1);
    expect(slots()[0].status).toBe("running");
  });

  it("已结束的槽位忽略迟到的事件", () => {
    beginRun(multiPlan);
    const final = new Blob(["f"]);
    setSlotDone(0, final);
    setSlotPartial(0, new Blob(["late"]));
    setSlotFailed(0, "server");
    expect(slots()[0]).toMatchObject({ status: "done", final, failure: null });
  });

  it("不在生成中、越界的下标：忽略", () => {
    setSlotPartial(0, new Blob());
    expect(selectRun(state())).toEqual({ phase: "idle" });
    beginRun(multiPlan);
    const before = state();
    setSlotPartial(9, new Blob());
    setSlotDone(-1, new Blob());
    expect(state()).toBe(before);
    endRun();
    setSlotDone(0, new Blob());
    expect(selectRun(state())).toEqual({ phase: "idle" });
  });
});
