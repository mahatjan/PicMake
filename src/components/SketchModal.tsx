/** 草图画板弹层：白纸全幅编辑器，控件浮在纸面。受控展示组件；Esc 不关闭，
 *  有修改时关闭由接线层确认。
 *  副作用（随卸载清理）：ResizeObserver / 初始焦点 rAF / 指针捕获 */
import { FocusScope } from "react-aria";
import { useTranslation } from "react-i18next";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import {
  Check,
  Eraser,
  Loader2,
  Pencil,
  Redo2,
  Shapes,
  Trash2,
  Type,
  Undo2,
  X,
} from "lucide-react";
import { sketchMeta } from "../i18n/labels";
import type {
  SketchCommand,
  SketchDocument,
  SketchOrigin,
  SketchPoint,
  SketchStroke,
} from "../lib/types";
import {
  SKETCH_MAX_COMMANDS,
  SKETCH_MAX_POINTS,
  SKETCH_PALETTE,
  eraserWidth,
  makeStroke,
  penWidth,
  toLogicalPoint,
  totalPoints,
} from "../lib/sketch";
import {
  drawSketchCommand,
  replaySketch,
  sketchHasInk,
} from "../lib/sketch-canvas";

interface PaperBox {
  left: number;
  top: number;
  width: number;
  height: number;
  dpr: number;
}

const SLIDER_TRACK = 168; // 滑杆可拖长度 = 184 - 上下 8px

/** 窄屏原生取色窗会贴底被裁切；iOS Safari 不弹出系统取色窗。这两种用画板内的取色板。 */
function wantsCustomColorPicker(): boolean {
  if (typeof window === "undefined") return false;
  const ua = navigator.userAgent;
  const ios =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return ios || window.matchMedia("(max-width: 700px)").matches;
}

export function SketchModal(props: {
  doc: SketchDocument;
  cursor: number;
  /** 打开的来源：决定右下角说明里除尺寸外的部分 */
  origin: SketchOrigin;
  confirming: boolean;
  onStroke: (command: SketchCommand) => void;
  onClear: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onConfirm: () => void;
  /** 关闭请求（是否有未确认修改由接线层判断并拦截） */
  onRequestClose: () => void;
  onLimit: (kind: "commands" | "points") => void;
}) {
  const { t } = useTranslation();
  const { doc, cursor } = props;
  const zoneRef = useRef<HTMLDivElement>(null);
  const paperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const penBtnRef = useRef<HTMLButtonElement>(null);
  const customColorRef = useRef<HTMLInputElement>(null);
  const drawingRef = useRef<{
    pid: number;
    last: SketchPoint;
    cmd: SketchStroke;
  } | null>(null);
  const ptsWarnedRef = useRef(false);
  const [tool, setTool] = useState<"pen" | "eraser">("pen");
  const [colorIdx, setColorIdx] = useState(0);
  const [colorHex, setColorHex] = useState<string>(SKETCH_PALETTE[0].hex);
  const [sizeT, setSizeT] = useState(0.35);
  const [box, setBox] = useState<PaperBox | null>(null);
  const [hasInk, setHasInk] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [useCustom, setUseCustom] = useState(wantsCustomColorPicker);
  const colorsRef = useRef<HTMLDivElement>(null);
  const [pickerBottom, setPickerBottom] = useState(128);

  /* ── 画布适配：contain 完整容纳，避开四周浮动控件，不裁切不拉伸 ── */
  useLayoutEffect(() => {
    const zone = zoneRef.current;
    if (!zone) return;
    const fit = () => {
      const zw = zone.clientWidth;
      const zh = zone.clientHeight;
      const narrow = zw < 720;
      const pl = narrow ? 56 : 88;
      const pr = narrow ? 36 : 64;
      const pt = 76;
      const pb = narrow ? 96 : 108;
      const aw = Math.max(60, zw - pl - pr);
      const ah = Math.max(60, zh - pt - pb);
      const r = doc.width / doc.height;
      let w = aw;
      let h = w / r;
      if (h > ah) {
        h = ah;
        w = h * r;
      }
      setBox({
        left: pl + (aw - w) / 2,
        top: pt + (ah - h) / 2,
        width: w,
        height: h,
        dpr: Math.min(window.devicePixelRatio || 1, 3),
      });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(zone);
    return () => ro.disconnect();
  }, [doc.width, doc.height]);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 700px)");
    const update = () => setUseCustom(wantsCustomColorPicker());
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  useLayoutEffect(() => {
    if (!useCustom) return;
    const el = colorsRef.current;
    const board = el?.offsetParent;
    if (!el || !(board instanceof HTMLElement)) return;
    const place = () => {
      setPickerBottom(board.clientHeight - el.offsetTop + 10);
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    ro.observe(board);
    return () => ro.disconnect();
  }, [useCustom, box, pickerOpen]);

  const replayToCanvas = useCallback(() => {
    const cv = canvasRef.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    replaySketch(ctx, doc, cursor, cv.width / doc.width);
  }, [doc, cursor]);

  useEffect(() => {
    replayToCanvas();
    // hasInk 由栅格结果派生，仅在重放后同步
    setHasInk(sketchHasInk(doc, cursor));
  }, [doc, cursor, box, replayToCanvas]);

  // FocusScope 负责限制与恢复焦点；进入时仍聚焦画笔。
  useEffect(() => {
    const frame = requestAnimationFrame(() => penBtnRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);

  /* ── 临时笔迹：只画进 Canvas，松手提交完整命令；预览与导出共用绘制规则 ── */
  const liveSeg = useCallback(
    (from: SketchPoint, to: SketchPoint | null, cmd: SketchStroke) => {
      const cv = canvasRef.current;
      const ctx = cv?.getContext("2d");
      if (!cv || !ctx) return;
      const scale = cv.width / doc.width;
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      drawSketchCommand(ctx, { ...cmd, points: to ? [from, to] : [from] }, doc);
    },
    [doc],
  );

  const hideGhost = useCallback(() => {
    if (ghostRef.current) ghostRef.current.style.display = "none";
  }, []);

  const moveGhost = useCallback(
    (clientX: number, clientY: number) => {
      const ghost = ghostRef.current;
      const paper = paperRef.current;
      if (!ghost || !paper || tool !== "eraser" || props.confirming) {
        hideGhost();
        return;
      }
      const r = paper.getBoundingClientRect();
      if (
        clientX < r.left ||
        clientX > r.right ||
        clientY < r.top ||
        clientY > r.bottom
      ) {
        hideGhost();
        return;
      }
      const d = eraserWidth(sizeT, doc) * 2 * (r.width / doc.width);
      ghost.style.display = "block";
      ghost.style.width = `${d}px`;
      ghost.style.height = `${d}px`;
      ghost.style.left = `${clientX - r.left - d / 2}px`;
      ghost.style.top = `${clientY - r.top - d / 2}px`;
    },
    [tool, sizeT, doc, props.confirming, hideGhost],
  );

  useEffect(() => {
    if (tool !== "eraser") hideGhost();
  }, [tool, hideGhost]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (props.confirming || drawingRef.current) return;
    if (doc.commands.length >= SKETCH_MAX_COMMANDS) {
      props.onLimit("commands");
      return;
    }
    e.preventDefault();
    const rect = paperRef.current?.getBoundingClientRect();
    if (!rect) return;
    const cmd = makeStroke(
      tool,
      tool === "pen" ? colorHex : undefined,
      tool === "eraser" ? eraserWidth(sizeT, doc) : penWidth(sizeT, doc),
    );
    const pt = toLogicalPoint(e.clientX, e.clientY, rect, doc);
    cmd.points.push(pt);
    drawingRef.current = { pid: e.pointerId, last: pt, cmd };
    try {
      paperRef.current?.setPointerCapture(e.pointerId);
    } catch {
      /* 无活动指针时降级为普通跟踪 */
    }
    liveSeg(pt, null, cmd);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    moveGhost(e.clientX, e.clientY);
    const d = drawingRef.current;
    if (!d || e.pointerId !== d.pid) return;
    const rect = paperRef.current?.getBoundingClientRect();
    if (!rect) return;
    const pt = toLogicalPoint(e.clientX, e.clientY, rect, doc);
    if (Math.hypot(pt.x - d.last.x, pt.y - d.last.y) < 0.8) return;
    if (totalPoints(doc, cursor) + d.cmd.points.length >= SKETCH_MAX_POINTS) {
      if (!ptsWarnedRef.current) {
        ptsWarnedRef.current = true;
        props.onLimit("points");
      }
      return;
    }
    liveSeg(d.last, pt, d.cmd);
    d.cmd.points.push(pt);
    d.last = pt;
  };

  const endDraw = (e: React.PointerEvent, discard: boolean) => {
    const d = drawingRef.current;
    if (!d || e.pointerId !== d.pid) return;
    drawingRef.current = null;
    hideGhost();
    if (discard) {
      replayToCanvas(); // 丢弃未完成的一笔，去掉残迹
      return;
    }
    props.onStroke(d.cmd);
  };

  /* ── 大小滑杆：上大下小 ── */
  const knobY = 8 + (1 - sizeT) * SLIDER_TRACK;
  const curWidth =
    tool === "eraser" ? eraserWidth(sizeT, doc) : penWidth(sizeT, doc);
  const dotD = box
    ? Math.min(46, Math.max(4, (curWidth * box.width) / doc.width))
    : 8;

  const canUndo = cursor > 0;
  const canRedo = cursor < doc.commands.length;
  const busy = props.confirming;

  return (
    <FocusScope contain restoreFocus>
      <div className="pm-sk-overlay">
        <div
          className="pm-sk-board"
          role="dialog"
          aria-modal="true"
          aria-label={t("sketch.board")}
        >
          <div className="pm-sk-zone" ref={zoneRef}>
            {box && (
              <div
                className={`pm-sk-paper ${tool}`}
                ref={paperRef}
                style={{
                  left: box.left,
                  top: box.top,
                  width: box.width,
                  height: box.height,
                }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={(e) => endDraw(e, false)}
                onPointerCancel={(e) => endDraw(e, true)}
                onLostPointerCapture={(e) => endDraw(e, true)}
                onPointerLeave={hideGhost}
              >
                <canvas
                  ref={canvasRef}
                  width={Math.round(box.width * box.dpr)}
                  height={Math.round(box.height * box.dpr)}
                  style={{ width: box.width, height: box.height }}
                />
                <p
                  className="pm-sk-hint"
                  style={{ opacity: hasInk ? 0 : 1 }}
                  aria-hidden={hasInk}
                >
                  {t("sketch.hint")}
                </p>
                <div
                  className="pm-sk-ghost"
                  ref={ghostRef}
                  style={{ display: "none" }}
                />
              </div>
            )}
          </div>

          <button
            type="button"
            className="pm-sk-close"
            aria-label={t("sketch.close")}
            disabled={busy}
            onClick={props.onRequestClose}
          >
            <X size={20} />
          </button>

          <div
            className="pm-sk-pill"
            role="toolbar"
            aria-label={t("sketch.tools")}
          >
            <button
              type="button"
              ref={penBtnRef}
              className={"pm-sk-tool pen" + (tool === "pen" ? " on" : "")}
              aria-label={t("sketch.pen")}
              aria-pressed={tool === "pen"}
              onClick={() => setTool("pen")}
            >
              <Pencil size={19} />
            </button>
            <button
              type="button"
              className="pm-sk-tool"
              aria-label={t("sketch.textDisabled")}
              title={t("sketch.textTitle")}
              disabled
            >
              <Type size={19} />
            </button>
            <button
              type="button"
              className="pm-sk-tool"
              aria-label={t("sketch.shapeDisabled")}
              title={t("sketch.shapeTitle")}
              disabled
            >
              <Shapes size={19} />
            </button>
            <button
              type="button"
              className={"pm-sk-tool" + (tool === "eraser" ? " on" : "")}
              aria-label={t("sketch.eraser")}
              aria-pressed={tool === "eraser"}
              onClick={() => setTool("eraser")}
            >
              <Eraser size={19} />
            </button>
          </div>

          <div
            className="pm-sk-hist"
            role="group"
            aria-label={t("sketch.history")}
          >
            <button
              type="button"
              aria-label={t("common.undo")}
              disabled={!canUndo || busy}
              onClick={props.onUndo}
            >
              <Undo2 size={19} />
            </button>
            <button
              type="button"
              aria-label={t("common.redo")}
              disabled={!canRedo || busy}
              onClick={props.onRedo}
            >
              <Redo2 size={19} />
            </button>
            <button
              type="button"
              aria-label={t("sketch.clear")}
              disabled={!hasInk || busy}
              onClick={props.onClear}
            >
              <Trash2 size={19} />
            </button>
          </div>

          <div className="pm-sk-sizer-wrap">
            <div className="pm-sk-sizer">
              <input
                className="pm-sk-size-input"
                type="range"
                aria-label={t("sketch.size")}
                min={0}
                max={1}
                step={0.01}
                value={sizeT}
                onChange={(e) => setSizeT(Number(e.target.value))}
              />
              <i className="pm-sk-sizer-track" />
              <i
                className="pm-sk-sizer-fill"
                style={{ top: knobY, height: SLIDER_TRACK + 8 - knobY }}
              />
              <i className="pm-sk-sizer-knob" style={{ top: knobY }} />
            </div>
            <i
              className="pm-sk-size-dot"
              style={{ width: dotD, height: dotD, top: knobY }}
              aria-hidden
            />
          </div>

          {useCustom && pickerOpen && (
            <SketchColorPad
              hex={colorHex}
              bottom={pickerBottom}
              onChange={(hex) => {
                setColorIdx(-1);
                setColorHex(hex);
              }}
            />
          )}
          <div
            ref={colorsRef}
            className="pm-sk-colors"
            role="group"
            aria-label={t("sketch.colors")}
          >
            {useCustom ? (
              <button
                type="button"
                className={
                  "pm-sk-sw rainbow" +
                  (colorIdx === -1 || pickerOpen ? " on" : "")
                }
                aria-label={t("sketch.customColor")}
                aria-pressed={colorIdx === -1 || pickerOpen}
                onClick={() => {
                  setTool("pen");
                  setPickerOpen((open) => !open);
                }}
              />
            ) : (
              <span className="pm-sk-custom">
                {/* 盖住彩虹按钮，取色窗从这颗按钮旁弹出。display:none 会弹到视口左上角。 */}
                <input
                  ref={customColorRef}
                  type="color"
                  className="pm-sk-custom-input"
                  tabIndex={-1}
                  aria-hidden="true"
                  onChange={(e) => {
                    setColorIdx(-1);
                    setColorHex(e.target.value);
                  }}
                />
                <button
                  type="button"
                  className="pm-sk-sw rainbow"
                  aria-label={t("sketch.customColor")}
                  aria-pressed={colorIdx === -1}
                  onClick={() => {
                    setTool("pen");
                    customColorRef.current?.click();
                  }}
                />
              </span>
            )}
            {SKETCH_PALETTE.map((c, i) => (
              <button
                key={c.hex}
                type="button"
                className={"pm-sk-sw" + (colorIdx === i ? " on" : "")}
                style={{ background: c.hex }}
                title={t(`sketch.colorName.${c.id}`)}
                aria-label={t("sketch.color", {
                  name: t(`sketch.colorName.${c.id}`),
                })}
                aria-pressed={colorIdx === i}
                onClick={() => {
                  setTool("pen");
                  setPickerOpen(false);
                  setColorIdx(i);
                  setColorHex(c.hex);
                }}
              />
            ))}
          </div>

          <button
            type="button"
            className={
              "pm-sk-use" +
              (hasInk && !busy ? " ready" : "") +
              (busy ? " busy" : "")
            }
            aria-label={busy ? t("sketch.preparing") : t("sketch.use")}
            title={busy ? t("sketch.preparingTitle") : t("sketch.use")}
            disabled={!hasInk || busy}
            onClick={props.onConfirm}
          >
            {busy ? <Loader2 size={21} /> : <Check size={21} />}
          </button>

          <p className="pm-sk-meta">{sketchMeta(doc, props.origin, t)}</p>
        </div>
      </div>
    </FocusScope>
  );
}

function SketchColorPad(props: {
  hex: string;
  bottom: number;
  onChange: (hex: string) => void;
}) {
  const { t } = useTranslation();
  const [hsv, setHsv] = useState(() => hexToHsv(props.hex));
  const apply = (h: number, s: number, v: number) => {
    setHsv({ h, s, v });
    props.onChange(hsvToHex(h, s, v));
  };
  const pick = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const s = clamp01((event.clientX - rect.left) / rect.width);
    const v = clamp01(1 - (event.clientY - rect.top) / rect.height);
    apply(hsv.h, s, v);
  };
  return (
    <div
      className="pm-sk-picker"
      style={{ bottom: props.bottom }}
      role="group"
      aria-label={t("sketch.customColor")}
    >
      <div
        className="pm-sk-sv"
        role="group"
        aria-label={t("sketch.shade")}
        style={{ backgroundColor: `hsl(${hsv.h} 100% 50%)` }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          pick(event);
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            pick(event);
        }}
      >
        <i style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }} />
      </div>
      <input
        className="pm-sk-hue"
        type="range"
        min={0}
        max={360}
        step={1}
        value={Math.round(hsv.h)}
        aria-label={t("sketch.hue")}
        onChange={(event) => apply(Number(event.target.value), hsv.s, hsv.v)}
      />
    </div>
  );
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function hexToHsv(hex: string): { h: number; s: number; v: number } {
  const raw = hex.replace("#", "");
  const full =
    raw.length === 3
      ? raw
          .split("")
          .map((c) => c + c)
          .join("")
      : raw.slice(0, 6);
  const n = Number.parseInt(full, 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

function hsvToHex(h: number, s: number, v: number): string {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let rp = 0;
  let gp = 0;
  let bp = 0;
  if (h < 60) [rp, gp, bp] = [c, x, 0];
  else if (h < 120) [rp, gp, bp] = [x, c, 0];
  else if (h < 180) [rp, gp, bp] = [0, c, x];
  else if (h < 240) [rp, gp, bp] = [0, x, c];
  else if (h < 300) [rp, gp, bp] = [x, 0, c];
  else [rp, gp, bp] = [c, 0, x];
  const byte = (n: number) =>
    Math.round((n + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${byte(rp)}${byte(gp)}${byte(bp)}`;
}
