/** GIF 时间轴：胶片条、裁剪区间、播放头、图层时长条与速度/方向。纯展示。 */
import {
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { Pause, Play, Scissors } from "lucide-react";
import {
  frameDelay,
  type GifLayer,
  type GifProject,
  type GifTimeline as Timeline,
} from "../../lib/gif/types";
import {
  moveLayerWindow,
  resizeLayerEnd,
  resizeLayerStart,
} from "../../lib/gif/layers";
import type { GifThumb } from "../../hooks/useGifThumbs";

const clamp = (v: number, min: number, max: number) =>
  Math.min(max, Math.max(min, v));

function clock(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${m}:${rest.toFixed(1).padStart(4, "0")}`;
}

type DragKind =
  { kind: "play" } | { kind: "trim-start" } | { kind: "trim-end" };

/** 时间轴上拖动图层条：整条平移或拖边缘改入/出点 */
type TrackDrag = {
  id: string;
  mode: "move" | "start" | "end";
  /** 按下时的入/出点：拖动计算以它为基准 */
  origin: { start: number; end: number };
  /** 最近一次已应用的值：用来判断是否真的变了 */
  applied: { start: number; end: number };
  /** 指针与条起点的时间差（毫秒） */
  grab: number;
  rect: DOMRect;
  begun: boolean;
};

export function GifTimeline(props: {
  project: GifProject;
  thumbs: GifThumb[];
  time: number;
  playing: boolean;
  duration: number;
  frameCount: number;
  selectedLayerId: string | null;
  onToggle: () => void;
  onSeek: (time: number) => void;
  onTrim: (patch: Partial<Timeline>, record: boolean) => void;
  onPatchLayer: (id: string, patch: Partial<GifLayer>, record: boolean) => void;
  onBeginEdit: () => void;
  onEndEdit: () => void;
  onSelectLayer: (id: string) => void;
  onOpenFrames: () => void;
}) {
  const { t } = useTranslation();
  const stripRef = useRef<HTMLDivElement>(null);
  const drag = useRef<DragKind | null>(null);
  const [dragging, setDragging] = useState(false);
  const sourceDuration = Math.max(1, props.project.source.durationMs);
  const trimStart = props.project.timeline.trimStart;
  const trimEnd = props.project.timeline.trimEnd;
  const trimLeft = (trimStart / sourceDuration) * 100;
  const trimWidth = ((trimEnd - trimStart) / sourceDuration) * 100;
  const playPercent = props.duration
    ? trimLeft + (props.time / props.duration) * trimWidth
    : trimLeft;
  const minSpan = Math.max(100, 1000 / props.project.timeline.fps);
  const trackDrag = useRef<TrackDrag | null>(null);
  const trackDuration = Math.max(1, props.duration);
  /** 一帧的时长：拖动时吸附到帧 */
  const frame = frameDelay(props.project.timeline);

  /** 轨道区 clientX → 项目时间（毫秒） */
  const trackTimeAt = (clientX: number, rect: DOMRect) =>
    ((clientX - rect.left) / Math.max(1, rect.width)) * trackDuration;

  /** 按下图层条：靠近边缘就是改入/出点，否则整条平移 */
  const onTrackPointerDown = (
    event: ReactPointerEvent<HTMLButtonElement>,
    layer: GifLayer,
  ) => {
    if (event.button !== 0) return;
    const row = event.currentTarget.parentElement;
    if (!row) return;
    const rect = row.getBoundingClientRect();
    const barLeft = (layer.start / trackDuration) * rect.width;
    const barWidth = ((layer.end - layer.start) / trackDuration) * rect.width;
    const local = event.clientX - rect.left;
    const edge = 8;
    const mode: TrackDrag["mode"] =
      local - barLeft <= edge
        ? "start"
        : barLeft + barWidth - local <= edge
          ? "end"
          : "move";
    trackDrag.current = {
      id: layer.id,
      mode,
      origin: { start: layer.start, end: layer.end },
      applied: { start: layer.start, end: layer.end },
      grab: trackTimeAt(event.clientX, rect) - layer.start,
      rect,
      begun: false,
    };
    props.onSelectLayer(layer.id);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onTrackPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const current = trackDrag.current;
    if (!current) return;
    const pointer = trackTimeAt(event.clientX, current.rect);
    const next =
      current.mode === "move"
        ? moveLayerWindow(
            current.origin,
            pointer,
            current.grab,
            trackDuration,
            frame,
          )
        : current.mode === "start"
          ? resizeLayerStart(current.origin, pointer, trackDuration, frame)
          : resizeLayerEnd(current.origin, pointer, trackDuration, frame);
    if (
      next.start === current.applied.start &&
      next.end === current.applied.end
    )
      return;
    current.applied = next;
    if (!current.begun) {
      current.begun = true;
      props.onBeginEdit();
    }
    props.onPatchLayer(current.id, next, false);
  };

  const endTrackDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const current = trackDrag.current;
    if (!current) return;
    trackDrag.current = null;
    if (current.begun) props.onEndEdit();
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const sourceAt = (clientX: number) => {
    const rect = stripRef.current?.getBoundingClientRect();
    if (!rect) return trimStart;
    return clamp(
      ((clientX - rect.left) / rect.width) * sourceDuration,
      0,
      sourceDuration,
    );
  };

  const seekFrom = (clientX: number) => {
    const ratio = clamp(
      (sourceAt(clientX) - trimStart) / Math.max(1, trimEnd - trimStart),
      0,
      1,
    );
    props.onSeek(ratio * props.duration);
  };

  const trimFrom = (kind: "trim-start" | "trim-end", clientX: number) => {
    const value = sourceAt(clientX);
    if (kind === "trim-start")
      props.onTrim({ trimStart: Math.min(value, trimEnd - minSpan) }, false);
    else props.onTrim({ trimEnd: Math.max(value, trimStart + minSpan) }, false);
  };

  const onTrimPointerDown = (
    kind: "trim-start" | "trim-end",
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    event.stopPropagation();
    drag.current = { kind };
    props.onBeginEdit();
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onTrimPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const current = drag.current;
    if (!current || current.kind === "play") return;
    trimFrom(current.kind, event.clientX);
  };

  const endTrim = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!drag.current) return;
    drag.current = null;
    setDragging(false);
    props.onEndEdit();
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return (
    <div className="pm-gif-timeline">
      <div className="pm-gif-transport">
        <button
          type="button"
          className="pm-gif-play"
          aria-label={
            props.playing ? t("gif.editor.pause") : t("gif.editor.play")
          }
          onClick={props.onToggle}
        >
          {props.playing ? <Pause size={15} /> : <Play size={15} />}
        </button>
        <span className="pm-gif-clock">
          {clock(props.time)} / {clock(props.duration)}
        </span>
        <label className="pm-gif-inline">
          <span>{t("gif.timeline.speed")}</span>
          <select
            value={props.project.timeline.speed}
            onChange={(event) =>
              props.onTrim({ speed: Number(event.target.value) }, true)
            }
          >
            {[0.5, 1, 1.5, 2, 3, 4, 5].map((value) => (
              <option key={value} value={value}>
                {value}x
              </option>
            ))}
          </select>
        </label>
        <div
          className="pm-gif-seg"
          role="group"
          aria-label={t("gif.timeline.direction")}
        >
          {(["forward", "reverse", "boomerang"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={props.project.timeline.direction === value}
              onClick={() => props.onTrim({ direction: value }, true)}
            >
              {t(`gif.timeline.${value}`)}
            </button>
          ))}
        </div>
        <label className="pm-gif-inline">
          <span>{t("gif.timeline.fps")}</span>
          <select
            value={props.project.timeline.fps}
            onChange={(event) =>
              props.onTrim({ fps: Number(event.target.value) }, true)
            }
          >
            {[5, 10, 12.5, 15, 20, 25].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <span className="pm-gif-framecount">
          {t("gif.timeline.frameCount", { count: props.frameCount })}
        </span>
        <button
          type="button"
          className="pm-gif-framebtn"
          onClick={props.onOpenFrames}
        >
          <Scissors size={14} />
          {t("gif.editor.frames")}
        </button>
      </div>

      <div
        ref={stripRef}
        className={"pm-gif-strip" + (dragging ? " is-dragging" : "")}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          drag.current = { kind: "play" };
          seekFrom(event.clientX);
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (drag.current?.kind === "play") seekFrom(event.clientX);
        }}
        onPointerUp={(event) => {
          if (!drag.current) return;
          drag.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        <div className="pm-gif-films">
          {props.thumbs.map((thumb) => (
            <img key={thumb.index} src={thumb.url} alt="" draggable={false} />
          ))}
        </div>
        <div
          className="pm-gif-trim"
          style={{ left: `${trimLeft}%`, width: `${trimWidth}%` }}
        />
        <button
          type="button"
          className="pm-gif-trimtab start"
          style={{ left: `${trimLeft}%` }}
          aria-label={t("gif.timeline.trimStart")}
          onPointerDown={(event) => onTrimPointerDown("trim-start", event)}
          onPointerMove={onTrimPointerMove}
          onPointerUp={endTrim}
          onPointerCancel={endTrim}
        />
        <button
          type="button"
          className="pm-gif-trimtab end"
          style={{ left: `${trimLeft + trimWidth}%` }}
          aria-label={t("gif.timeline.trimEnd")}
          onPointerDown={(event) => onTrimPointerDown("trim-end", event)}
          onPointerMove={onTrimPointerMove}
          onPointerUp={endTrim}
          onPointerCancel={endTrim}
        />
        <div className="pm-gif-playhead" style={{ left: `${playPercent}%` }}>
          <i />
        </div>
      </div>

      <div className="pm-gif-tracks">
        {props.project.layers.length === 0 ? (
          <span className="pm-gif-tracks-empty">{t("gif.layers.empty")}</span>
        ) : (
          props.project.layers.map((layer, index) => {
            const left = props.duration
              ? (layer.start / props.duration) * 100
              : 0;
            const width = props.duration
              ? ((layer.end - layer.start) / props.duration) * 100
              : 0;
            return (
              <div key={layer.id} className="pm-gif-track-row">
                <button
                  type="button"
                  className={
                    "pm-gif-track " +
                    layer.kind +
                    (layer.id === props.selectedLayerId ? " is-selected" : "")
                  }
                  style={{ left: `${left}%`, width: `${Math.max(1, width)}%` }}
                  onClick={() => props.onSelectLayer(layer.id)}
                  onPointerDown={(event) => onTrackPointerDown(event, layer)}
                  onPointerMove={onTrackPointerMove}
                  onPointerUp={endTrackDrag}
                  onPointerCancel={endTrackDrag}
                >
                  <span>
                    {layer.name ||
                      t(
                        layer.kind === "text"
                          ? "gif.layers.textName"
                          : layer.kind === "gif"
                            ? "gif.layers.gifName"
                            : "gif.layers.imageName",
                        { index: index + 1 },
                      )}
                  </span>
                  <i className="pm-gif-track-handle start" aria-hidden="true" />
                  <i className="pm-gif-track-handle end" aria-hidden="true" />
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
