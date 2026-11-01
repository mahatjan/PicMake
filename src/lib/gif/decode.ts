/** GIF 解码：gifuct-js 解析 → 按 disposal/透明合成完整帧 → ImageBitmap。
 *  只负责把字节变成可绘制的帧；限制与错误码由调用方决定。 */
import { decompressFrames, parseGIF, type ParsedFrame } from "gifuct-js";
import { GIF_MAX_GIF_LAYER_FRAMES, type GifIssue } from "./types";

export interface DecodedGif {
  width: number;
  height: number;
  frames: ImageBitmap[];
  durations: number[];
  totalMs: number;
}

export class GifDecodeError extends Error {
  code: GifIssue;
  constructor(code: GifIssue) {
    super(code);
    this.name = "GifDecodeError";
    this.code = code;
  }
}

function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

async function snapshot(
  canvas: HTMLCanvasElement,
  maxSide: number,
): Promise<ImageBitmap> {
  if (canvas.width <= maxSide && canvas.height <= maxSide)
    return createImageBitmap(canvas);
  const scale = Math.min(maxSide / canvas.width, maxSide / canvas.height);
  const scaled = makeCanvas(canvas.width * scale, canvas.height * scale);
  const ctx = scaled.getContext("2d");
  if (!ctx) throw new GifDecodeError("decode-failed");
  ctx.drawImage(canvas, 0, 0, scaled.width, scaled.height);
  return createImageBitmap(scaled);
}

export async function decodeGif(
  blob: Blob,
  opts: { maxFrames?: number; maxSide?: number } = {},
): Promise<DecodedGif> {
  const maxFrames = opts.maxFrames ?? GIF_MAX_GIF_LAYER_FRAMES;
  const maxSide = opts.maxSide ?? 1024;
  const buffer = await blob.arrayBuffer();
  let parsed;
  try {
    parsed = parseGIF(buffer);
  } catch {
    throw new GifDecodeError("decode-failed");
  }
  const width = parsed.lsd.width;
  const height = parsed.lsd.height;
  if (!width || !height) throw new GifDecodeError("decode-failed");
  const raw = decompressFrames(parsed, true);
  if (!raw.length) throw new GifDecodeError("decode-failed");
  if (raw.length > maxFrames) throw new GifDecodeError("gif-too-many-frames");

  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new GifDecodeError("decode-failed");
  const patch = makeCanvas(1, 1);
  const patchCtx = patch.getContext("2d");
  if (!patchCtx) throw new GifDecodeError("decode-failed");

  const frames: ImageBitmap[] = [];
  const durations: number[] = [];
  let previous: { frame: ParsedFrame; snapshot: ImageData | null } | null =
    null;

  for (const frame of raw) {
    if (previous) {
      if (previous.frame.disposalType === 2) {
        const { left, top, width: w, height: h } = previous.frame.dims;
        ctx.clearRect(left, top, w, h);
      } else if (previous.frame.disposalType === 3 && previous.snapshot) {
        ctx.putImageData(previous.snapshot, 0, 0);
      }
    }
    const before =
      frame.disposalType === 3 ? ctx.getImageData(0, 0, width, height) : null;
    const { left, top, width: w, height: h } = frame.dims;
    patch.width = Math.max(1, w);
    patch.height = Math.max(1, h);
    patchCtx.clearRect(0, 0, patch.width, patch.height);
    try {
      patchCtx.putImageData(
        new ImageData(new Uint8ClampedArray(frame.patch), w, h),
        0,
        0,
      );
    } catch {
      throw new GifDecodeError("decode-failed");
    }
    ctx.drawImage(patch, left, top);
    frames.push(await snapshot(canvas, maxSide));
    durations.push(Math.max(10, frame.delay || 100));
    previous = { frame, snapshot: before };
  }

  return {
    width: canvas.width,
    height: canvas.height,
    frames,
    durations,
    totalMs: durations.reduce((sum, value) => sum + value, 0),
  };
}

export function closeDecodedGif(gif: DecodedGif): void {
  for (const frame of gif.frames) frame.close();
}
