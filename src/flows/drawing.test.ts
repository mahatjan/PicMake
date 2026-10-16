import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@heroui/react", () => ({ toast: vi.fn() }));
vi.mock("../db/schema", () => ({ db: { images: { get: vi.fn() } } }));
vi.mock("../lib/sketch-canvas", () => ({ exportSketchPng: vi.fn() }));
vi.mock("./export", () => ({ downloadFile: vi.fn() }));
vi.mock("../lib/inpaint-canvas", () => ({ exportMaskPng: vi.fn() }));
vi.mock("../lib/image-orientation", () => ({
  readImageMeta: vi.fn(),
  prepareInpaintBase: vi.fn(),
}));

import { toast } from "@heroui/react";
import { db, type ImageRow } from "../db/schema";
import { prepareInpaintBase, readImageMeta } from "../lib/image-orientation";
import { exportMaskPng } from "../lib/inpaint-canvas";
import { blankMask } from "../lib/inpaint";
import { blankSketch } from "../lib/sketch";
import { exportSketchPng } from "../lib/sketch-canvas";
import {
  MAX_INPUT_IMAGES,
  type InputImage,
  type SketchCommand,
} from "../lib/types";
import { initialWorkspace, useWorkspace } from "../store/workspace";
import {
  beginRun,
  closeDrawing,
  initializeDraft,
  openInpaint,
  openSketch,
  patchForm,
  setConfirm,
  strokeMask,
  strokeSketch,
  undoDrawing,
} from "../store/workspace/actions";
import {
  confirmInpaint,
  confirmSketch,
  downloadSketch,
  editSketchAttachment,
  openSketchNew,
  requestCloseInpaint,
  requestCloseSketch,
  startInpaintFromInput,
} from "./drawing";
import { downloadFile } from "./export";

const state = () => useWorkspace.getState();
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const image = (id: string, width = 1024, height = 1024): ImageRow => ({
  id,
  blob: new Blob(["x"]),
  width,
  height,
  format: "png",
});
const stroke = (x: number): SketchCommand => ({
  type: "stroke",
  tool: "pen",
  color: "#000",
  width: 3,
  points: [{ x, y: x }],
});
const input = (id: string, upload?: ImageRow): InputImage => ({
  imageId: id,
  name: id,
  upload,
});

/** 打开一个局部重绘会话（跳过底图准备） */
function openInpaintSession(base = image("base")) {
  const id = "ip-1";
  useWorkspace.setState({ drawing: { kind: "opening", id } });
  openInpaint(id, {
    entry: "draft-input",
    base,
    normalized: false,
    doc: blankMask(base.id, base.width, base.height),
    naming: { kind: "base" },
    chosenInputId: "base",
  });
  return id;
}

beforeEach(() => {
  useWorkspace.setState(initialWorkspace(), true);
  vi.mocked(toast).mockClear();
  vi.mocked(db.images.get).mockReset();
  vi.mocked(exportSketchPng).mockReset();
  vi.mocked(downloadFile).mockReset();
  vi.mocked(exportMaskPng).mockReset();
  vi.mocked(readImageMeta).mockReset();
  vi.mocked(prepareInpaintBase).mockReset();
});

describe("openSketchNew", () => {
  it("输出尺寸为 auto：打开 1024 × 1024 空白画布", () => {
    patchForm({ ratio: "auto" });
    openSketchNew();
    expect(state().drawing).toMatchObject({
      kind: "sketch",
      origin: { kind: "new" },
      doc: { width: 1024, height: 1024 },
      cursor: 0,
    });
  });

  it("沿用当前输出尺寸", () => {
    patchForm({ cw: "1280", ch: "960" });
    openSketchNew();
    expect(state().drawing).toMatchObject({
      origin: { kind: "new" },
      doc: { width: 1280, height: 960 },
    });
  });

  it("输入图已满且没有可替换的草图：提示上限，不打开", () => {
    initializeDraft(
      undefined,
      Array.from({ length: MAX_INPUT_IMAGES }, (_, i) => input(`i${i}`)),
    );
    openSketchNew();
    expect(state().drawing).toBeNull();
    expect(toast).toHaveBeenCalledWith("最多添加 16 张输入图片。");
  });

  it.each([
    ["生成中", () => beginRun({ n: 1, size: "auto" })],
    ["已有画板", () => openSketch(blankSketch(8, 8), { kind: "new" }, null)],
    ["确认框打开", () => setConfirm({ title: "t", desc: "d", onOk: () => {} })],
  ])("%s：忽略", (_, setup) => {
    setup();
    const before = state().drawing;
    openSketchNew();
    expect(state().drawing).toBe(before);
  });
});

describe("editSketchAttachment", () => {
  it("附件的草图数据损坏：提示重画，不打开", () => {
    const broken = {
      ...image("sk"),
      sketch: { bad: true },
    } as unknown as ImageRow;
    initializeDraft(undefined, [input("sk", broken)]);
    editSketchAttachment("sk");
    expect(state().drawing).toBeNull();
    expect(toast).toHaveBeenCalledWith("草图数据无法读取，请重新画一张");
  });

  it("有效草图：打开并记住要原位替换的附件", () => {
    const sketch = blankSketch(640, 480);
    initializeDraft(undefined, [
      input("a"),
      input("sk", { ...image("sk", 640, 480), sketch }),
    ]);
    editSketchAttachment("sk");
    expect(state().drawing).toMatchObject({
      kind: "sketch",
      replacesImageId: "sk",
      origin: { kind: "attachment", index: 2 },
    });
  });
});

describe("downloadSketch", () => {
  const open = () => {
    openSketch(blankSketch(100, 80), { kind: "new" }, null);
    strokeSketch(stroke(1));
    return state().drawing!.id;
  };

  it("下载当前游标处的 PNG，画板、重做分支和草稿保持不变", async () => {
    const id = open();
    strokeSketch(stroke(2));
    undoDrawing();
    const before = state();
    const blob = new Blob(["png"], { type: "image/png" });
    const createUrl = vi.fn(() => "blob:sketch");
    vi.mocked(exportSketchPng).mockResolvedValue(blob);

    await downloadSketch(createUrl);

    expect(exportSketchPng).toHaveBeenCalledWith({
      ...blankSketch(100, 80),
      commands: [stroke(1)],
    });
    expect(createUrl).toHaveBeenCalledWith(blob);
    expect(downloadFile).toHaveBeenCalledWith(
      "blob:sketch",
      `PicMake-sketch-${id.slice(0, 8)}-100x80.png`,
    );
    expect(state().drawing).toEqual(before.drawing);
    expect(state().draft).toBe(before.draft);
  });

  it("保存期间拦截重复下载、使用草图与关闭请求，完成后可再次保存", async () => {
    open();
    const createUrl = vi.fn(() => "blob:sketch");
    vi.mocked(exportSketchPng).mockResolvedValue(new Blob(["png"]));
    const pending = downloadSketch(createUrl);
    expect(state().drawing).toMatchObject({ confirming: true });
    const repeated = downloadSketch(createUrl);
    confirmSketch();
    requestCloseSketch();
    expect(exportSketchPng).toHaveBeenCalledTimes(1);
    expect(state().confirm).toBeNull();
    await Promise.all([pending, repeated]);
    await downloadSketch(createUrl);
    expect(downloadFile).toHaveBeenCalledTimes(2);
    expect(state().drawing).toMatchObject({ confirming: false });
  });

  it.each(["null", "throw"])(
    "导出失败（%s）：提示且可重试",
    async (failure) => {
      open();
      const createUrl = vi.fn(() => "blob:sketch");
      if (failure === "null")
        vi.mocked(exportSketchPng).mockResolvedValue(null);
      else vi.mocked(exportSketchPng).mockRejectedValue(new Error("canvas"));
      await downloadSketch(createUrl);
      expect(toast).toHaveBeenCalledWith("草图导出失败，请重试");
      expect(state().drawing).toMatchObject({ confirming: false, cursor: 1 });
      expect(createUrl).not.toHaveBeenCalled();
      expect(downloadFile).not.toHaveBeenCalled();

      vi.mocked(exportSketchPng).mockResolvedValue(new Blob(["png"]));
      await downloadSketch(createUrl);
      expect(downloadFile).toHaveBeenCalledOnce();
    },
  );

  it("下载失败：解锁画板并提示", async () => {
    open();
    vi.mocked(exportSketchPng).mockResolvedValue(new Blob(["png"]));
    vi.mocked(downloadFile).mockImplementation(() => {
      throw new Error("download");
    });
    await downloadSketch(() => "blob:sketch");
    expect(state().drawing).toMatchObject({ confirming: false });
    expect(toast).toHaveBeenCalledWith("草图导出失败，请重试");
  });

  it.each([false, true])(
    "异步导出后会话已关闭或替换（%s）：丢弃结果",
    async (replace) => {
      const id = open();
      const createUrl = vi.fn(() => "blob:sketch");
      vi.mocked(exportSketchPng).mockResolvedValue(new Blob(["png"]));
      const pending = downloadSketch(createUrl);
      closeDrawing(id);
      if (replace) openSketch(blankSketch(64, 64), { kind: "new" }, null);
      const current = state().drawing;
      await pending;
      expect(state().drawing).toBe(current);
      expect(createUrl).not.toHaveBeenCalled();
      expect(downloadFile).not.toHaveBeenCalled();
      expect(toast).not.toHaveBeenCalled();
    },
  );

  it("没有草图会话或处于局部重绘时忽略下载", async () => {
    const createUrl = vi.fn(() => "blob:sketch");
    await downloadSketch(createUrl);
    openInpaintSession();
    await downloadSketch(createUrl);
    expect(exportSketchPng).not.toHaveBeenCalled();
    expect(createUrl).not.toHaveBeenCalled();
  });
});

describe("confirmSketch", () => {
  const open = () => {
    openSketch(blankSketch(100, 80), { kind: "new" }, null);
    strokeSketch(stroke(1));
    return state().drawing!.id;
  };

  it("成功：落成草图附件并关闭画板", async () => {
    open();
    vi.mocked(exportSketchPng).mockResolvedValue(new Blob(["png"]));
    confirmSketch();
    await flush();
    expect(state().drawing).toBeNull();
    expect(state().draft.inputs).toHaveLength(1);
    expect(state().draft.inputs[0].upload?.sketch).toBeDefined();
  });

  it("导出期间画板已被关闭：丢弃结果，不产生附件", async () => {
    const id = open();
    vi.mocked(exportSketchPng).mockResolvedValue(new Blob(["png"]));
    confirmSketch();
    closeDrawing(id);
    await flush();
    expect(state().draft.inputs).toEqual([]);
  });

  it("导出期间换成了新的画板会话：旧结果不会落进来", async () => {
    open();
    vi.mocked(exportSketchPng).mockResolvedValue(new Blob(["png"]));
    confirmSketch();
    closeDrawing();
    openSketch(blankSketch(10, 10), { kind: "history" }, null);
    await flush();
    expect(state().draft.inputs).toEqual([]);
    expect(state().drawing).toMatchObject({ origin: { kind: "history" } });
  });

  it("导出失败：画板保留、可重试，并提示", async () => {
    open();
    vi.mocked(exportSketchPng).mockResolvedValue(null);
    confirmSketch();
    await flush();
    expect(state().drawing).toMatchObject({
      kind: "sketch",
      confirming: false,
    });
    expect(toast).toHaveBeenCalledWith("草图导出失败，请重试");
  });

  it("输入图已满（确认期间被填满）：画板保留并提示上限", async () => {
    open();
    vi.mocked(exportSketchPng).mockImplementation(async () => {
      initializeDraft(
        undefined,
        Array.from({ length: MAX_INPUT_IMAGES }, (_, i) => input(`i${i}`)),
      );
      return new Blob(["png"]);
    });
    confirmSketch();
    await flush();
    expect(state().drawing).toMatchObject({
      kind: "sketch",
      confirming: false,
    });
    expect(toast).toHaveBeenCalledWith("最多添加 16 张输入图片。");
  });

  it("确认中重复触发：只导出一次", async () => {
    open();
    vi.mocked(exportSketchPng).mockResolvedValue(new Blob(["png"]));
    confirmSketch();
    confirmSketch();
    await flush();
    expect(exportSketchPng).toHaveBeenCalledTimes(1);
  });

  it("编辑已有草图但没有实质修改：沿用原附件，不导出", async () => {
    const sketch = { ...blankSketch(100, 80), commands: [stroke(1)] };
    initializeDraft(undefined, [
      input("sk", { ...image("sk", 100, 80), sketch }),
    ]);
    editSketchAttachment("sk");
    confirmSketch();
    await flush();
    expect(exportSketchPng).not.toHaveBeenCalled();
    expect(state().drawing).toBeNull();
    expect(state().draft.inputs.map((i) => i.imageId)).toEqual(["sk"]);
  });
});

describe("requestCloseSketch", () => {
  it("没有修改：直接关闭", () => {
    openSketch(blankSketch(10, 10), { kind: "new" }, null);
    requestCloseSketch();
    expect(state().drawing).toBeNull();
    expect(state().confirm).toBeNull();
  });

  it("有修改：先确认；确认只关闭发起时的会话", () => {
    openSketch(blankSketch(10, 10), { kind: "new" }, null);
    strokeSketch(stroke(1));
    requestCloseSketch();
    expect(state().drawing).not.toBeNull();
    expect(state().confirm?.title).toBe("放弃本次草图修改？");
    const { onOk } = state().confirm!;
    closeDrawing();
    openSketch(blankSketch(20, 20), { kind: "history" }, null);
    onOk();
    expect(state().drawing).toMatchObject({ origin: { kind: "history" } });
  });

  it("确认导出中：忽略", () => {
    openSketch(blankSketch(10, 10), { kind: "new" }, null);
    strokeSketch(stroke(1));
    useWorkspace.setState((s) => ({
      drawing: s.drawing && ({ ...s.drawing, confirming: true } as never),
    }));
    requestCloseSketch();
    expect(state().confirm).toBeNull();
  });
});

describe("startInpaintFromInput", () => {
  const meta = { orientation: 1 as const, width: 1024, height: 768 };
  const ready = () => {
    initializeDraft(undefined, [input("src", image("src", 1024, 768))]);
    vi.mocked(readImageMeta).mockResolvedValue(meta);
    vi.mocked(prepareInpaintBase).mockResolvedValue({
      ok: true,
      base: image("base", 1024, 768),
    });
  };

  it("成功：打开重绘画板，入口为 draft-input", async () => {
    ready();
    startInpaintFromInput("src");
    expect(state().drawing?.kind).toBe("opening");
    await flush();
    expect(state().drawing).toMatchObject({
      kind: "inpaint",
      entry: "draft-input",
      chosenInputId: "src",
    });
  });

  it("准备底图期间被关闭：丢弃，不会再打开", async () => {
    ready();
    startInpaintFromInput("src");
    await Promise.resolve();
    closeDrawing();
    await flush();
    expect(state().drawing).toBeNull();
  });

  it("底图解码准备期间被关闭：结果丢弃，不会再打开也不提示", async () => {
    initializeDraft(undefined, [input("src", image("src", 1024, 768))]);
    vi.mocked(readImageMeta).mockResolvedValue(meta);
    let finish: (
      v: Awaited<ReturnType<typeof prepareInpaintBase>>,
    ) => void = () => {};
    vi.mocked(prepareInpaintBase).mockReturnValue(
      new Promise((resolve) => (finish = resolve)),
    );
    startInpaintFromInput("src");
    await flush();
    expect(prepareInpaintBase).toHaveBeenCalledTimes(1);
    closeDrawing();
    finish({ ok: true, base: image("base", 1024, 768) });
    await flush();
    expect(state().drawing).toBeNull();
    expect(toast).not.toHaveBeenCalled();
  });

  it("读头发现超限：关闭占位并提示原因", async () => {
    initializeDraft(undefined, [input("src", image("src"))]);
    vi.mocked(readImageMeta).mockResolvedValue({ issue: "pixel-limit" });
    startInpaintFromInput("src");
    await flush();
    expect(state().drawing).toBeNull();
    expect(toast).toHaveBeenCalledWith(
      "图片像素过多（超过 16,777,216 像素总量），请缩小后再使用局部重绘",
    );
  });

  it("底图准备失败：关闭占位并提示原因", async () => {
    initializeDraft(undefined, [input("src", image("src"))]);
    vi.mocked(readImageMeta).mockResolvedValue(meta);
    vi.mocked(prepareInpaintBase).mockResolvedValue({
      ok: false,
      issue: "canvas-failed",
    });
    startInpaintFromInput("src");
    await flush();
    expect(state().drawing).toBeNull();
    expect(toast).toHaveBeenCalledWith(
      "当前设备无法处理这张图片，请缩小图片后再试",
    );
  });

  it("读取来源图期间开始了生成：不再打开", async () => {
    initializeDraft(undefined, [input("src")]); // 无 upload：需要读库
    vi.mocked(db.images.get).mockImplementation((async () => {
      beginRun({ n: 1, size: "auto" });
      return image("src");
    }) as never);
    startInpaintFromInput("src");
    await flush();
    expect(state().drawing).toBeNull();
    expect(readImageMeta).not.toHaveBeenCalled();
  });

  it("来源图已不在库中：提示不可用", async () => {
    initializeDraft(undefined, [input("src")]);
    vi.mocked(db.images.get).mockResolvedValue(undefined);
    startInpaintFromInput("src");
    await flush();
    expect(state().drawing).toBeNull();
    expect(toast).toHaveBeenCalledWith("来源图片不可用，无法继续编辑");
  });
});

describe("confirmInpaint", () => {
  const exported = { blob: new Blob(["m"]), issue: null, selected: 1 };

  it("空选区：就地报错，画板与已涂内容保留", async () => {
    openInpaintSession();
    vi.mocked(exportMaskPng).mockResolvedValue({
      blob: null,
      issue: "empty-mask",
      selected: 0,
    });
    confirmInpaint();
    await flush();
    expect(state().drawing).toMatchObject({
      kind: "inpaint",
      confirming: false,
      error: "empty-mask",
    });
    expect(state().draft.inpaint).toBeNull();
  });

  it("导出失败：报 canvas-failed，画板保留", async () => {
    openInpaintSession();
    vi.mocked(exportMaskPng).mockResolvedValue({
      blob: null,
      issue: "canvas-failed",
      selected: 0,
    });
    confirmInpaint();
    await flush();
    expect(state().drawing).toMatchObject({ error: "canvas-failed" });
  });

  it("成功：选区落进草稿并关闭画板", async () => {
    openInpaintSession();
    vi.mocked(exportMaskPng).mockResolvedValue(exported);
    confirmInpaint();
    await flush();
    expect(state().drawing).toBeNull();
    expect(state().draft.inpaint?.mask.mask).toBeDefined();
    expect(state().draft.inputs[0].imageId).toBe("base");
    expect(toast).toHaveBeenCalledWith("选区已应用：填写修改描述后生成");
  });

  it("导出期间画板已被关闭：丢弃结果，草稿不变", async () => {
    const id = openInpaintSession();
    vi.mocked(exportMaskPng).mockResolvedValue(exported);
    confirmInpaint();
    closeDrawing(id);
    await flush();
    expect(state().draft.inpaint).toBeNull();
    expect(toast).not.toHaveBeenCalled();
  });

  it("确认中重复触发：只导出一次", async () => {
    openInpaintSession();
    vi.mocked(exportMaskPng).mockResolvedValue(exported);
    confirmInpaint();
    confirmInpaint();
    await flush();
    expect(exportMaskPng).toHaveBeenCalledTimes(1);
  });
});

describe("requestCloseInpaint", () => {
  it("没有修改：直接关闭", () => {
    openInpaintSession();
    requestCloseInpaint();
    expect(state().drawing).toBeNull();
  });

  it("有涂选：先确认", () => {
    openInpaintSession();
    strokeMask({
      type: "stroke",
      tool: "brush",
      size: 20,
      points: [{ x: 1, y: 1 }],
    } as never);
    requestCloseInpaint();
    expect(state().confirm?.title).toBe("放弃本次选区修改？");
    expect(state().drawing).not.toBeNull();
  });
});
