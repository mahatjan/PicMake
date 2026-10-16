/** 历史列表迁移函数 */
import type { HistoryRow } from "../../../db/schema";
import { nextSelection } from "../../../lib/workspace-rules";
import { set } from "./internal";

/** liveQuery 回推：更新列表，并在同一次 set 里处理删除回退；首次加载保持当前页面 */
export const rowsLoaded = (rows: HistoryRow[]) =>
  set((s) => ({
    history: { ...s.history, rows },
    nav: {
      ...s.nav,
      selectedId: nextSelection(
        s.history.rows ?? undefined,
        rows,
        s.nav.selectedId,
      ),
    },
  }));

/** 删除完成：刚保存的那条被删时丢弃过渡结果，列表没回推时也不再从内存显示它 */
export const recordDeleted = (id: string) =>
  set((s) =>
    s.history.recent?.row.id === id
      ? { history: { ...s.history, recent: null } }
      : s,
  );
