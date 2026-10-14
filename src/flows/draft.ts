/** 草稿流程：上传读取、移除图片与选区（提示在这里发） */
import { toast } from "@heroui/react";
import { t } from "../i18n";
import { readInputImage } from "../lib/input-images";
import { ApiError, type InputImage, type UploadIssue } from "../lib/types";
import { uuid } from "../lib/uuid";
import { useWorkspace } from "../store/workspace";
import {
  beginRead,
  finishRead,
  removeDraftInput,
  removeDraftMask,
} from "../store/workspace/actions";

const currentReadId = () => useWorkspace.getState().draft.readId;

/** 上传：逐个读取（只在内存，不写库）；上一批没读完时忽略，批次被打断就丢弃结果 */
export async function addFiles(files: File[]) {
  if (!files.length || currentReadId() !== null) return;
  const readId = uuid();
  beginRead(readId);
  const added: InputImage[] = [];
  const issues: UploadIssue[] = [];
  for (const file of files) {
    if (currentReadId() !== readId) return;
    try {
      const image = await readInputImage(file);
      added.push({ imageId: image.id, name: file.name, upload: image });
    } catch (error) {
      issues.push({
        kind: "file",
        file: file.name,
        error: error instanceof ApiError ? error.kind : "invalid-image",
      });
    }
  }
  finishRead(readId, added, issues);
}

export function removeInput(id: string) {
  toast(
    removeDraftInput(id) === "base-and-mask"
      ? t("toast.inputRemovedBaseAndMask")
      : t("toast.inputRemoved"),
  );
}

export function removeMask() {
  removeDraftMask();
  toast(t("toast.maskRemoved"));
}
