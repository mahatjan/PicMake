/** GIF 素材读取：文件校验、视频元数据/seek、图片与 GIF 解码、Blob 缩略图。
 *  只做浏览器资源操作，不读写 store。 */
import type { GifIssue, GifSourceKind } from "./types";
import {
  GIF_MAX_FILE_BYTES,
  GIF_MAX_GIF_BYTES,
  GIF_MAX_IMAGE_BYTES,
  GIF_MAX_SOURCE_MS,
  GIF_THUMB_MIME,
} from "./types";

const MIME_VIDEO = /^video\//i;
const MIME_IMAGE = /^image\/(png|jpeg|webp|avif|gif)$/i;

export function fileKind(file: File): GifSourceKind | null {
  const name = file.name.toLowerCase();
  if (file.type === "image/gif" || name.endsWith(".gif")) return "gif";
  if (MIME_VIDEO.test(file.type) || /\.(mp4|m4v|mov|webm|ogv|ogg)$/i.test(name))
    return "video";
  if (MIME_IMAGE.test(file.type) || /\.(png|jpe?g|webp|avif)$/i.test(name))
    return "image";
  return null;
}

export function fileIssue(file: File, kind: GifSourceKind): GifIssue | null {
  if (kind === "image" && !MIME_IMAGE.test(file.type) && !file.name)
    return "unsupported-type";
  if (file.size <= 0) return "read-failed";
  if (kind === "video" && file.size > GIF_MAX_FILE_BYTES)
    return "file-too-large";
  if (kind === "gif" && file.size > GIF_MAX_GIF_BYTES) return "gif-too-large";
  if (kind === "image" && file.size > GIF_MAX_IMAGE_BYTES)
    return "file-too-large";
  return null;
}

export function imageMime(type: string): string {
  if (type === "image/jpeg" || type === "image/jpg") return "image/jpeg";
  if (type === "image/webp") return "image/webp";
  if (type === "image/avif") return "image/avif";
  return "image/png";
}

export async function loadVideoElement(url: string): Promise<HTMLVideoElement> {
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  video.crossOrigin = "anonymous";
  video.src = url;
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: GifIssue) => {
      if (settled) return;
      settled = true;
      video.removeEventListener("loadedmetadata", onReady);
      video.removeEventListener("error", onError);
      window.clearTimeout(timer);
      if (error) reject(new Error(error));
      else resolve();
    };
    const onReady = () => finish();
    const onError = () => finish("unsupported-codec");
    const timer = window.setTimeout(() => finish("metadata-failed"), 15_000);
    video.addEventListener("loadedmetadata", onReady, { once: true });
    video.addEventListener("error", onError, { once: true });
  });
  if (!Number.isFinite(video.duration) || video.duration <= 0)
    throw new Error("metadata-failed");
  return video;
}

export function videoSize(video: HTMLVideoElement): {
  width: number;
  height: number;
  durationMs: number;
} {
  return {
    width: video.videoWidth,
    height: video.videoHeight,
    durationMs: Math.round(video.duration * 1000),
  };
}

/** 等一次绘制机会。
 *  seek 完成后 'seeked' 触发时新帧已经可绘制，这里只让出一次合成机会；
 *  不用 requestVideoFrameCallback——暂停状态下 seek 不会触发新帧回调，
 *  只会白白等满超时（每帧 120ms，长视频会拖到分钟级）。 */
export function waitPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

export async function seekVideo(
  video: HTMLVideoElement,
  timeMs: number,
): Promise<void> {
  const duration = Number.isFinite(video.duration)
    ? video.duration
    : timeMs / 1000;
  const target = Math.max(0, Math.min(duration - 0.001, timeMs / 1000));
  if (Math.abs(video.currentTime - target) > 0.001) {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: boolean) => {
        if (settled) return;
        settled = true;
        video.removeEventListener("seeked", onSeeked);
        video.removeEventListener("error", onError);
        window.clearTimeout(timer);
        if (error) reject(new Error("decode-failed"));
        else resolve();
      };
      const onSeeked = () => finish();
      const onError = () => finish(true);
      const timer = window.setTimeout(() => finish(), 3000);
      video.addEventListener("seeked", onSeeked, { once: true });
      video.addEventListener("error", onError, { once: true });
      try {
        video.currentTime = target;
      } catch {
        finish(true);
      }
    });
  }
  await waitPaint();
}

/** 解码静态图片；长边超过 maxSide 时等比缩小，避免大图占内存 */
export async function decodeImage(
  blob: Blob,
  maxSide = 1920,
): Promise<{ bitmap: ImageBitmap; width: number; height: number }> {
  const source = await createImageBitmap(blob);
  if (source.width <= maxSide && source.height <= maxSide)
    return { bitmap: source, width: source.width, height: source.height };
  const scale = Math.min(maxSide / source.width, maxSide / source.height);
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  const resized = await createImageBitmap(source, {
    resizeWidth: width,
    resizeHeight: height,
    resizeQuality: "high",
  });
  source.close();
  return { bitmap: resized, width, height };
}

export async function thumbnailBlob(
  source: CanvasImageSource,
  width: number,
  height: number,
  maxSide = 320,
): Promise<Blob> {
  const scale = Math.min(1, maxSide / Math.max(1, width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas-failed");
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvasToBlob(canvas, GIF_THUMB_MIME, 0.8);
}

export async function canvasToBlob(
  canvas: HTMLCanvasElement,
  type = "image/jpeg",
  quality = 0.85,
): Promise<Blob> {
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, type, quality),
  );
  if (!blob) throw new Error("canvas-failed");
  return blob;
}

/** 视频/GIF 时长超过产品上限时返回可展示的问题码 */
export function sourceDurationIssue(durationMs: number): GifIssue | null {
  return durationMs > GIF_MAX_SOURCE_MS ? "too-long" : null;
}

/** 视频裁剪到项目默认时长；超长素材由 flow 提示后截取 */
export function clampSourceDuration(durationMs: number): number {
  return Math.min(GIF_MAX_SOURCE_MS, Math.max(100, Math.round(durationMs)));
}
