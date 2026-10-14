/** 容器尺寸 / EXIF 方向读取与底图准备：只覆盖 JPEG/PNG/WebP 的 orientation 1–8。
 *  损坏元数据返回明确错误，不让流程静默继续 */
import { imageFormat } from "./input-images";
import type { InpaintIssue } from "./types";
import { uuid } from "./uuid";

export type OrientationResult =
  /** 无方向标签（按 1 处理）或 orientation = 1 */
  | { orientation: 1; width: number; height: number }
  | { orientation: 2 | 3 | 4 | 5 | 6 | 7 | 8; width: number; height: number }
  | { issue: InpaintIssue };

/* ── TIFF IFD：只接受 tag 0x0112 的合法类型 / 数量和值 1–8 ── */

function readTiffOrientation(
  view: DataView,
  tiffStart: number,
): number | null | "corrupt" {
  if (tiffStart + 8 > view.byteLength) return "corrupt";
  const endian = view.getUint16(tiffStart);
  const little = endian === 0x4949 ? true : endian === 0x4d4d ? false : null;
  if (little === null) return "corrupt";
  const get16 = (off: number) => view.getUint16(off, little);
  const get32 = (off: number) => view.getUint32(off, little);
  const ifdOffset = get32(tiffStart + 4);
  const ifd = tiffStart + ifdOffset;
  if (ifdOffset < 8 || ifd + 2 > view.byteLength) return "corrupt";
  const count = get16(ifd);
  if (count === 0 || count > 512) return "corrupt";
  if (ifd + 2 + count * 12 > view.byteLength) return "corrupt";
  let found: number | null = null;
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (get16(entry) === 0x0112) {
      const type = get16(entry + 2);
      const num = get32(entry + 4);
      if (type !== 3 || num !== 1) return "corrupt"; // 须为 SHORT ×1
      const value = view.getUint16(entry + 8, little);
      if (value < 1 || value > 8) return "corrupt";
      if (found !== null && found !== value) return "corrupt"; // 冲突标签
      found = value;
    }
  }
  return found;
}

/* ── JPEG ── */

function parseJpeg(view: DataView): OrientationResult {
  let off = 2;
  let width = 0;
  let height = 0;
  let orientation: number | null = null;
  let orientationCorrupt = false;
  let sawSof = false;
  while (off + 4 <= view.byteLength) {
    if (view.getUint8(off) !== 0xff) break;
    const marker = view.getUint8(off + 1);
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) {
      off += 2;
      continue;
    }
    if (marker === 0xda) break; // SOS：进入熵编码数据，头解析结束
    const len = view.getUint16(off + 2);
    if (len < 2 || off + 2 + len > view.byteLength)
      return { issue: "canvas-failed" };
    // SOF0/1/2/3/5/6/7/9/10/11/13/14：帧头含尺寸
    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc
    ) {
      if (len < 7) return { issue: "canvas-failed" };
      height = view.getUint16(off + 5);
      width = view.getUint16(off + 7);
      sawSof = true;
    }
    // APP1 Exif
    if (marker === 0xe1 && len >= 8) {
      const head = off + 4;
      if (
        String.fromCharCode(
          view.getUint8(head),
          view.getUint8(head + 1),
          view.getUint8(head + 2),
          view.getUint8(head + 3),
          view.getUint8(head + 4),
          view.getUint8(head + 5),
        ) === "Exif\0\x00"
      ) {
        const result = readTiffOrientation(view, head + 6);
        if (result === "corrupt") orientationCorrupt = true;
        else if (result !== null) orientation = result;
      }
    }
    off += 2 + len;
  }
  if (!sawSof || !width || !height) return { issue: "canvas-failed" };
  if (orientationCorrupt) return { issue: "unsupported-orientation" };
  if (orientation === null || orientation === 1)
    return { orientation: 1, width, height };
  return {
    orientation: orientation as 2 | 3 | 4 | 5 | 6 | 7 | 8,
    width,
    height,
  };
}

/* ── PNG ── */

function parsePng(view: DataView): OrientationResult {
  if (view.byteLength < 33) return { issue: "canvas-failed" };
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (!width || !height) return { issue: "canvas-failed" };
  let off = 8;
  let orientation: number | null = null;
  let corrupt = false;
  while (off + 12 <= view.byteLength) {
    const len = view.getUint32(off);
    const type = String.fromCharCode(
      view.getUint8(off + 4),
      view.getUint8(off + 5),
      view.getUint8(off + 6),
      view.getUint8(off + 7),
    );
    if (off + 8 + len + 4 > view.byteLength) break;
    if (type === "eXIf" && len >= 8) {
      const head = off + 8;
      // 规范以 "Exif\0\0" 开头，个别写入方直接给 TIFF 头；两种都接受
      const hasPrefix =
        view.getUint32(head) === 0x45786966 && view.getUint16(head + 4) === 0;
      const result = readTiffOrientation(view, head + (hasPrefix ? 6 : 0));
      if (result === "corrupt") corrupt = true;
      else if (result !== null) orientation = result;
    }
    if (type === "IDAT") break;
    off += 12 + len;
  }
  if (corrupt) return { issue: "unsupported-orientation" };
  if (orientation === null || orientation === 1)
    return { orientation: 1, width, height };
  return {
    orientation: orientation as 2 | 3 | 4 | 5 | 6 | 7 | 8,
    width,
    height,
  };
}

/* ── WebP（RIFF：VP8 / VP8L / VP8X 尺寸 + EXIF 块，块长按 RIFF 需偶数对齐）── */

function parseWebp(view: DataView): OrientationResult {
  if (view.byteLength < 12 + 8) return { issue: "canvas-failed" };
  let width = 0;
  let height = 0;
  let orientation: number | null = null;
  let corrupt = false;
  let off = 12;
  // RIFF 字段一律小端
  const riffEnd = Math.min(view.byteLength, 8 + view.getUint32(4, true) + 8);
  while (off + 8 <= riffEnd) {
    const tag = String.fromCharCode(
      view.getUint8(off),
      view.getUint8(off + 1),
      view.getUint8(off + 2),
      view.getUint8(off + 3),
    );
    const len = view.getUint32(off + 4, true);
    const data = off + 8;
    if (data + len > riffEnd) break;
    if (tag === "VP8 " && len >= 10) {
      if (view.getUint32(data + 3) !== 0x2a019d) break; // 起始码不符 → 头不可读
      width = view.getUint16(data + 6) & 0x3fff;
      height = view.getUint16(data + 8) & 0x3fff;
    } else if (tag === "VP8L" && len >= 5 && view.getUint8(data) === 0x2f) {
      const bits = view.getUint32(data + 1, true);
      width = (bits & 0x3fff) + 1;
      height = ((bits >> 14) & 0x3fff) + 1;
    } else if (tag === "VP8X" && len >= 10) {
      width = (view.getUint32(data + 4) & 0xffffff) + 1;
      height = ((view.getUint32(data + 7) >> 8) & 0xffffff) + 1;
    } else if (tag === "EXIF" && len >= 8) {
      const head = data;
      // 规范允许以 "Exif\0\0" 或直接 TIFF 头开头
      const hasPrefix =
        view.getUint32(head) === 0x45786966 && view.getUint16(head + 4) === 0;
      const result = readTiffOrientation(view, head + (hasPrefix ? 6 : 0));
      if (result === "corrupt") corrupt = true;
      else if (result !== null) orientation = result;
    }
    off = data + len + (len % 2);
  }
  if (!width || !height) return { issue: "canvas-failed" };
  if (corrupt) return { issue: "unsupported-orientation" };
  if (orientation === null || orientation === 1)
    return { orientation: 1, width, height };
  return {
    orientation: orientation as 2 | 3 | 4 | 5 | 6 | 7 | 8,
    width,
    height,
  };
}

/** 读容器头：尺寸 + orientation（仅头扫描，提前拦截超大图，不解码像素） */
export function readImageMeta(blob: Blob): Promise<OrientationResult> {
  return blob
    .slice(0, 512 * 1024)
    .arrayBuffer()
    .then((buffer) => {
      const view = new DataView(buffer);
      const format = imageFormat(new Uint8Array(buffer));
      if (format === "jpeg") return parseJpeg(view);
      if (format === "png") return parsePng(view);
      if (format === "webp") return parseWebp(view);
      return { issue: "canvas-failed" as InpaintIssue };
    });
}

/** 准备实际请求底图：orientation 无/=1 复用原文件；2–8 解码应用方向重编码一次；
 *  失败返回明确错误，不静默退回。meta 由调用方读取（含头尺寸拦截）后传入 */
export async function prepareInpaintBase(
  blob: Blob,
  /** 用户文件名；没有就不记（系统来源的名字在展示时按语言生成） */
  name: string | undefined,
  meta: Exclude<OrientationResult, { issue: InpaintIssue }>,
  id: () => string = uuid,
): Promise<
  | {
      ok: true;
      base: import("../db/schema").ImageRow;
      /** 仅发生归一化时存在：原文件与其来源身份 */
      original?: {
        source: import("../lib/types").InputSource;
        image: import("../db/schema").ImageRow;
      };
    }
  | { ok: false; issue: InpaintIssue }
> {
  const format = imageFormat(
    new Uint8Array(await blob.slice(0, 12).arrayBuffer()),
  );
  if (!format) return { ok: false, issue: "canvas-failed" };

  if (meta.orientation === 1) {
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(blob);
    } catch {
      return { ok: false, issue: "canvas-failed" };
    }
    const { width, height } = bitmap;
    bitmap.close();
    return {
      ok: true,
      base: { id: id(), blob, width, height, format },
    };
  }

  // orientation 2–8：解码器应用方向一次，禁止手工旋转叠加
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
  } catch {
    return { ok: false, issue: "unsupported-orientation" };
  }
  try {
    const { width, height } = bitmap;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return { ok: false, issue: "canvas-failed" };
    ctx.drawImage(bitmap, 0, 0);
    const encodeFormat = format === "jpeg" ? "jpeg" : "png";
    const blobOut = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, `image/${encodeFormat}`, 0.92),
    );
    if (!blobOut || !blobOut.size) return { ok: false, issue: "canvas-failed" };
    const originalImage = {
      id: id(),
      blob,
      width: meta.width,
      height: meta.height,
      format,
    };
    return {
      ok: true,
      base: { id: id(), blob: blobOut, width, height, format: encodeFormat },
      original: {
        source: { imageId: originalImage.id, name },
        image: originalImage,
      },
    };
  } finally {
    bitmap.close();
  }
}
