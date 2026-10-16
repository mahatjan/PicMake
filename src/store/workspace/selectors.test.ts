import { beforeEach, describe, expect, it } from "vitest";
import type { HistoryRow, ImageRow } from "../../db/schema";
import { blankSketch } from "../../lib/sketch";
import { initialWorkspace, useWorkspace } from "./index";
import {
  beginRead,
  beginRun,
  beginSave,
  closeConfirm,
  closeDrawer,
  closeViewMask,
  endRun,
  finishSave,
  markUnsaved,
  expandBar,
  initializeDraft,
  openDrawer,
  openSettings,
  openSketch,
  patchForm,
  rowsLoaded,
  selectRecord,
  setConfirm,
  setFocusIdx,
  setLastDoneId,
  setReturnId,
  showViewMask,
} from "./actions";
import {
  selectCanWheelSwitch,
  selectDisplayRow,
  selectDisplayRun,
  selectBusy,
  selectGallery,
  selectGalleryVisible,
  selectHomeScreen,
  selectShouldCollapseBar,
} from "./selectors";
import type { PreparedGeneration } from "../../lib/generation";

const state = () => useWorkspace.getState();

beforeEach(() => {
  useWorkspace.setState(initialWorkspace(), true);
});

describe("expandBar", () => {
  it("展开创作条、请求聚焦，并离开 complete 态", () => {
    setLastDoneId("a");
    setReturnId("r");
    expandBar();
    expect(state().view).toMatchObject({ barMode: "full", focusSeq: 1 });
    expect(state().nav).toEqual({
      selectedId: null,
      returnId: "r",
      lastDoneId: null,
    });
    expandBar();
    expect(state().view.focusSeq).toBe(2);
  });
});

describe("selectGallery", () => {
  const rowsOf = (...ids: string[]) => ids.map((id) => ({ id }) as HistoryRow);

  it("列表没加载完是 loading，加载后为空是 empty，有记录时返回列表本身", () => {
    expect(selectGallery(state())).toBe("loading");
    rowsLoaded([]);
    expect(selectGallery(state())).toBe("empty");
    const rows = rowsOf("a", "b");
    rowsLoaded(rows);
    expect(selectGallery(state())).toBe(rows);
  });

  it("选中记录时让位给详情页；生成、保存中不展示", () => {
    rowsLoaded(rowsOf("a", "b"));
    selectRecord("a");
    expect(selectGallery(state())).toBeNull();
    selectRecord(null);
    expect(selectGallery(state())).toBe(state().history.rows);

    beginRun({ n: 1, size: "auto" });
    // 生成中仍属于首页：画廊要在网格里显示生成卡
    expect(selectGallery(state())).toBe(state().history.rows);
    endRun();
    expect(selectGallery(state())).toBe(state().history.rows);
    useWorkspace.setState(initialWorkspace(), true);

    // 选中的记录已不在列表里：解析不到就回落到画廊
    rowsLoaded(rowsOf("a", "b"));
    selectRecord("ghost");
    expect(selectGallery(state())).toBe(state().history.rows);
  });

  it("写描述、调参数都留在画廊；草稿有输入图、上传读取中才让位", () => {
    rowsLoaded(rowsOf("a", "b"));
    patchForm({ prompt: "猫" });
    expect(selectGallery(state())).toBe(state().history.rows);
    patchForm({ ratio: "16:9" });
    expect(selectGallery(state())).toBe(state().history.rows);
    useWorkspace.setState(initialWorkspace(), true);

    rowsLoaded(rowsOf("a", "b"));
    initializeDraft(undefined, [{ imageId: "x" }]);
    expect(selectGallery(state())).toBeNull();
    useWorkspace.setState(initialWorkspace(), true);

    rowsLoaded(rowsOf("a", "b"));
    beginRead("r1");
    expect(selectGallery(state())).toBeNull();
  });
});

describe("查看记录与后台任务隔离", () => {
  it.each(["generating", "saving", "unsaved"] as const)(
    "后台 %s 不覆盖已选记录，查看状态仍为空闲",
    (phase) => {
      const row = { id: "history", imageIds: ["history-1"] } as HistoryRow;
      const result = {
        row: { id: "background", imageIds: ["background-1"] },
        images: [],
        sources: [],
      } as unknown as PreparedGeneration;
      rowsLoaded([row]);
      beginRun({ n: 1, size: "auto" });
      selectRecord(row.id);
      if (phase !== "generating") beginSave(result);
      if (phase === "unsaved") markUnsaved();
      expect(selectDisplayRow(state())).toBe(row);
      expect(selectDisplayRun(state()).phase).toBe("idle");
      expect(selectBusy(state())).toBe(phase !== "unsaved");
      expect(selectGallery(state())).toBeNull();
      expect(selectCanWheelSwitch(state())).toBe(true);
      if (phase === "saving") {
        finishSave(result);
        expect(selectDisplayRow(state())).toBe(row);
      }
    },
  );

  it("只剩后台保存任务时首页仍显示任务卡", () => {
    rowsLoaded([]);
    beginRun({ n: 1, size: "auto" });
    beginSave({
      row: { id: "saving" } as HistoryRow,
      images: [],
      sources: [],
    } as PreparedGeneration);
    expect(selectGallery(state())).toBe("empty");
    expect(selectGalleryVisible(state())).toBe(true);
  });
});

describe("selectGalleryVisible / selectHomeScreen", () => {
  it("列表没加载完时只有首页（空状态引导占位）；有记录后画廊可见", () => {
    expect(selectGalleryVisible(state())).toBe(false);
    expect(selectHomeScreen(state())).toBe(true);
    // 已加载但一条都没有、也没在生成：仍是空状态引导，首页不能什么都没有
    rowsLoaded([]);
    expect(selectGalleryVisible(state())).toBe(false);
    expect(selectHomeScreen(state())).toBe(true);
    rowsLoaded([{ id: "a" } as HistoryRow]);
    expect(selectGalleryVisible(state())).toBe(true);
    expect(selectHomeScreen(state())).toBe(true);
  });

  it("还没有任何记录但正在生成时，画廊也要占舞台（网格里显示生成卡）", () => {
    rowsLoaded([]);
    beginRun({ n: 1, size: "auto" });
    expect(selectGalleryVisible(state())).toBe(true);
    endRun();
    expect(selectGalleryVisible(state())).toBe(false);
  });

  it("选中记录时既不是画廊也不是首页；写描述仍在首页，有输入图才离开", () => {
    rowsLoaded([{ id: "a" } as HistoryRow]);
    selectRecord("a");
    expect(selectGalleryVisible(state())).toBe(false);
    expect(selectHomeScreen(state())).toBe(false);
    selectRecord(null);
    // 创作条里输入内容不换页：画廊继续占着舞台
    patchForm({ prompt: "猫" });
    expect(selectGalleryVisible(state())).toBe(true);
    expect(selectHomeScreen(state())).toBe(true);
    initializeDraft(undefined, [{ imageId: "x" }]);
    expect(selectGalleryVisible(state())).toBe(false);
    expect(selectHomeScreen(state())).toBe(false);
  });

  it("刚保存完（没有选中、recent 有值）仍在首页，画廊展示新记录", () => {
    rowsLoaded([{ id: "old" } as HistoryRow]);
    selectRecord(null);
    expect(selectGalleryVisible(state())).toBe(true);
    expect(selectHomeScreen(state())).toBe(true);
  });
});

describe("selectCanWheelSwitch", () => {
  it("空闲、草稿未改动、没有弹层时响应；在首页不响应", () => {
    // 列表还没加载：首页，但也没有可切换的记录
    expect(selectCanWheelSwitch(state())).toBe(false);
    rowsLoaded([]);
    expect(selectCanWheelSwitch(state())).toBe(false);
    rowsLoaded([{ id: "r" } as HistoryRow]);
    expect(selectCanWheelSwitch(state())).toBe(false);
    selectRecord("r");
    expect(selectCanWheelSwitch(state())).toBe(true);
    selectRecord(null);
    expect(selectCanWheelSwitch(state())).toBe(false);
  });

  it("草稿改过、有输入图、上传读取中都不响应", () => {
    rowsLoaded([{ id: "r" } as HistoryRow]);
    patchForm({ prompt: "猫" });
    expect(selectCanWheelSwitch(state())).toBe(false);
    initializeDraft(undefined, [{ imageId: "x" }]);
    expect(selectCanWheelSwitch(state())).toBe(false);
    // 空草稿且在看结果：可以滚轮切换
    initializeDraft();
    selectRecord("r");
    expect(selectCanWheelSwitch(state())).toBe(true);
    useWorkspace.setState((s) => ({ draft: { ...s.draft, readId: "r1" } }));
    expect(selectCanWheelSwitch(state())).toBe(false);
  });

  it("生成中、确认框、画板、各弹层、轮播打开时都不响应", () => {
    beginRun({ n: 1, size: "auto" });
    expect(selectCanWheelSwitch(state())).toBe(false);
    useWorkspace.setState(initialWorkspace(), true);

    setConfirm({ title: "t", desc: "d", onOk: () => {} });
    expect(selectCanWheelSwitch(state())).toBe(false);
    closeConfirm();

    openSketch(blankSketch(10, 10), { kind: "new" }, null);
    expect(selectCanWheelSwitch(state())).toBe(false);
    useWorkspace.setState(initialWorkspace(), true);

    for (const open of [openDrawer, openSettings, () => setFocusIdx(0)]) {
      open();
      expect(selectCanWheelSwitch(state())).toBe(false);
      useWorkspace.setState(initialWorkspace(), true);
    }

    const base = { id: "b", blob: new Blob(), width: 1, height: 1 } as ImageRow;
    showViewMask({ base, commands: [], rowId: "r" });
    expect(selectCanWheelSwitch(state())).toBe(false);
    closeViewMask();
    // 仍在首页（没有选中记录）：滚轮不切换记录
    expect(selectCanWheelSwitch(state())).toBe(false);

    // 结果页里关掉弹层后恢复响应
    rowsLoaded([{ id: "r" } as HistoryRow]);
    selectRecord("r");
    openDrawer();
    expect(selectCanWheelSwitch(state())).toBe(false);
    closeDrawer();
    expect(selectCanWheelSwitch(state())).toBe(true);

    // 列表已加载但为空：仍在首页，滚轮不切换记录
    useWorkspace.setState(initialWorkspace(), true);
    rowsLoaded([]);
    expect(selectCanWheelSwitch(state())).toBe(false);
  });
});

describe("selectShouldCollapseBar", () => {
  it("草稿未改动、没有输入图、也没有可返回的结果时收起", () => {
    expect(selectShouldCollapseBar(state())).toBe(true);
  });

  it("草稿改过、读取中、有输入图、有可返回的结果时都不收起", () => {
    patchForm({ prompt: "猫" });
    expect(selectShouldCollapseBar(state())).toBe(false);
    initializeDraft(undefined, [{ imageId: "x" }]);
    expect(selectShouldCollapseBar(state())).toBe(false);
    initializeDraft();
    useWorkspace.setState((s) => ({ draft: { ...s.draft, readId: "r1" } }));
    expect(selectShouldCollapseBar(state())).toBe(false);
    initializeDraft();
    expect(selectShouldCollapseBar(state())).toBe(true);
    rowsLoaded([{ id: "r" } as HistoryRow]);
    setReturnId("r");
    expect(selectShouldCollapseBar(state())).toBe(false);
  });
});
