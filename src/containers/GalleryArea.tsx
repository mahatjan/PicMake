/** 首页画廊：把 store 里的历史列表、刚保存的结果与生成进度投影成展示组件；点一项只切换查看记录，保留草稿与后台任务。
 *  页面上什么都没有时整体不渲染，舞台继续显示空状态引导。
 *  创作条里传了输入图、失败的任务卡都留在画廊里，不换成舞台上的空状态引导。
 *  副作用：各任务的渐进预览 Blob → Object URL（useBlobUrls，卸载或换图即回收） */
import { useMemo } from "react";
import { Gallery, type GalleryTask } from "../components/Gallery";
import { cancelGenerate, retryTask } from "../flows/generate";
import { selectHistory } from "../flows/navigation";
import { useBlobUrls } from "../hooks/useBlobUrls";
import type { WorkspaceAssets } from "../hooks/useWorkspaceAssets";
import { useWorkspace } from "../store/workspace";
import { dismissFailed } from "../store/workspace/actions";
import {
  selectGallery,
  selectGalleryHasContent,
} from "../store/workspace/selectors";

export function GalleryArea({ assets }: { assets: WorkspaceAssets }) {
  const gallery = useWorkspace(selectGallery);
  const recent = useWorkspace((s) => s.history.recent);
  const tasks = useWorkspace((s) => s.tasks);
  const blobs = useMemo(
    () =>
      tasks.map((task) =>
        task.run.phase === "generating"
          ? (task.run.partial?.blob ?? null)
          : null,
      ),
    [tasks],
  );
  const partialUrls = useBlobUrls(blobs);
  // 创作条里传了输入图也算有内容：画廊继续留着，不换成舞台上的空状态引导
  const hasContent = useWorkspace(selectGalleryHasContent);
  const cards = useMemo<GalleryTask[]>(
    () =>
      tasks.flatMap((task, index) =>
        task.run.phase === "unsaved"
          ? []
          : [
              {
                id: task.id,
                prompt: task.prompt,
                saving: task.run.phase === "saving",
                slots:
                  task.run.phase === "generating" || task.run.phase === "failed"
                    ? task.run.slots
                    : null,
                partialUrl: partialUrls[index] ?? null,
                failure: task.run.phase === "failed" ? task.run.failure : null,
              },
            ],
      ),
    [tasks, partialUrls],
  );

  /** 刚保存的记录：列表回推前先在网格最前显示（回推后由列表接管，按 id 去重不重复） */
  const rows = useMemo(() => {
    if (!Array.isArray(gallery)) return null;
    if (!recent) return gallery;
    return [recent.row, ...gallery.filter((row) => row.id !== recent.row.id)];
  }, [gallery, recent]);

  /** 首图优先取内存里刚保存的结果，其次列表里的缩略图 */
  const urlOf = (imageId: string) =>
    recent?.images.some((image) => image.id === imageId)
      ? assets.recentUrls[imageId]
      : assets.thumbnailUrls[imageId];

  // 画廊不该占着舞台时不渲染：它是整屏浮层，渲染出来会盖住结果页，工具条就点不到了
  if (gallery === null) return null;
  // 什么都没有时舞台继续显示空状态引导
  if (!rows && !hasContent) return null;

  return (
    <Gallery
      rows={rows ?? []}
      urlOf={urlOf}
      tasks={cards}
      onCancel={cancelGenerate}
      onRetry={retryTask}
      onDismiss={dismissFailed}
      onOpen={selectHistory}
    />
  );
}
