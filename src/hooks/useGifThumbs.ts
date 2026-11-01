/** 胶片条与选帧网格缩略图：视频 seek 采样，图片/GIF 直接取帧；Object URL 在卸载时回收。 */
import { useEffect, useState } from "react";
import type { DecodedGif } from "../lib/gif/decode";
import { canvasToBlob, loadVideoElement, seekVideo } from "../lib/gif/media";
import { gifFrameAt } from "../lib/gif/render";
import { sampledTimes } from "../lib/gif/timeline";
import type { GifProject } from "../lib/gif/types";

export interface GifThumb {
  index: number;
  time: number;
  url: string;
}

async function drawThumb(
  source: {
    video: HTMLVideoElement | null;
    image: ImageBitmap | null;
    gif: DecodedGif | null;
  },
  time: number,
  width: number,
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(2, Math.round(width));
  canvas.height = Math.max(2, Math.round(canvas.width * 0.75));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas-failed");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (source.video) {
    await seekVideo(source.video, time);
    const vw = source.video.videoWidth;
    const vh = source.video.videoHeight;
    const scale = Math.min(canvas.width / vw, canvas.height / vh);
    const w = vw * scale;
    const h = vh * scale;
    ctx.drawImage(
      source.video,
      (canvas.width - w) / 2,
      (canvas.height - h) / 2,
      w,
      h,
    );
  } else if (source.image) {
    const scale = Math.min(
      canvas.width / source.image.width,
      canvas.height / source.image.height,
    );
    const w = source.image.width * scale;
    const h = source.image.height * scale;
    ctx.drawImage(
      source.image,
      (canvas.width - w) / 2,
      (canvas.height - h) / 2,
      w,
      h,
    );
  } else if (source.gif) {
    const frame = gifFrameAt(
      {
        frames: source.gif.frames,
        durations: source.gif.durations,
        totalMs: source.gif.totalMs,
        width: source.gif.width,
        height: source.gif.height,
      },
      time,
      true,
    );
    if (frame) {
      const scale = Math.min(
        canvas.width / source.gif.width,
        canvas.height / source.gif.height,
      );
      const w = source.gif.width * scale;
      const h = source.gif.height * scale;
      ctx.drawImage(
        frame,
        (canvas.width - w) / 2,
        (canvas.height - h) / 2,
        w,
        h,
      );
    }
  }
  return canvasToBlob(canvas, "image/jpeg", 0.72);
}

function useThumbs(
  project: GifProject | null,
  sourceUrl: string | null,
  sourceImage: ImageBitmap | null,
  sourceGif: DecodedGif | null,
  times: number[],
  width: number,
  enabled: boolean,
): { thumbs: GifThumb[]; loading: boolean } {
  const [thumbs, setThumbs] = useState<GifThumb[]>([]);
  const [loading, setLoading] = useState(false);
  const key = [
    project?.id ?? "",
    project?.source.kind ?? "",
    times.join(","),
    width,
    enabled ? "1" : "0",
  ].join("|");

  useEffect(() => {
    if (!project || !enabled) {
      setThumbs((prev) => {
        prev.forEach((thumb) => URL.revokeObjectURL(thumb.url));
        return [];
      });
      return;
    }
    let cancelled = false;
    const urls: string[] = [];
    setLoading(true);
    void (async () => {
      let video: HTMLVideoElement | null = null;
      try {
        if (project.source.kind === "video") {
          if (!sourceUrl) return;
          video = await loadVideoElement(sourceUrl);
        }
        const next: GifThumb[] = [];
        for (let i = 0; i < times.length; i++) {
          if (cancelled) break;
          const blob = await drawThumb(
            { video, image: sourceImage, gif: sourceGif },
            times[i],
            width,
          );
          const url = URL.createObjectURL(blob);
          urls.push(url);
          next.push({ index: i, time: times[i], url });
          if (i % 3 === 0) await new Promise((r) => setTimeout(r, 0));
        }
        if (!cancelled) setThumbs(next);
      } catch {
        if (!cancelled) setThumbs([]);
      } finally {
        if (video) {
          video.pause();
          video.removeAttribute("src");
          video.load();
        }
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
    // 依赖 key + 素材：拖动/改样式不重建，但源 URL/解码结果要能到达后重跑
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, sourceUrl, sourceImage, sourceGif]);

  return { thumbs, loading };
}

export function useGifFilmstrip(
  project: GifProject | null,
  sourceUrl: string | null,
  sourceImage: ImageBitmap | null,
  sourceGif: DecodedGif | null,
): { thumbs: GifThumb[]; loading: boolean } {
  const times = project
    ? Array.from({ length: 16 }, (_, i) => {
        const step = project.source.durationMs / 16;
        return Math.round(step * (i + 0.5));
      })
    : [];
  return useThumbs(
    project,
    sourceUrl,
    sourceImage,
    sourceGif,
    times,
    120,
    !!project,
  );
}

export function useGifFrameThumbs(
  project: GifProject | null,
  sourceUrl: string | null,
  sourceImage: ImageBitmap | null,
  sourceGif: DecodedGif | null,
  enabled: boolean,
): { thumbs: GifThumb[]; loading: boolean } {
  const times = project ? sampledTimes(project.timeline) : [];
  return useThumbs(
    project,
    sourceUrl,
    sourceImage,
    sourceGif,
    times,
    88,
    enabled,
  );
}
