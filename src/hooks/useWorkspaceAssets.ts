/** 舞台、详情卡、首页画廊与抽屉用的图片资源：display、刚保存的结果、来源图、缩略图。
 *  缩略图只在列表变化时重读；当前记录的图先借用已加载的缩略图；
 *  内存里的结果（保存中、保存失败、刚保存还没进列表）始终用同一组 URL，保存前后不闪空。 */
import { useLayoutEffect, useMemo, useState } from "react";
import type { HistoryRow, ImageRow } from "../db/schema";
import type { PreparedGeneration } from "../lib/generation";
import {
  inputNaming,
  workIndexOf,
  type DisplayGen,
  type DisplayImage,
  type DisplayInput,
} from "../lib/view-models";
import { useWorkspace } from "../store/workspace";
import { selectDisplayRow, selectRows } from "../store/workspace/selectors";
import { useImageAssets } from "./useImageAssets";

const EMPTY_IMAGES: ImageRow[] = [];

export type WorkspaceAssets = ReturnType<typeof useWorkspaceAssets>;

/** 一行记录 + 每张图的 URL / 元信息 → 展示数据；任一张的 URL 或元信息缺失就整体为 null */
function toDisplayGen(
  row: HistoryRow | null,
  images: Array<{
    id: string;
    url?: string;
    format?: string;
    width?: number;
    height?: number;
  }>,
): DisplayGen | null {
  const complete =
    row &&
    images.length > 0 &&
    images.every(
      (image): image is DisplayImage =>
        !!image.url &&
        !!image.format &&
        image.width !== undefined &&
        image.height !== undefined,
    );
  return complete ? { row, images } : null;
}

export function useWorkspaceAssets() {
  const rows = useWorkspace(selectRows);
  const displayRow = useWorkspace(selectDisplayRow);
  const recent = useWorkspace((s) => s.history.recent);
  const tasks = useWorkspace((s) => s.tasks);
  const lastDoneId = useWorkspace((s) => s.nav.lastDoneId);
  /** 保存中、保存失败、刚保存还没回推：这些结果始终用同一组 URL，保存前后不闪空。
   *  保存成功后留在画廊（selectedId 为空），所以这里不再要求 recent 正是"展示中的记录" */
  const memory = useMemo(
    () => [
      ...tasks.flatMap(({ run }) =>
        run.phase === "saving" || run.phase === "unsaved" ? [run.prepared] : [],
      ),
      ...(recent ? [recent] : []),
    ],
    [tasks, recent],
  );
  const shownTask = tasks.find(
    ({ run }) =>
      (run.phase === "saving" || run.phase === "unsaved") &&
      run.prepared.row.id === displayRow?.id,
  );
  const shown: PreparedGeneration | null =
    shownTask && shownTask.run.phase !== "generating"
      ? shownTask.run.prepared
      : null;
  const memoryImages = useMemo(
    () => memory.flatMap((pack) => pack.images),
    [memory],
  );

  const [shownUrls, setShownUrls] = useState<Record<string, string>>({});
  // 只在图片构成变化时重建：画廊里生成卡每帧重绘，不能因此重建 URL
  const shownKey = memoryImages.map((image) => image.id).join("|");
  useLayoutEffect(() => {
    const next: Record<string, string> = {};
    for (const image of memoryImages)
      next[image.id] = URL.createObjectURL(image.blob);
    // oxlint-disable-next-line react/set-state-in-effect -- 同步外部资源（Object URL），不是派生值
    setShownUrls(next);
    return () => Object.values(next).forEach((url) => URL.revokeObjectURL(url));
    // 依赖 shownKey：shown 的内容变了 key 才会变
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownKey]);

  const { assets: thumbs } = useImageAssets(rows.map((row) => row.imageIds[0]));
  const sources = displayRow?.inputSources ?? [];
  const { assets: current } = useImageAssets(
    [
      ...(displayRow?.imageIds ?? []),
      ...sources.map((source) => source.imageId),
    ],
    shown?.sources.length ? shown.sources : EMPTY_IMAGES,
  );
  const assetOf = (id: string) => current[id] ?? thumbs[id];

  const thumbnailUrls = Object.fromEntries(
    rows.flatMap((row) => {
      const id = row.imageIds[0];
      return id && thumbs[id] ? ([[id, thumbs[id].url]] as const) : [];
    }),
  );

  const sourceImages: DisplayInput[] = sources.map((source, index) => {
    /** 来源是草图：预览提供「继续画这张草图」 */
    const isSketch = !!assetOf(source.imageId)?.row.sketch;
    return {
      id: source.imageId,
      index,
      // 重绘记录的 inputSources[0] 恒为底图
      naming: inputNaming(source, {
        sketch: isSketch,
        base: !!displayRow?.inpaint && index === 0,
        workIndex: workIndexOf(rows, source.generationId, source.imageId),
      }),
      url: assetOf(source.imageId)?.url,
      isSketch,
    };
  });

  /** 优先使用当前记录已加载的资源；未入库的结果回退到内存，后台完成不会替换查看中的 URL。 */
  const displayOf = (row: HistoryRow | null): DisplayGen | null => {
    const pack = row
      ? memory.find((item) => item.row.id === row.id)
      : undefined;
    const inMemory = !!pack;
    const images = (row?.imageIds ?? []).map((id) => {
      const asset = assetOf(id);
      const source =
        asset?.row ?? pack?.images.find((image) => image.id === id);
      return {
        id,
        url: asset?.url ?? (inMemory ? shownUrls[id] : undefined),
        format: source?.format,
        width: source?.width,
        height: source?.height,
      };
    });
    return toDisplayGen(row, images);
  };

  const display = displayOf(displayRow);
  /** 刚保存的那条：留在画廊时没有选中记录，complete 态与「再来一版 / 微调描述 / 设为参考图」仍要用它 */
  const lastDoneDisplay = useMemo(() => {
    if (!lastDoneId) return null;
    const row =
      recent?.row.id === lastDoneId
        ? recent.row
        : (rows.find((item) => item.id === lastDoneId) ?? null);
    return displayOf(row);
    // displayOf 依赖内存结果与已加载资源
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastDoneId, shownUrls, rows, current, recent]);

  return {
    rows,
    display,
    lastDoneDisplay,
    sourceImages,
    thumbnailUrls,
    /** 内存里结果（保存中 / 刚保存）每张图的 URL；与 recentUrls 同一批，不会重复创建 */
    recentUrls: shownUrls,
  };
}
