/** GIF 编码 Worker：主线程逐帧传 RGBA，这里量化、索引化并写入 GIF 流。 */
import { GIFEncoder, applyPalette, quantize } from "gifenc";

type InitMessage = {
  type: "init";
  width: number;
  height: number;
  colors: number;
  loop: number;
  transparent: boolean;
};

type FrameMessage = {
  type: "frame";
  data: ArrayBuffer;
  delay: number;
};

type InMessage = InitMessage | FrameMessage | { type: "finish" };

type OutMessage =
  | { type: "progress"; done: number; total: number }
  | { type: "done"; buffer: ArrayBuffer; bytes: number }
  | { type: "error"; message: string };

let encoder: ReturnType<typeof GIFEncoder> | null = null;
let width = 0;
let height = 0;
let colors = 256;
let loop = 0;
let transparent = false;
let first = true;
let frames = 0;

function repeatFor(loopCount: number): number {
  // gifenc: -1 once, 0 forever, >0 extra iterations
  if (loopCount <= 0) return 0;
  if (loopCount === 1) return -1;
  return loopCount - 1;
}

function init(message: InitMessage): void {
  width = Math.max(1, Math.round(message.width));
  height = Math.max(1, Math.round(message.height));
  colors = Math.max(2, Math.min(256, Math.round(message.colors)));
  loop = message.loop;
  transparent = message.transparent;
  first = true;
  frames = 0;
  encoder = GIFEncoder({ initialCapacity: 1 << 20 });
}

/** GIF 只有 1bit 透明：抗锯齿边缘（半透明像素）必须先二值化。
 *  半透明像素直接进 gifenc 的最近色匹配，会被判成不透明——文字笔画变粗、
 *  字腔糊成实心块，导出结果和预览对不上（中文尤其明显）。 */
const ALPHA_CUTOFF = 128;

/** 半透明按阈值切成「全透明 / 全不透明」，颜色保留 */
function binarizeAlpha(rgba: Uint8ClampedArray): void {
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] >= ALPHA_CUTOFF) {
      rgba[i + 3] = 255;
      continue;
    }
    rgba[i] = 0;
    rgba[i + 1] = 0;
    rgba[i + 2] = 0;
    rgba[i + 3] = 0;
  }
}

/** 不透明导出：画布透明处会落成黑底，alpha 若直接丢掉，抗锯齿边缘会变成硬边
 *  （文字笔画变粗、字腔糊死）。先按 alpha 预乘，等价于把内容合成到黑底上。 */
function premultiplyAlpha(rgba: Uint8ClampedArray): void {
  for (let i = 0; i < rgba.length; i += 4) {
    const a = rgba[i + 3];
    if (a === 255) continue;
    rgba[i] = (rgba[i] * a) / 255;
    rgba[i + 1] = (rgba[i + 1] * a) / 255;
    rgba[i + 2] = (rgba[i + 2] * a) / 255;
    rgba[i + 3] = 255;
  }
}

function writeFrame(message: FrameMessage): void {
  if (!encoder) throw new Error("encoder-not-initialized");
  const rgba = new Uint8ClampedArray(message.data);
  const format = transparent ? "rgba4444" : "rgb565";
  if (transparent) binarizeAlpha(rgba);
  else premultiplyAlpha(rgba);
  const palette = quantize(
    rgba,
    colors,
    transparent
      ? { format, oneBitAlpha: true, clearAlpha: true, clearAlphaThreshold: 0 }
      : { format },
  );
  const index = applyPalette(rgba, palette, format);
  let transparentIndex = -1;
  if (transparent) {
    for (let i = 0; i < palette.length; i++) {
      if ((palette[i][3] ?? 255) <= 127) {
        transparentIndex = i;
        break;
      }
    }
  }
  encoder.writeFrame(index, width, height, {
    palette,
    delay: message.delay,
    transparent: transparentIndex >= 0,
    transparentIndex: Math.max(0, transparentIndex),
    repeat: first ? repeatFor(loop) : undefined,
  });
  first = false;
  frames += 1;
  const output: OutMessage = { type: "progress", done: frames, total: 0 };
  self.postMessage(output);
}

function finish(): void {
  if (!encoder) throw new Error("encoder-not-initialized");
  encoder.finish();
  const bytes = encoder.bytes();
  const output: OutMessage = {
    type: "done",
    buffer: bytes.buffer as ArrayBuffer,
    bytes: bytes.byteLength,
  };
  (
    self.postMessage as unknown as (
      message: OutMessage,
      transfer: Transferable[],
    ) => void
  )(output, [output.buffer]);
}

self.onmessage = (event: MessageEvent<InMessage>) => {
  try {
    const message = event.data;
    if (message.type === "init") {
      init(message);
      return;
    }
    if (message.type === "frame") {
      writeFrame(message);
      return;
    }
    finish();
  } catch (error) {
    const output: OutMessage = {
      type: "error",
      message: error instanceof Error ? error.message : "encode-failed",
    };
    self.postMessage(output);
  }
};
