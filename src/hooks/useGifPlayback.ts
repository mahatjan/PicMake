/** 编辑器播放时钟：普通正放优先让 <video> 自己播，倒放/来回/手选帧用 rAF 定时器并逐帧 seek。
 *  预览循环固定开启；导出循环由项目设置控制。 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { seekVideo } from "../lib/gif/media";
import {
  frameIndexAt,
  frameDelayMs,
  outputDuration,
  sourceTimeAt,
} from "../lib/gif/timeline";
import type { GifProject, GifTimeline } from "../lib/gif/types";

export function useGifPlayback(opts: {
  project: GifProject | null;
  sourceUrl: string | null;
  videoRef: RefObject<HTMLVideoElement | null>;
}) {
  const { project, sourceUrl, videoRef } = opts;
  const timeline: GifTimeline | null = project?.timeline ?? null;
  const duration = project ? outputDuration(project.timeline) : 0;
  const [time, setTimeState] = useState(0);
  const [playing, setPlaying] = useState(false);
  const timeRef = useRef(0);
  const seeking = useRef(false);

  const setTime = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(duration, next));
      timeRef.current = clamped;
      setTimeState(clamped);
    },
    [duration],
  );

  const seek = useCallback(
    (next: number) => {
      setPlaying(false);
      setTime(next);
      const video = videoRef.current;
      if (video && timeline && sourceUrl && project?.source.kind === "video") {
        const sourceMs = sourceTimeAt(timeline, next);
        void seekVideo(video, sourceMs);
      }
    },
    [project?.source.kind, setTime, sourceUrl, timeline, videoRef],
  );

  useEffect(() => {
    // 切换项目：停止播放并把时钟归零
    // oxlint-disable-next-line react/set-state-in-effect
    setPlaying(false);
    // oxlint-disable-next-line react/set-state-in-effect
    setTimeState(0);
    timeRef.current = 0;
    // GIF 源本身是动图，打开就直接播起来，避免看起来"没动"
    // oxlint-disable-next-line react/set-state-in-effect
    if (project?.source.kind === "gif") setPlaying(true);
  }, [project?.id, project?.source.kind]);

  useEffect(() => {
    // 时间轴变短时把播放头收回末尾
    // oxlint-disable-next-line react/set-state-in-effect
    if (time > duration) setTime(duration);
  }, [duration, setTime, time]);

  const selectedKey = timeline?.selected?.join(",") ?? "all";
  const direction = timeline?.direction ?? "forward";
  const speed = timeline?.speed ?? 1;
  const trimStart = timeline?.trimStart ?? 0;
  const trimEnd = timeline?.trimEnd ?? 0;

  useEffect(() => {
    if (!project || !timeline || !playing) {
      const video = videoRef.current;
      video?.pause();
      return;
    }
    const video = videoRef.current;
    const canUseVideoPlayback =
      project.source.kind === "video" &&
      !!sourceUrl &&
      !!video &&
      direction === "forward" &&
      selectedKey === "all";
    let raf = 0;
    let stopped = false;
    const started = performance.now();
    const startTime = timeRef.current;

    if (canUseVideoPlayback && video) {
      const sourceStart = trimStart / 1000;
      const sourceEnd = trimEnd / 1000;
      if (
        video.currentTime < sourceStart ||
        video.currentTime >= sourceEnd - 0.001
      )
        video.currentTime = sourceStart;
      // GIF 延时会按 10ms 对齐；原生播放也按实际帧延时计算速度。
      const playbackRate = 1000 / timeline.fps / frameDelayMs(timeline);
      video.playbackRate = playbackRate;
      void video.play().catch(() => setPlaying(false));
      const tick = () => {
        if (stopped) return;
        const sourceMs = video.currentTime * 1000;
        setTime((sourceMs - trimStart) / playbackRate);
        if (sourceMs >= trimEnd - 8) {
          video.currentTime = sourceStart;
          setTime(0);
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      return () => {
        stopped = true;
        cancelAnimationFrame(raf);
        video.pause();
      };
    }

    video?.pause();
    let lastFrame = -1;
    const tick = (now: number) => {
      if (stopped) return;
      // 项目帧延时已包含倍速；项目时钟始终按真实经过时间推进。
      let next = startTime + (now - started);
      if (next >= duration) next = duration ? next % duration : 0;
      setTime(next);
      if (video && sourceUrl) {
        const index = frameIndexAt(timeline, next);
        if (index !== lastFrame && !seeking.current) {
          lastFrame = index;
          seeking.current = true;
          void seekVideo(video, sourceTimeAt(timeline, next))
            .catch(() => {
              if (!stopped) setPlaying(false);
            })
            .finally(() => {
              seeking.current = false;
            });
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
    };
  }, [
    direction,
    duration,
    playing,
    project,
    selectedKey,
    setTime,
    sourceUrl,
    speed,
    timeline,
    trimEnd,
    trimStart,
    videoRef,
  ]);

  const toggle = useCallback(() => {
    if (playing) setPlaying(false);
    else {
      if (timeRef.current >= duration - 1) setTime(0);
      setPlaying(true);
    }
  }, [duration, playing, setTime]);

  return {
    time,
    playing,
    duration,
    toggle,
    seek,
    setPlaying,
  };
}
