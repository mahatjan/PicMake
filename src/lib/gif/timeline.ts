/** GIF 时间轴：采样、选帧、方向、倍速与画布尺寸计算。纯函数。 */
import {
  GIF_DEFAULT_CANVAS_SIDE,
  GIF_DEFAULT_FPS,
  GIF_FPS_OPTIONS,
  GIF_MAX_CANVAS_SIDE,
  GIF_MAX_EXPORT_SIDE,
  GIF_MAX_FRAMES,
  GIF_MIN_DELAY_MS,
  frameDelay,
  type GifCanvas,
  type GifTimeline,
} from "./types";

export type GifAspect =
  "source" | "1:1" | "4:5" | "3:4" | "4:3" | "9:16" | "16:9" | "2:3" | "3:2";

export const GIF_ASPECTS: readonly { id: GifAspect; ratio: number | null }[] = [
  { id: "source", ratio: null },
  { id: "1:1", ratio: 1 },
  { id: "4:5", ratio: 4 / 5 },
  { id: "3:4", ratio: 3 / 4 },
  { id: "4:3", ratio: 4 / 3 },
  { id: "9:16", ratio: 9 / 16 },
  { id: "16:9", ratio: 16 / 9 },
  { id: "2:3", ratio: 2 / 3 },
  { id: "3:2", ratio: 3 / 2 },
];

const clamp = (v: number, min: number, max: number) =>
  Math.min(max, Math.max(min, v));

export function clampFps(fps: number): number {
  if (!Number.isFinite(fps)) return GIF_DEFAULT_FPS;
  let best = GIF_DEFAULT_FPS;
  let dist = Infinity;
  for (const option of GIF_FPS_OPTIONS) {
    const next = Math.abs(option - fps);
    if (next < dist) {
      dist = next;
      best = option;
    }
  }
  return best;
}

/** 把时间轴收进素材时长与产品限制内；选中帧按新帧表过滤 */
export function normalizeTimeline(
  timeline: GifTimeline,
  sourceDurationMs: number,
): GifTimeline {
  const duration = Math.max(100, Math.round(sourceDurationMs));
  const fps = clampFps(timeline.fps);
  let trimStart = clamp(timeline.trimStart, 0, duration - 100);
  let trimEnd = clamp(timeline.trimEnd, trimStart + 100, duration);
  if (trimStart > duration - 100) {
    trimStart = Math.max(0, duration - 100);
    trimEnd = duration;
  }
  const base: GifTimeline = {
    ...timeline,
    fps,
    trimStart: Math.round(trimStart),
    trimEnd: Math.round(trimEnd),
    speed: clamp(Number(timeline.speed) || 1, 0.2, 5),
    loop: Math.max(0, Math.min(99, Math.round(timeline.loop))),
    direction:
      timeline.direction === "reverse" || timeline.direction === "boomerang"
        ? timeline.direction
        : "forward",
  };
  const count = sampledTimes(base).length;
  if (base.selected === null) return base;
  const selected = [
    ...new Set(
      base.selected.filter(
        (index) => Number.isInteger(index) && index >= 0 && index < count,
      ),
    ),
  ].sort((a, b) => a - b);
  return { ...base, selected };
}

/** 采样帧对应的源时间；最后一帧不跨过 trimEnd */
export function sampledTimes(
  timeline: Pick<GifTimeline, "fps" | "trimStart" | "trimEnd">,
): number[] {
  const start = Math.max(0, timeline.trimStart);
  const end = Math.max(start, timeline.trimEnd);
  const step = 1000 / clampFps(timeline.fps);
  const times: number[] = [];
  for (let t = start; t < end - 0.5; t += step) times.push(Math.round(t));
  if (!times.length) times.push(Math.round(start));
  return times;
}

export function sourceFrameCount(
  timeline: Pick<GifTimeline, "fps" | "trimStart" | "trimEnd">,
): number {
  return sampledTimes(timeline).length;
}

/** 选中的采样帧下标；null 表示全选 */
export function selectedIndices(timeline: GifTimeline): number[] {
  const count = sourceFrameCount(timeline);
  if (timeline.selected === null)
    return Array.from({ length: count }, (_, i) => i);
  return [...new Set(timeline.selected)]
    .filter((index) => index >= 0 && index < count)
    .sort((a, b) => a - b);
}

/** 输出帧的源时间：先选帧，再按方向重排；来回不重复首尾 */
export function outputSourceTimes(timeline: GifTimeline): number[] {
  const times = sampledTimes(timeline);
  const selected = selectedIndices(timeline).map((index) => times[index]);
  if (timeline.direction === "reverse") return selected.reverse();
  if (timeline.direction === "boomerang" && selected.length > 1)
    return [...selected, ...selected.slice(0, -1).reverse()];
  return selected;
}

export function outputFrameCount(timeline: GifTimeline): number {
  return outputSourceTimes(timeline).length;
}

/** 一个循环的时长：帧数 × 实际帧延时 */
export function outputDuration(timeline: GifTimeline): number {
  return outputFrameCount(timeline) * frameDelay(timeline);
}

/** 导出帧率只重采样成品时间轴，不改变编辑采样、选帧、倍速或图层时间。 */
export function exportFrameCount(timeline: GifTimeline, fps: number): number {
  const duration = outputDuration(timeline);
  if (!duration) return 0;
  return Math.max(
    1,
    Math.min(
      Math.ceil((duration * clampFps(fps)) / 1000),
      Math.floor(duration / GIF_MIN_DELAY_MS),
    ),
  );
}

export function exportFrameIssue(
  timeline: GifTimeline,
  fps: number,
): "no-frames" | "too-many-frames" | null {
  const count = exportFrameCount(timeline, fps);
  if (!count) return "no-frames";
  return count > GIF_MAX_FRAMES ? "too-many-frames" : null;
}

export interface GifExportFrame {
  /** 成品时间，用于图层入/出点与动图图层取帧。 */
  time: number;
  sourceTime: number;
  delay: number;
}

/** 延时按 10ms 分配，所有帧延时之和严格等于编辑器的成品时长。 */
export function exportFrameSchedule(
  timeline: GifTimeline,
  fps: number,
): GifExportFrame[] {
  const count = exportFrameCount(timeline, fps);
  const duration = outputDuration(timeline);
  const sourceTimes = outputSourceTimes(timeline);
  const sourceDelay = frameDelay(timeline);
  let time = 0;
  return Array.from({ length: count }, (_, index) => {
    const end =
      index === count - 1
        ? duration
        : Math.round(((index + 1) * duration) / count / 10) * 10;
    const frame = {
      time,
      sourceTime:
        sourceTimes[
          Math.min(sourceTimes.length - 1, Math.floor(time / sourceDelay))
        ],
      delay: end - time,
    };
    time = end;
    return frame;
  });
}

export function frameDelayMs(timeline: GifTimeline): number {
  return frameDelay(timeline);
}

/** 项目时间 → 第几帧（0 起）；无帧时返回 0 */
export function frameIndexAt(
  timeline: GifTimeline,
  projectTime: number,
): number {
  const count = outputFrameCount(timeline);
  if (!count) return 0;
  const delay = frameDelay(timeline);
  return clamp(Math.floor(projectTime / delay), 0, count - 1);
}

/** 项目时间 → 当前帧的源时间 */
export function sourceTimeAt(
  timeline: GifTimeline,
  projectTime: number,
): number {
  const times = outputSourceTimes(timeline);
  if (!times.length) return timeline.trimStart;
  return times[frameIndexAt(timeline, projectTime)] ?? timeline.trimStart;
}

export function projectTimeAtFrame(
  timeline: GifTimeline,
  index: number,
): number {
  return Math.max(0, index) * frameDelay(timeline);
}

/** 切换某一帧；全选时取消一帧后仍返回显式列表 */
export function toggleSelectedFrame(
  timeline: GifTimeline,
  index: number,
): number[] {
  const count = sourceFrameCount(timeline);
  if (index < 0 || index >= count) return selectedIndices(timeline);
  const current = new Set(selectedIndices(timeline));
  if (current.has(index)) current.delete(index);
  else current.add(index);
  if (current.size === count) return Array.from({ length: count }, (_, i) => i);
  return [...current].sort((a, b) => a - b);
}

export function sampleEvery(timeline: GifTimeline, every: number): number[] {
  const count = sourceFrameCount(timeline);
  const step = Math.max(1, Math.round(every));
  const result: number[] = [];
  for (let i = 0; i < count; i += step) result.push(i);
  return result;
}

export function invertSelected(timeline: GifTimeline): number[] {
  const count = sourceFrameCount(timeline);
  const current = new Set(selectedIndices(timeline));
  return Array.from({ length: count }, (_, i) => i).filter(
    (i) => !current.has(i),
  );
}

/** 选中帧变更后如果等于全选，用 null 表示，减少存储 */
export function compactSelection(
  selected: number[],
  count: number,
): number[] | null {
  return selected.length === count ? null : selected;
}

export function fitCanvasForSource(
  sourceWidth: number,
  sourceHeight: number,
  maxSide = GIF_DEFAULT_CANVAS_SIDE,
): Pick<GifCanvas, "width" | "height"> {
  const w = Math.max(1, sourceWidth || 1);
  const h = Math.max(1, sourceHeight || 1);
  const scale = Math.min(1, maxSide / Math.max(w, h));
  return {
    width: Math.max(2, Math.round(w * scale)),
    height: Math.max(2, Math.round(h * scale)),
  };
}

export function canvasForAspect(
  aspect: GifAspect,
  sourceWidth: number,
  sourceHeight: number,
): Pick<GifCanvas, "width" | "height"> {
  if (aspect === "source")
    return fitCanvasForSource(sourceWidth, sourceHeight, GIF_MAX_CANVAS_SIDE);
  const ratio = GIF_ASPECTS.find((item) => item.id === aspect)?.ratio ?? 1;
  const long =
    ratio >= 1
      ? {
          width: GIF_DEFAULT_CANVAS_SIDE,
          height: GIF_DEFAULT_CANVAS_SIDE / ratio,
        }
      : {
          width: GIF_DEFAULT_CANVAS_SIDE * ratio,
          height: GIF_DEFAULT_CANVAS_SIDE,
        };
  return {
    width: Math.max(2, Math.round(long.width)),
    height: Math.max(2, Math.round(long.height)),
  };
}

export function canvasAspectId(
  canvas: Pick<GifCanvas, "width" | "height">,
  sourceWidth: number,
  sourceHeight: number,
): GifAspect {
  const ratio = canvas.width / Math.max(1, canvas.height);
  if (Math.abs(ratio - sourceWidth / Math.max(1, sourceHeight)) < 0.01)
    return "source";
  let best: GifAspect = "1:1";
  let dist = Infinity;
  for (const item of GIF_ASPECTS) {
    if (item.ratio === null) continue;
    const next = Math.abs(item.ratio - ratio);
    if (next < dist) {
      dist = next;
      best = item.id;
    }
  }
  return dist < 0.02 ? best : "1:1";
}

/** 导出宽高：targetWidth 为短边还是宽？这里按画布宽等比，并限制最长边 */
export function exportDimensions(
  canvas: Pick<GifCanvas, "width" | "height">,
  targetWidth: number,
): { width: number; height: number } {
  const width = clamp(Math.round(targetWidth), 16, GIF_MAX_EXPORT_SIDE);
  const ratio = canvas.height / Math.max(1, canvas.width);
  let height = Math.max(16, Math.round(width * ratio));
  if (height > GIF_MAX_EXPORT_SIDE) {
    const scale = GIF_MAX_EXPORT_SIDE / height;
    return {
      width: Math.max(16, Math.round(width * scale)),
      height: GIF_MAX_EXPORT_SIDE,
    };
  }
  return { width, height };
}

export function isTimelineOverFrameLimit(timeline: GifTimeline): boolean {
  return outputFrameCount(timeline) > GIF_MAX_FRAMES;
}
