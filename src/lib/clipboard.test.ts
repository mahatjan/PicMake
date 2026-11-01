import { describe, expect, it } from "vitest";
import {
  clipboardHasText,
  clipboardImageFiles,
  isEditableTarget,
  type ClipboardSource,
} from "./clipboard";

const png = new File([new Uint8Array([137, 80, 78, 71])], "shot.png", {
  type: "image/png",
});

/** 造一个剪贴板：items 是浏览器给出的条目，files 是文件列表 */
const clipboard = (opts: {
  files?: File[];
  items?: { kind: string; type: string; file: File | null }[];
  text?: string;
}): ClipboardSource => ({
  types: [
    ...(opts.text === undefined ? [] : ["text/plain"]),
    ...(opts.items ?? []).map((item) => item.type),
  ],
  files: opts.files ?? [],
  items: (opts.items ?? []).map((item) => ({
    kind: item.kind,
    type: item.type,
    getAsFile: () => item.file,
  })),
  getData: (format: string) =>
    format === "text/plain" ? (opts.text ?? "") : "",
});

describe("剪贴板图片", () => {
  it("从 items 里取出图片文件", () => {
    const data = clipboard({
      items: [
        { kind: "string", type: "text/plain", file: null },
        { kind: "file", type: "image/png", file: png },
      ],
    });
    expect(clipboardImageFiles(data)).toEqual([png]);
  });

  it("items 里没有图片时退回 files，只认 image/*", () => {
    const text = new File(["hi"], "a.txt", { type: "text/plain" });
    expect(
      clipboardImageFiles(clipboard({ files: [text, png] })).map((f) => f.name),
    ).toEqual(["shot.png"]);
    expect(clipboardImageFiles(clipboard({ files: [text] }))).toEqual([]);
    expect(clipboardImageFiles(null)).toEqual([]);
  });

  it("剪贴板带文字时不劫持输入框里的文本粘贴", () => {
    expect(clipboardHasText(clipboard({ text: "hello" }))).toBe(true);
    expect(clipboardHasText(clipboard({ text: "  " }))).toBe(false);
    expect(clipboardHasText(clipboard({}))).toBe(false);
  });

  it("只有输入框与可编辑区域算可编辑目标", () => {
    expect(isEditableTarget({ tagName: "TEXTAREA" })).toBe(true);
    expect(isEditableTarget({ tagName: "INPUT" })).toBe(true);
    expect(isEditableTarget({ tagName: "DIV", isContentEditable: true })).toBe(
      true,
    );
    expect(isEditableTarget({ tagName: "DIV" })).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});
