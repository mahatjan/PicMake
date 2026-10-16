import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@heroui/react", () => ({ toast: vi.fn() }));
vi.mock("../db/history", () => ({
  deleteHistory: vi.fn(),
  toggleStar: vi.fn(),
}));
vi.mock("./generate", () => ({
  readInpaintDraft: vi.fn(),
  toastError: vi.fn(),
}));

import { toast } from "@heroui/react";
import { deleteHistory } from "../db/history";
import type { HistoryRow } from "../db/schema";
import type { PreparedGeneration } from "../lib/generation";
import { MAX_INPUT_IMAGES, type GenParams } from "../lib/types";
import { initialWorkspace, useWorkspace } from "../store/workspace";
import { selectRun } from "../store/workspace/selectors";
import {
  beginRun,
  beginSave,
  closeConfirm,
  finishSave,
  markUnsaved,
  patchForm,
  rowsLoaded,
  selectRecord,
  openLightbox,
  openPlayground,
  openVideoEntry,
  openVideoPreview,
  setVideoPrompt,
  setFocusIdx,
} from "../store/workspace/actions";
import {
  addAsReference,
  adjustInpaint,
  deleteRecord,
  editImage,
  newGeneration,
  requestLeave,
  reuseParams,
  selectHistory,
  switchByWheel,
} from "./navigation";
import { readInpaintDraft, toastError } from "./generate";

const state = () => useWorkspace.getState();
const params: GenParams = {
  model: "flare",
  prompt: "山",
  size: "auto",
  quality: "high",
  n: 1,
  background: "auto",
  outputFormat: "png",
};
const row = (id: string, imageIds = [`${id}-1`]): HistoryRow => ({
  id,
  prompt: id,
  params: { ...params, prompt: `提示-${id}` },
  usage: null,
  imageIds,
  createdAt: 1,
  durationMs: 1,
});
const plan = { n: 1, size: "auto" } as const;
const prepared = {
  row: row("u1"),
  images: [],
  sources: [],
} as PreparedGeneration;

/** 让微任务（deleteHistory().then、adjustInpaint 的 await）跑完 */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  useWorkspace.setState(initialWorkspace(), true);
  vi.mocked(toast).mockClear();
  vi.mocked(deleteHistory).mockReset();
  vi.mocked(toastError).mockClear();
  vi.mocked(readInpaintDraft).mockReset();
  rowsLoaded([row("c"), row("b"), row("a")]);
  selectRecord("b");
});

describe("requestLeave", () => {
  it("空闲且无草稿修改：直接离开", () => {
    const leave = vi.fn();
    requestLeave(leave);
    expect(leave).toHaveBeenCalledTimes(1);
    expect(state().confirm).toBeNull();
  });

  it.each(["generating", "saving"] as const)("%s：拦截，不弹确认", (phase) => {
    beginRun(plan);
    if (phase === "saving") beginSave(prepared);
    const leave = vi.fn();
    requestLeave(leave);
    expect(leave).not.toHaveBeenCalled();
    expect(state().confirm).toBeNull();
  });

  it("有未保存结果：先确认；确认后丢弃结果再离开", () => {
    beginRun(plan);
    beginSave(prepared);
    markUnsaved();
    const leave = vi.fn();
    requestLeave(leave);
    expect(leave).not.toHaveBeenCalled();
    expect(state().confirm?.title).toBe("放弃未保存结果？");
    state().confirm?.onOk();
    expect(selectRun(state()).phase).toBe("idle");
    expect(leave).toHaveBeenCalledTimes(1);
  });

  it("以展示记录为来源且结果未保存：直接拦截", () => {
    beginRun(plan);
    beginSave(prepared);
    markUnsaved();
    const leave = vi.fn();
    requestLeave(leave, true);
    expect(leave).not.toHaveBeenCalled();
    expect(state().confirm).toBeNull();
  });

  it("草稿有修改：先确认；确认后离开", () => {
    patchForm({ prompt: "改过" });
    const leave = vi.fn();
    requestLeave(leave);
    expect(state().confirm?.title).toBe("放弃当前草稿？");
    state().confirm?.onOk();
    expect(leave).toHaveBeenCalledTimes(1);
  });

  it("确认框打开期间开始了生成：确认后不再离开（延迟回调复核）", () => {
    patchForm({ prompt: "改过" });
    const leave = vi.fn();
    requestLeave(leave);
    const { onOk } = state().confirm!;
    beginRun(plan);
    onOk();
    expect(leave).not.toHaveBeenCalled();
  });

  it("未保存确认框打开期间开始了生成：确认后不丢弃也不离开", () => {
    beginRun(plan);
    beginSave(prepared);
    markUnsaved();
    const leave = vi.fn();
    requestLeave(leave);
    const { onOk } = state().confirm!;
    // 用户在确认框打开时通过其他途径丢弃并重新开始了生成
    beginRun(plan);
    onOk();
    expect(leave).not.toHaveBeenCalled();
    expect(selectRun(state()).phase).toBe("generating");
  });
});

describe("切换与新建", () => {
  it.each(["idle", "generating", "saving", "unsaved"] as const)(
    "%s：从视频页选择图片历史时自动关闭视频页并保留任务与视频草稿",
    (phase) => {
      if (phase !== "idle") beginRun(plan);
      if (phase === "saving" || phase === "unsaved") beginSave(prepared);
      if (phase === "unsaved") markUnsaved();
      openPlayground();
      setVideoPrompt("保留的视频描述");
      openVideoEntry("ref");
      openVideoPreview("video-preview");
      const { tasks, draft } = state();
      selectHistory("a");
      expect(state().nav.selectedId).toBe("a");
      expect(state().view.playgroundOpen).toBe(false);
      expect(state().video.previewId).toBeNull();
      expect(state().video.draft.entry).toBeNull();
      expect(state().video.draft.prompt).toBe("保留的视频描述");
      expect(state().tasks).toBe(tasks);
      expect(state().draft).toBe(draft);
    },
  );

  it.each([false, true])(
    "从视频页新建生成会退出视频页（后台任务：%s）",
    (running) => {
      if (running) beginRun(plan);
      openPlayground();
      setVideoPrompt("保留的视频描述");
      openVideoEntry("ref");
      openVideoPreview("video-preview");
      const tasks = state().tasks;
      newGeneration();
      expect(state().nav.selectedId).toBeNull();
      expect(state().view.playgroundOpen).toBe(false);
      expect(state().video.previewId).toBeNull();
      expect(state().video.draft.entry).toBeNull();
      expect(state().video.draft.prompt).toBe("保留的视频描述");
      expect(state().tasks).toBe(tasks);
    },
  );

  it("新建需要放弃图片草稿时，确认后才关闭视频页", () => {
    patchForm({ prompt: "保留的图片草稿" });
    openPlayground();
    newGeneration();
    expect(state().view.playgroundOpen).toBe(true);
    expect(state().confirm).not.toBeNull();
    state().confirm!.onOk();
    expect(state().view.playgroundOpen).toBe(false);
    expect(state().nav.selectedId).toBeNull();
  });

  it("选择不存在的历史记录不关闭视频页", () => {
    openPlayground();
    selectHistory("missing");
    expect(state().view.playgroundOpen).toBe(true);
  });

  it("selectHistory：切到目标记录", () => {
    selectHistory("a");
    expect(state().nav).toMatchObject({ selectedId: "a", lastDoneId: null });
  });

  it("newGeneration：取消选中", () => {
    newGeneration();
    expect(state().nav.selectedId).toBeNull();
  });

  it("查看历史记录保留草稿，不要求放弃修改", () => {
    patchForm({ prompt: "改过" });
    const draft = state().draft;
    selectHistory("a");
    expect(state().nav.selectedId).toBe("a");
    expect(state().draft).toBe(draft);
    expect(state().confirm).toBeNull();
  });

  it.each(["generating", "saving", "unsaved"] as const)(
    "%s：可以切换已完成记录，并保留任务和草稿",
    (phase) => {
      beginRun(plan);
      if (phase !== "generating") beginSave(prepared);
      if (phase === "unsaved") markUnsaved();
      patchForm({ prompt: "下一次生成的草稿" });
      const { draft, tasks } = state();
      selectHistory("b");
      openLightbox("b-1");
      setFocusIdx(0);
      selectHistory("a");
      expect(state().nav.selectedId).toBe("a");
      expect(state().draft).toBe(draft);
      expect(state().tasks).toBe(tasks);
      expect(state().view).toMatchObject({ lightboxId: null, focusIdx: null });
      expect(state().confirm).toBeNull();
    },
  );

  it("后台任务保存完毕不切走正在预览的作品", () => {
    beginRun(plan);
    selectHistory("a");
    openLightbox("a-1");
    beginSave(prepared);
    expect(state().nav.selectedId).toBe("a");
    finishSave(prepared);
    expect(state().nav.selectedId).toBe("a");
    expect(state().view.lightboxId).toBe("a-1");
  });

  it("后台生成时回首页不取消任务或清空新草稿", () => {
    beginRun(plan);
    patchForm({ prompt: "下一张" });
    selectHistory("a");
    const { draft, tasks } = state();
    newGeneration();
    expect(state().nav.selectedId).toBeNull();
    expect(state().draft).toBe(draft);
    expect(state().tasks).toBe(tasks);
    expect(state().confirm).toBeNull();
  });

  it("不存在的历史记录不改变当前查看目标", () => {
    selectHistory("missing");
    expect(state().nav.selectedId).toBe("b");
  });
});

describe("switchByWheel", () => {
  it("向下切到更旧的一条，向上切到更新的一条", () => {
    switchByWheel(1);
    expect(state().nav.selectedId).toBe("a");
    switchByWheel(-1);
    expect(state().nav.selectedId).toBe("b");
  });

  it("已在边界：不切换", () => {
    selectRecord("c");
    switchByWheel(-1);
    expect(state().nav.selectedId).toBe("c");
    selectRecord("a");
    switchByWheel(1);
    expect(state().nav.selectedId).toBe("a");
  });
});

describe("reuseParams", () => {
  it("回填参数、取消选中并提示", () => {
    reuseParams("a");
    expect(state().draft.form.prompt).toBe("提示-a");
    expect(state().nav.selectedId).toBeNull();
    expect(state().view.barMode).toBe("full");
    expect(toast).toHaveBeenCalledWith("参数已回填，可直接生成");
  });

  it("记录不存在：忽略", () => {
    reuseParams("missing");
    expect(state().nav.selectedId).toBe("b");
    expect(toast).not.toHaveBeenCalled();
  });
});

describe("editImage", () => {
  it("以展示记录的这张图为唯一输入开新草稿，并记住返回目标", () => {
    rowsLoaded([row("c"), row("b", ["b-1", "b-2"]), row("a")]);
    editImage("b-2");
    // 系统来源不再写入显示名：名字在展示时按当前语言生成
    expect(state().draft.inputs).toEqual([
      { generationId: "b", imageId: "b-2" },
    ]);
    expect(state().draft.form.prompt).toBe("");
    expect(state().nav).toMatchObject({ selectedId: null, returnId: "b" });
  });

  it("来源记录在请求时确定：确认框打开后切换选中也不改变来源", () => {
    patchForm({ prompt: "改过" });
    editImage("b-1");
    const { onOk } = state().confirm!;
    selectRecord("a");
    onOk();
    expect(state().nav.returnId).toBe("b");
    expect(state().draft.inputs[0].generationId).toBe("b");
  });

  it("没有展示中的记录：忽略", () => {
    selectRecord(null);
    editImage("x");
    expect(state().draft.inputs).toEqual([]);
  });
});

describe("addAsReference", () => {
  it("追加展示记录的图片为参考图，不打断草稿", () => {
    patchForm({ prompt: "已写" });
    addAsReference();
    expect(state().draft.inputs.map((i) => i.imageId)).toEqual(["b-1"]);
    expect(state().draft.form.prompt).toBe("已写");
    expect(toast).toHaveBeenCalledWith("已加入参考图，继续描述后生成");
  });

  it("参考图已满：提示上限", () => {
    for (let i = 0; i < MAX_INPUT_IMAGES; i++) {
      rowsLoaded([row("c"), row(`r${i}`, [`r${i}-1`]), row("b"), row("a")]);
      selectRecord(`r${i}`);
      addAsReference();
    }
    vi.mocked(toast).mockClear();
    selectRecord("a");
    addAsReference();
    expect(state().draft.inputs).toHaveLength(MAX_INPUT_IMAGES);
    expect(toast).toHaveBeenCalledWith("最多添加 16 张输入图片。");
  });

  it("生成中：忽略", () => {
    beginRun(plan);
    addAsReference();
    expect(state().draft.inputs).toEqual([]);
  });
});

describe("deleteRecord", () => {
  it("弹确认；确认后删除并提示", async () => {
    vi.mocked(deleteHistory).mockResolvedValue();
    deleteRecord("b");
    expect(state().confirm?.title).toBe("删除这次生成？");
    state().confirm?.onOk();
    expect(deleteHistory).toHaveBeenCalledWith("b");
    await flush();
    expect(toast).toHaveBeenCalledWith("已删除");
  });

  it("删的是当前记录：草稿复位", async () => {
    vi.mocked(deleteHistory).mockResolvedValue();
    patchForm({ prompt: "改过" });
    deleteRecord("b");
    state().confirm?.onOk();
    await flush();
    expect(state().draft).toMatchObject({ dirty: false });
    expect(state().draft.form.prompt).toBe("");
  });

  it("删的不是当前记录：选中与草稿都保持不变", async () => {
    vi.mocked(deleteHistory).mockResolvedValue();
    patchForm({ prompt: "改过" });
    deleteRecord("a");
    state().confirm?.onOk();
    await flush();
    expect(state().nav.selectedId).toBe("b");
    expect(state().draft.form.prompt).toBe("改过");
  });

  it("是否当前记录在请求时确定：确认前切换选中，仍按请求时的判断复位", async () => {
    vi.mocked(deleteHistory).mockResolvedValue();
    patchForm({ prompt: "改过" });
    deleteRecord("b");
    const { onOk } = state().confirm!;
    selectRecord("a");
    onOk();
    await flush();
    expect(state().draft.form.prompt).toBe("");
  });

  it("删除失败：只弹错误，不提示已删除", async () => {
    const error = new Error("boom");
    vi.mocked(deleteHistory).mockRejectedValue(error);
    deleteRecord("a");
    state().confirm?.onOk();
    await flush();
    expect(toastError).toHaveBeenCalledWith(error);
    expect(toast).not.toHaveBeenCalledWith("已删除");
  });

  it("非空闲或记录不存在：不弹确认", () => {
    deleteRecord("missing");
    expect(state().confirm).toBeNull();
    beginRun(plan);
    deleteRecord("a");
    expect(state().confirm).toBeNull();
  });

  it("确认框打开期间开始了生成：确认后不删除", () => {
    deleteRecord("a");
    const { onOk } = state().confirm!;
    beginRun(plan);
    onOk();
    expect(deleteHistory).not.toHaveBeenCalled();
    closeConfirm();
  });

  it("删除期间开始了生成：不再复位草稿", async () => {
    let finish: () => void = () => {};
    vi.mocked(deleteHistory).mockReturnValue(
      new Promise<void>((resolve) => (finish = resolve)),
    );
    deleteRecord("b");
    state().confirm?.onOk();
    beginRun(plan);
    patchForm({ prompt: "属于这次生成" });
    finish();
    await flush();
    expect(state().draft.form.prompt).toBe("属于这次生成");
    expect(state().nav.selectedId).toBeNull(); // beginRun 已清空选中，删除回调未再改动
  });
});

describe("adjustInpaint", () => {
  const read = {
    ok: false as const,
    missing: { kind: "reference" as const, name: "遮罩图" },
  };

  it("资源缺失：提示并保持原状", async () => {
    vi.mocked(readInpaintDraft).mockResolvedValue(read);
    adjustInpaint("a");
    await flush();
    expect(toast).toHaveBeenCalledWith(
      "参考图「遮罩图」不可用，无法恢复上次重绘",
    );
    expect(state().draft.inputs).toEqual([]);
  });

  it("读取期间开始了生成：丢弃结果，不改草稿也不提示", async () => {
    let resolve: (v: typeof read) => void = () => {};
    vi.mocked(readInpaintDraft).mockReturnValue(
      new Promise((r) => (resolve = r)),
    );
    adjustInpaint("a");
    beginRun(plan);
    resolve(read);
    await flush();
    expect(toast).not.toHaveBeenCalled();
  });

  it("记录不存在：忽略", () => {
    adjustInpaint("missing");
    expect(readInpaintDraft).not.toHaveBeenCalled();
  });
});
