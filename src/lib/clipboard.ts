/** 剪贴板：取出图片文件、判断粘贴目标是否可编辑。纯函数，不碰 store 与界面 */

/** 剪贴板的最小结构：DataTransfer 满足它，测试也能直接造假对象 */
export interface ClipboardSource {
  types: ReadonlyArray<string>;
  files: ArrayLike<File>;
  items?: ArrayLike<{
    kind: string;
    type: string;
    getAsFile(): File | null;
  }>;
  getData(format: string): string;
}

/** 剪贴板里的图片文件：只认 image/*；items 拿不到时退回 files */
export function clipboardImageFiles(data: ClipboardSource | null): File[] {
  if (!data) return [];
  const items = data.items ? Array.from(data.items) : [];
  const fromItems: File[] = [];
  for (const item of items) {
    if (item.kind !== "file" || !item.type.startsWith("image/")) continue;
    const file = item.getAsFile();
    if (file) fromItems.push(file);
  }
  if (fromItems.length) return fromItems;
  const files = data.files ? Array.from(data.files) : [];
  return files.filter((file) => file.type.startsWith("image/"));
}

/** 剪贴板里有没有文本：输入框里粘贴时用它判断该不该让文字优先 */
export function clipboardHasText(data: ClipboardSource | null): boolean {
  if (!data) return false;
  if (!data.types.includes("text/plain")) return false;
  return data.getData("text/plain").trim().length > 0;
}

/** 粘贴目标是不是可编辑控件：textarea / input / contenteditable */
export function isEditableTarget(target: unknown): boolean {
  if (!target || typeof target !== "object") return false;
  const el = target as Partial<HTMLElement>;
  const tag = (el.tagName ?? "").toLowerCase();
  if (tag === "textarea" || tag === "input") return true;
  return el.isContentEditable === true;
}
