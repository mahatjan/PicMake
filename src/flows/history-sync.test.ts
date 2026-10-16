import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@heroui/react", () => ({ toast: vi.fn() }));

import { toast } from "@heroui/react";
import type { HistoryRow } from "../db/schema";
import { initialWorkspace, useWorkspace } from "../store/workspace";
import { selectRecord } from "../store/workspace/actions";
import { startHistorySync, type RowsObservable } from "./history-sync";

const row = (id: string) => ({ id }) as HistoryRow;
const state = () => useWorkspace.getState();

/** 由测试手动推送的订阅源 */
function fakeSource() {
  let observer: Parameters<RowsObservable["subscribe"]>[0] | null = null;
  const unsubscribe = vi.fn();
  return {
    observe: (): RowsObservable => ({
      subscribe(o) {
        observer = o;
        return { unsubscribe };
      },
    }),
    push: (rows: HistoryRow[]) => observer?.next(rows),
    fail: (error: unknown) => observer?.error(error),
    unsubscribe,
  };
}

beforeEach(() => {
  useWorkspace.setState(initialWorkspace(), true);
  vi.mocked(toast).mockClear();
});

describe("startHistorySync", () => {
  it("回推写入列表：首次保留新建页面，手动选中后删除仍回退", () => {
    const source = fakeSource();
    startHistorySync(source.observe);
    source.push([row("b"), row("a")]);
    expect(state().history.rows?.map((r) => r.id)).toEqual(["b", "a"]);
    expect(state().nav.selectedId).toBeNull();
    selectRecord("b");
    source.push([row("a")]);
    expect(state().nav.selectedId).toBe("a");
  });

  it("出错时提示，已加载的列表保持不变", () => {
    const source = fakeSource();
    startHistorySync(source.observe);
    source.push([row("a")]);
    source.fail(new Error("boom"));
    expect(state().history.rows?.map((r) => r.id)).toEqual(["a"]);
    expect(toast).toHaveBeenCalledWith(
      "历史记录读取失败：本地数据暂时无法读取，可刷新页面重试；在此期间新生成的结果可能无法保存。",
    );
  });

  it("返回的函数用于退订", () => {
    const source = fakeSource();
    const stop = startHistorySync(source.observe);
    stop();
    expect(source.unsubscribe).toHaveBeenCalledOnce();
  });
});
