/** 导出结果：下载图片、复制描述。图片 URL 由 hooks 提供，这里只触发保存 */
import { toast } from "@heroui/react";
import { t } from "../i18n";
import { downloadName } from "../lib/download";
import type { DisplayGen } from "../lib/view-models";

export function downloadFile(url: string, name: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
}

export function downloadImage(display: DisplayGen, index: number) {
  const image = display.images[index];
  if (!image) return;
  // 多尺寸记录的文件名带上图片的实际像素，拿到文件就知道是哪个尺寸
  downloadFile(
    image.url,
    downloadName(
      display.row.id,
      index,
      image.format,
      display.row.params.sizes
        ? { w: image.width, h: image.height }
        : undefined,
    ),
  );
}

export function downloadAll(display: DisplayGen) {
  display.images.forEach((_, index) => downloadImage(display, index));
}

export function copyPrompt(prompt: string) {
  void navigator.clipboard
    ?.writeText(prompt)
    .then(() => toast(t("toast.promptCopied")));
}
