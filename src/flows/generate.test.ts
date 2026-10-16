import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@heroui/react", () => ({ toast: vi.fn() }));
vi.mock("../api/client", () => ({ requestImages: vi.fn() }));
vi.mock("../db/history", () => ({ saveGeneration: vi.fn() }));
vi.mock("../store/settings", () => ({
  useSettings: { getState: () => ({ baseUrl: "http://mock", apiKey: "k" }) },
}));

import { toast } from "@heroui/react";
import { requestImages } from "../api/client";
import { saveGeneration } from "../db/history";
import type { HistoryRow } from "../db/schema";
import { t } from "../i18n";
import { errorMessage } from "../i18n/errors";
import type { PreparedGeneration } from "../lib/generation";
import { ApiError, type GenParams } from "../lib/types";
import { initialWorkspace, useWorkspace } from "../store/workspace";
import {
  beginRun,
  beginSave,
  closeConfirm,
  discardUnsaved,
  markUnsaved,
  patchForm,
  rowsLoaded,
} from "../store/workspace/actions";
import { selectRun, selectRunDone } from "../store/workspace/selectors";
import { cancelGenerate, generate, regenerate } from "./generate";

const state = () => useWorkspace.getState();
const plan = { n: 1, size: "auto" } as const;
const prepared = {
  row: { id: "u1" },
  images: [],
  sources: [],
} as unknown as PreparedGeneration;

beforeEach(() => {
  useWorkspace.setState(initialWorkspace(), true);
  vi.mocked(toast).mockClear();
  vi.mocked(saveGeneration).mockReset().mockResolvedValue(undefined);
  // 请求一直不返回：只关心有没有发起
  vi.mocked(requestImages)
    .mockReset()
    .mockReturnValue(new Promise(() => {}));
});

/** 把状态推到"保存失败，结果留在内存" */
function toUnsaved() {
  beginRun(plan);
  beginSave(prepared);
  markUnsaved();
}

describe("generate", () => {
  it("空闲：直接发起一次生成请求", () => {
    patchForm({ prompt: "猫" });
    generate();
    expect(requestImages).toHaveBeenCalledTimes(1);
    expect(vi.mocked(requestImages).mock.calls[0][0]).toMatchObject({
      prompt: "猫",
    });
    expect(selectRun(state()).phase).toBe("generating");
    expect(state().confirm).toBeNull();
    expect(state().draft.form.prompt).toBe("");
    expect(state().tasks[0].prompt).toBe("猫");
  });

  it("提交后描述已清空，连续触发不会重复提交同一条内容", () => {
    patchForm({ prompt: "猫" });
    generate();
    generate();
    expect(requestImages).toHaveBeenCalledTimes(1);
    expect(state().tasks).toHaveLength(1);
    expect(state().draft.form.prompt).toBe("");
  });

  it("参数校验失败时保留描述，不创建任务", () => {
    patchForm({ prompt: "保留的描述", cw: "1", ch: "1" });
    generate();
    expect(requestImages).not.toHaveBeenCalled();
    expect(state().tasks).toHaveLength(0);
    expect(state().draft.form.prompt).toBe("保留的描述");
  });

  it("starts immediately while another task is generating or saving", () => {
    patchForm({ prompt: "cat" });
    generate();
    const first = state().tasks[0].id;
    beginSave(prepared, first);
    patchForm({ prompt: "dog" });
    generate();
    expect(requestImages).toHaveBeenCalledTimes(2);
    expect(state().tasks).toHaveLength(2);
    expect(state().tasks.find((task) => task.id === first)?.run.phase).toBe(
      "saving",
    );
  });

  it("rejects invalid drafts during generation", () => {
    beginRun(plan);
    generate();
    expect(requestImages).not.toHaveBeenCalled();
    expect(state().tasks).toHaveLength(1);
  });

  it("有未保存结果：先弹确认，不发请求；取消后结果仍在", () => {
    patchForm({ prompt: "猫" });
    toUnsaved();
    generate();
    expect(state().confirm).toMatchObject({ title: "放弃未保存结果？" });
    expect(requestImages).not.toHaveBeenCalled();
    closeConfirm();
    expect(selectRun(state())).toEqual({ phase: "unsaved", prepared });
    expect(state().draft.form.prompt).toBe("猫");
    expect(requestImages).not.toHaveBeenCalled();
  });

  it("确认后：丢弃未保存结果，用点击时的草稿发起一次新的生成", () => {
    patchForm({ prompt: "猫" });
    toUnsaved();
    generate();
    // 确认框弹出后草稿又被改动：提交的仍是点击时的内容
    patchForm({ prompt: "狗" });
    const { onOk } = state().confirm!;
    closeConfirm();
    onOk();
    expect(requestImages).toHaveBeenCalledTimes(1);
    expect(vi.mocked(requestImages).mock.calls[0][0]).toMatchObject({
      prompt: "猫",
    });
    expect(selectRun(state()).phase).toBe("generating");
    expect(state().draft.form.prompt).toBe("狗");
  });

  it("确认放弃未保存结果后，清空本次提交的描述", () => {
    patchForm({ prompt: "猫" });
    toUnsaved();
    generate();
    state().confirm!.onOk();
    expect(requestImages).toHaveBeenCalledTimes(1);
    expect(state().draft.form.prompt).toBe("");
    expect(state().tasks[0].prompt).toBe("猫");
  });

  it("确认期间未保存结果已被处理：确认后不重复发起", () => {
    patchForm({ prompt: "猫" });
    toUnsaved();
    generate();
    const { onOk } = state().confirm!;
    closeConfirm();
    discardUnsaved();
    beginRun(plan);
    onOk();
    expect(requestImages).not.toHaveBeenCalled();
    expect(selectRun(state()).phase).toBe("generating");
  });

  it("草稿不合法：照常提示并聚焦描述框，不弹确认", () => {
    toUnsaved();
    generate();
    expect(state().confirm).toBeNull();
    expect(toast).toHaveBeenCalledTimes(1);
    expect(state().view.focusSeq).toBe(1);
    expect(requestImages).not.toHaveBeenCalled();
    expect(selectRun(state()).phase).toBe("unsaved");
  });
});

/** 最小的 PNG：只有文件头和 IHDR，足够读出宽高与格式 */
function pngB64(w: number, h: number): string {
  const u32 = (n: number) => [
    (n >>> 24) & 255,
    (n >>> 16) & 255,
    (n >>> 8) & 255,
    n & 255,
  ];
  const chunk = (type: string, data: number[]) => [
    ...u32(data.length),
    ...[...type].map((c) => c.charCodeAt(0)),
    ...data,
    0,
    0,
    0,
    0, // CRC：读头时不校验
  ];
  const bytes = [
    137,
    80,
    78,
    71,
    13,
    10,
    26,
    10,
    ...chunk("IHDR", [...u32(w), ...u32(h), 8, 2, 0, 0, 0]),
    ...chunk("IDAT", []),
    ...chunk("IEND", []),
  ];
  return btoa(String.fromCharCode(...bytes));
}

type Size = { w: number; h: number };
const sizeOf = (params: GenParams) => params.size as Size;
const ok = (params: GenParams) => ({
  images: [pngB64(sizeOf(params).w, sizeOf(params).h)],
  usage: { total_tokens: sizeOf(params).w },
});

// 默认基准 1K：1:1 → 1024², 16:9 → 1792×1008, 9:16 → 1008×1792
const SQUARE = { w: 1024, h: 1024 };
const WIDE = { w: 1792, h: 1008 };
const TALL = { w: 1008, h: 1792 };

/** 多比例开着，选了 1:1、16:9、9:16 */
function multiDraft() {
  patchForm({
    prompt: "猫",
    multi: true,
    ratio: "1:1",
    ratios: ["1:1", "16:9", "9:16"],
  });
}

/** 等到这次生成走完：保存成功后选中新记录 */
const finished = () =>
  vi.waitFor(() => expect(state().nav.lastDoneId).not.toBeNull());

/** 收到取消信号就以 AbortError 结束的请求（和真实 fetch 一致） */
const untilAborted = (signal?: AbortSignal) =>
  new Promise<never>((_, reject) => {
    signal?.addEventListener("abort", () =>
      reject(new DOMException("Aborted", "AbortError")),
    );
  });

describe("多尺寸生成", () => {
  it("同时发出：每个比例各一个请求，n = 1、各自的尺寸，生成中每个比例一个槽位", () => {
    multiDraft();
    generate();
    expect(requestImages).toHaveBeenCalledTimes(3);
    const sent = vi.mocked(requestImages).mock.calls.map(([p]) => p);
    expect(sent.map((p) => [p.n, p.size, p.sizes])).toEqual([
      [1, SQUARE, undefined],
      [1, WIDE, undefined],
      [1, TALL, undefined],
    ]);
    const run = selectRun(state());
    expect(run).toMatchObject({ phase: "generating" });
    if (run.phase === "generating")
      expect(run.slots?.map((slot) => slot.size)).toEqual([SQUARE, WIDE, TALL]);
  });

  it("每格各自的渐进预览，互不覆盖", () => {
    multiDraft();
    generate();
    const handlers = vi.mocked(requestImages).mock.calls.map((c) => c[2]);
    handlers[1]?.onPartial?.(pngB64(1, 1), 0);
    const run = selectRun(state());
    if (run.phase !== "generating" || !run.slots)
      throw new Error("not running");
    expect(run.slots.map((slot) => !!slot.partial)).toEqual([
      false,
      true,
      false,
    ]);
  });

  it("全部成功：合并为一条记录，图片按比例顺序、宽高取实际尺寸，usage 按请求分别保存", async () => {
    vi.mocked(requestImages).mockImplementation(async (p) => ok(p));
    multiDraft();
    generate();
    await finished();

    expect(requestImages).toHaveBeenCalledTimes(3); // 不重试
    expect(saveGeneration).toHaveBeenCalledTimes(1);
    const saved = vi.mocked(saveGeneration).mock.calls[0][0];
    expect(saved.images.map((i) => [i.width, i.height, i.format])).toEqual([
      [1024, 1024, "png"],
      [1792, 1008, "png"],
      [1008, 1792, "png"],
    ]);
    expect(saved.row.params).toMatchObject({ n: 1, size: SQUARE });
    expect(saved.row.params.sizes).toEqual([SQUARE, WIDE, TALL]);
    expect(saved.row.usage).toBeNull();
    expect(saved.row.usages).toEqual([
      { total_tokens: 1024 },
      { total_tokens: 1792 },
      { total_tokens: 1008 },
    ]);
    // 保存成功后留在首页画廊：不选中记录，画廊显示它
    expect(state().nav.selectedId).toBeNull();
    expect(state().nav.lastDoneId).toBe(saved.row.id);
    expect(selectRun(state()).phase).toBe("idle");
    expect(toast).toHaveBeenCalledWith("生成完成");
  });

  it("服务端返回的尺寸与请求不同：记录里保存实际尺寸", async () => {
    vi.mocked(requestImages).mockImplementation(async (p) => ({
      images: [pngB64(sizeOf(p).w - 16, sizeOf(p).h)],
      usage: null,
    }));
    multiDraft();
    generate();
    await finished();
    const saved = vi.mocked(saveGeneration).mock.calls[0][0];
    expect(saved.images.map((i) => i.width)).toEqual([1008, 1776, 992]);
    expect(saved.row.params.sizes).toEqual([SQUARE, WIDE, TALL]);
  });

  it("部分失败：成功的入库，失败的不入库，toast 列出失败的比例与原因，不自动重试", async () => {
    vi.mocked(requestImages).mockImplementation(async (p) => {
      if (sizeOf(p).w === WIDE.w) throw new ApiError("rate-limit", "", 429);
      return ok(p);
    });
    multiDraft();
    generate();
    await finished();

    expect(requestImages).toHaveBeenCalledTimes(3);
    const saved = vi.mocked(saveGeneration).mock.calls[0][0];
    expect(saved.images.map((i) => [i.width, i.height])).toEqual([
      [1024, 1024],
      [1008, 1792],
    ]);
    expect(saved.row.usages).toHaveLength(2);
    expect(saved.row.params.sizes).toHaveLength(3); // 提交的全部尺寸
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith(
      "已生成 2/3 个尺寸",
      expect.objectContaining({ description: "16:9：请求过于频繁" }),
    );
  });

  it("多个失败逐个列出，只成功一张也入库", async () => {
    vi.mocked(requestImages).mockImplementation(async (p) => {
      if (sizeOf(p).w === SQUARE.w) return ok(p);
      throw new ApiError(sizeOf(p).w === WIDE.w ? "rate-limit" : "server", "");
    });
    multiDraft();
    generate();
    await finished();
    expect(vi.mocked(saveGeneration).mock.calls[0][0].images).toHaveLength(1);
    expect(toast).toHaveBeenCalledWith(
      "已生成 1/3 个尺寸",
      expect.objectContaining({
        description: "16:9：请求过于频繁；9:16：服务端暂时不可用",
      }),
    );
  });

  it("全部失败：不入库，只弹一条第一个失败的错误提示，草稿保留", async () => {
    const first = new ApiError("auth", "", 401);
    vi.mocked(requestImages)
      .mockRejectedValueOnce(first)
      .mockRejectedValue(new ApiError("server", "", 500));
    multiDraft();
    generate();
    await vi.waitFor(() => expect(selectRun(state()).phase).toBe("idle"));

    expect(saveGeneration).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith(errorMessage(first, t));
    expect(state().draft.form).toMatchObject({ prompt: "", multi: true });
    expect(state().nav.lastDoneId).toBeNull();
  });

  it("取消：中止未完成的请求，已完成的照常保存", async () => {
    vi.mocked(requestImages).mockImplementation((p, _config, handlers) =>
      sizeOf(p).w === SQUARE.w
        ? untilAborted(handlers?.signal)
        : Promise.resolve(ok(p)),
    );
    multiDraft();
    generate();
    await vi.waitFor(() => expect(selectRunDone(state())).toBe(2));

    cancelGenerate();
    await finished();
    const saved = vi.mocked(saveGeneration).mock.calls[0][0];
    expect(saved.images.map((i) => [i.width, i.height])).toEqual([
      [1792, 1008],
      [1008, 1792],
    ]);
    expect(toast).toHaveBeenCalledWith("已取消，已完成的 2 张已保存");
    // 取消不算失败：不弹失败列表
    expect(toast).toHaveBeenCalledTimes(1);
  });

  it("取消时一张都没完成：同单尺寸取消，不保存，草稿保留", async () => {
    vi.mocked(requestImages).mockImplementation((_p, _config, handlers) =>
      untilAborted(handlers?.signal),
    );
    multiDraft();
    generate();
    cancelGenerate();
    await vi.waitFor(() => expect(selectRun(state()).phase).toBe("idle"));

    expect(saveGeneration).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith("已取消生成");
    expect(state().draft.form.prompt).toBe("");
  });

  it("保存失败：整条记录按未保存结果处理", async () => {
    vi.mocked(requestImages).mockImplementation(async (p) => ok(p));
    vi.mocked(saveGeneration).mockRejectedValue(new Error("quota"));
    multiDraft();
    generate();
    await vi.waitFor(() => expect(selectRun(state()).phase).toBe("unsaved"));
    const run = selectRun(state());
    if (run.phase === "unsaved") expect(run.prepared.images).toHaveLength(3);
    expect(state().nav.lastDoneId).toBeNull();
  });

  it("带参考图：每个请求都带上全部输入图", async () => {
    vi.mocked(requestImages).mockImplementation(async (p) => ok(p));
    const image = (id: string) => ({
      id,
      blob: new Blob(["x"]),
      width: 10,
      height: 10,
      format: "png",
    });
    useWorkspace.setState((s) => ({
      draft: {
        ...s.draft,
        inputs: [
          { imageId: "a", name: "a.png", upload: image("a") },
          { imageId: "b", name: "b.png", upload: image("b") },
        ],
      },
    }));
    multiDraft();
    generate();
    await finished();

    const calls = vi.mocked(requestImages).mock.calls;
    expect(calls).toHaveLength(3);
    for (const call of calls)
      expect(call[3]?.sources.map(({ source }) => source.imageId)).toEqual([
        "a",
        "b",
      ]);
    expect(
      vi.mocked(saveGeneration).mock.calls[0][0].row.inputSources,
    ).toHaveLength(2);
  });

  it("再来一版：按记录里的全部比例重新发出，原记录不变", async () => {
    vi.mocked(requestImages).mockImplementation(async (p) => ok(p));
    const row = {
      id: "old",
      prompt: "猫",
      params: {
        model: "flare",
        prompt: "猫",
        size: SQUARE,
        sizes: [SQUARE, WIDE, TALL],
        quality: "high",
        n: 1,
        background: "auto",
        outputFormat: "png",
      },
      imageIds: ["i0"], // 只成功了一张，也按提交的全部比例重发
    } as unknown as HistoryRow;
    rowsLoaded([row]);
    regenerate("old");
    await finished();
    expect(requestImages).toHaveBeenCalledTimes(3);
    expect(vi.mocked(saveGeneration).mock.calls[0][0].row.id).not.toBe("old");
    expect(row.imageIds).toEqual(["i0"]);
  });
});

describe("parallel generation", () => {
  function pendingRequests() {
    const pending: Array<{
      params: GenParams;
      signal?: AbortSignal;
      resolve: () => void;
      reject: (error: unknown) => void;
    }> = [];
    vi.mocked(requestImages).mockImplementation(
      (params, _config, handlers) =>
        new Promise((resolve, reject) => {
          handlers?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
          pending.push({
            params,
            signal: handlers?.signal,
            resolve: () => resolve(ok(params)),
            reject,
          });
        }),
    );
    return pending;
  }

  it("starts every submission immediately and saves out of order without losing the draft", async () => {
    const pending = pendingRequests();
    patchForm({ prompt: "first" });
    generate();
    const firstId = state().tasks[0].id;
    patchForm({ prompt: "second" });
    generate();
    patchForm({ prompt: "unfinished draft" });
    expect(pending.map((one) => one.params.prompt)).toEqual([
      "first",
      "second",
    ]);
    expect(pending[0].signal).not.toBe(pending[1].signal);
    pending[1].resolve();
    await vi.waitFor(() => expect(saveGeneration).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(state().tasks).toHaveLength(1));
    expect(state().tasks[0].id).toBe(firstId);
    expect(state().draft.form.prompt).toBe("unfinished draft");
    pending[0].resolve();
    await vi.waitFor(() => expect(state().tasks).toHaveLength(0));
    expect(
      vi.mocked(saveGeneration).mock.calls.map(([pack]) => pack.row.prompt),
    ).toEqual(["second", "first"]);
    expect(state().draft.form.prompt).toBe("unfinished draft");
  });

  it("isolates previews and ignores callbacks from a cancelled task", async () => {
    const pending = pendingRequests();
    patchForm({ prompt: "first" });
    generate();
    const firstId = state().tasks[0].id;
    patchForm({ prompt: "second" });
    generate();
    const handlers = vi.mocked(requestImages).mock.calls.map((call) => call[2]);
    handlers[0]?.onPartial?.(pngB64(1, 1), 0);
    expect(state().tasks[0].run).toMatchObject({ partial: null });
    expect(state().tasks[1].run).toMatchObject({ partial: { index: 0 } });
    cancelGenerate(firstId);
    await vi.waitFor(() => expect(state().tasks).toHaveLength(1));
    handlers[0]?.onPartial?.(pngB64(2, 2), 1);
    expect(state().tasks[0].run).toMatchObject({ partial: null });
    expect(pending[1].signal?.aborted).toBe(false);
    pending[1].resolve();
    await vi.waitFor(() => expect(state().tasks).toHaveLength(0));
    expect(saveGeneration).toHaveBeenCalledTimes(1);
  });

  it("a failed request does not end another task", async () => {
    const pending = pendingRequests();
    patchForm({ prompt: "first" });
    generate();
    patchForm({ prompt: "second" });
    generate();
    pending[0].reject(new ApiError("server", "", 500));
    await vi.waitFor(() => expect(state().tasks).toHaveLength(1));
    expect(state().tasks[0].prompt).toBe("second");
    pending[1].resolve();
    await vi.waitFor(() => expect(state().tasks).toHaveLength(0));
    expect(saveGeneration).toHaveBeenCalledTimes(1);
  });

  it("keeps every unsaved result while other tasks finish successfully", async () => {
    const pending = pendingRequests();
    vi.mocked(saveGeneration).mockImplementation(async (pack) => {
      if (pack.row.prompt !== "third") throw new Error("quota");
    });
    for (const prompt of ["first", "second", "third"]) {
      patchForm({ prompt });
      generate();
    }
    pending.forEach((one) => one.resolve());
    await vi.waitFor(() => expect(state().tasks).toHaveLength(2));
    expect(state().tasks.map((task) => task.run.phase)).toEqual([
      "unsaved",
      "unsaved",
    ]);
    const [second, first] = state().tasks;
    discardUnsaved(second.id);
    expect(state().tasks.map((task) => task.id)).toEqual([first.id]);
    expect(selectRun(state()).phase).toBe("unsaved");
  });

  it("cancels all active tasks together without saving unfinished results", async () => {
    const pending = pendingRequests();
    for (const prompt of ["first", "second", "third", "fourth", "fifth"]) {
      patchForm({ prompt });
      generate();
    }
    expect(pending).toHaveLength(5);
    cancelGenerate();
    await vi.waitFor(() => expect(state().tasks).toHaveLength(0));
    expect(pending.every((one) => one.signal?.aborted)).toBe(true);
    expect(saveGeneration).not.toHaveBeenCalled();
  });
});

describe("单尺寸生成（回归）", () => {
  it("一次请求，不带 sizes，保存一条记录", async () => {
    vi.mocked(requestImages).mockImplementation(async (p) => ok(p));
    patchForm({ prompt: "猫" });
    generate();
    await finished();
    expect(requestImages).toHaveBeenCalledTimes(1);
    expect(vi.mocked(requestImages).mock.calls[0][0].sizes).toBeUndefined();
    const saved = vi.mocked(saveGeneration).mock.calls[0][0];
    expect(saved.row.params.sizes).toBeUndefined();
    expect(saved.row.usages).toBeUndefined();
    expect(saved.row.usage).toEqual({ total_tokens: 1536 });
    expect(toast).toHaveBeenCalledWith("生成完成");
  });

  it("只选 1 个比例的多比例：与单尺寸完全一致", async () => {
    vi.mocked(requestImages).mockImplementation(async (p) => ok(p));
    patchForm({ prompt: "猫", multi: true, ratios: ["16:9"], ratio: "16:9" });
    generate();
    await finished();
    expect(requestImages).toHaveBeenCalledTimes(1);
    expect(vi.mocked(requestImages).mock.calls[0][0]).toMatchObject({
      n: 1,
      size: WIDE,
    });
    expect(vi.mocked(requestImages).mock.calls[0][0].sizes).toBeUndefined();
  });
});
