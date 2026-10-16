/** 选中与导航迁移函数；resetWorkspace 跨 nav/draft/view 一次 set */
import { set, setNav, freshDraft } from "./internal";

export const selectRecord = (id: string | null) => setNav({ selectedId: id });
export const setReturnId = (id: string | null) => setNav({ returnId: id });
export const setLastDoneId = (id: string | null) => setNav({ lastDoneId: id });
export const clearDone = () => setNav({ lastDoneId: null });

/** 切回图片查看：关闭视频页，保留草稿和后台任务，清掉上一条记录的查看状态。 */
export const viewRecord = (id: string | null) =>
  set((s) => ({
    nav: { ...s.nav, selectedId: id },
    view: {
      ...s.view,
      focusIdx: null,
      lightboxId: null,
      previewId: null,
      playgroundOpen: false,
    },
    video: {
      ...s.video,
      previewId: null,
      draft: { ...s.video.draft, entry: null },
    },
  }));

/** 离开类入口共用的复位：完成标记、返回目标、草稿（保留参数）、查看状态；传 selectId 时同时切换选中。不改生成阶段：未保存结果由 requestLeave 确认后丢弃 */
export const resetWorkspace = (selectId?: string | null) =>
  set((s) => ({
    nav: {
      selectedId: selectId === undefined ? s.nav.selectedId : selectId,
      returnId: null,
      lastDoneId: null,
    },
    draft: freshDraft(s.draft),
    view: {
      ...s.view,
      focusIdx: null,
      lightboxId: null,
      previewId: null,
      playgroundOpen: false,
    },
    video: {
      ...s.video,
      previewId: null,
      draft: { ...s.video.draft, entry: null },
    },
  }));
