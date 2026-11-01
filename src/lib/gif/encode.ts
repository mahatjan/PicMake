/** GIF 编码客户端：把合成好的 RGBA 帧逐帧交给 Worker，最后拿回 Blob。
 *  帧数据通过 transferable 转移，主线程不保留副本。 */
import { GIF_MAX_COLORS } from "./types";

export interface GifEncodeOptions {
  width: number;
  height: number;
  colors: number;
  loop: number;
  transparent: boolean;
}

type WorkerOut =
  | { type: "progress"; done: number }
  | { type: "done"; buffer: ArrayBuffer; bytes: number }
  | { type: "error"; message: string };

export class GifEncoderClient {
  private worker: Worker;
  private pending: {
    resolve: (value: { blob: Blob; bytes: number }) => void;
    reject: (reason: Error) => void;
  } | null = null;
  private onProgress: ((done: number) => void) | null = null;
  private finished = false;

  constructor(opts: GifEncodeOptions, onProgress?: (done: number) => void) {
    this.onProgress = onProgress ?? null;
    this.worker = new Worker(
      new URL("../../workers/gif-encode.worker.ts", import.meta.url),
      { type: "module" },
    );
    this.worker.onmessage = (event: MessageEvent<WorkerOut>) => {
      const message = event.data;
      if (message.type === "progress") {
        this.onProgress?.(message.done);
        return;
      }
      if (message.type === "error") {
        this.reject(new Error(message.message));
        return;
      }
      const blob = new Blob([message.buffer], { type: "image/gif" });
      this.finished = true;
      this.worker.terminate();
      this.pending?.resolve({ blob, bytes: message.bytes });
      this.pending = null;
    };
    this.worker.onerror = (event) => {
      this.reject(new Error(event.message || "encode-failed"));
    };
    this.worker.postMessage({
      type: "init",
      width: Math.max(1, Math.round(opts.width)),
      height: Math.max(1, Math.round(opts.height)),
      colors: Math.max(2, Math.min(GIF_MAX_COLORS, opts.colors)),
      loop: opts.loop,
      transparent: opts.transparent,
    });
  }

  writeFrame(image: ImageData, delay: number): void {
    if (this.finished) return;
    const buffer = image.data.buffer;
    this.worker.postMessage({ type: "frame", data: buffer, delay }, [buffer]);
  }

  finish(): Promise<{ blob: Blob; bytes: number }> {
    return new Promise((resolve, reject) => {
      this.pending = { resolve, reject };
      this.worker.postMessage({ type: "finish" });
    });
  }

  cancel(): void {
    if (this.finished) return;
    this.finished = true;
    this.worker.terminate();
    this.reject(new Error("cancelled"));
  }

  private reject(error: Error): void {
    this.finished = true;
    this.pending?.reject(error);
    this.pending = null;
  }
}
