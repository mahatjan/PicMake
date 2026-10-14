/** 局部重绘选区编辑器：画笔/擦除/粗细、撤销重做清空、隐藏选区、缩放平移。受控展示组件，
 *  坐标以底图像素为单位，缩放不改笔宽；Esc 不关闭，有修改时关闭由接线层确认。
 *  副作用（随卸载清理）：ResizeObserver / 初始焦点 rAF / 指针捕获 */
import { FocusScope } from "react-aria";
import { useTranslation } from "react-i18next";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  Brush,
  Check,
  Eraser,
  Eye,
  EyeOff,
  Hand,
  Loader2,
  Maximize,
  Minus,
  Plus,
  Redo2,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { inpaintIssueText, inputName } from "../i18n/labels";
import {
  type InpaintIssue,
  type MaskCommand,
  type MaskDocument,
  type MaskStroke,
  type SketchPoint,
} from "../lib/types";
import type { InputNaming } from "../lib/view-models";
import {
  SKETCH_MAX_COMMANDS,
  SKETCH_MAX_POINTS,
  totalPoints as totalMaskPoints,
} from "../lib/sketch";
import { maskBrushRange } from "../lib/inpaint";
import {
  maskHasSelectionQuick,
  overlayFill,
  paintOverlayLayer,
} from "../lib/inpaint-canvas";

interface BoardBox {
  fitW: number;
  fitH: number;
  dpr: number;
  left: number;
  top: number;
}

export function InpaintModal(props: {
  baseUrl: string;
  /** 被涂选底图的名字种类（标题与 alt） */
  naming: InputNaming;
  baseW: number;
  baseH: number;
  /** 归一化发生时的提示 */
  normalized: boolean;
  doc: MaskDocument;
  cursor: number;
  confirming: boolean;
  error: InpaintIssue | null;
  onStroke: (command: MaskCommand) => void;
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
  const stageRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const botRef = useRef<HTMLDivElement>(null);
  const covRef = useRef<HTMLCanvasElement>(null);
  const cursorRingRef = useRef<HTMLDivElement>(null);
  const penBtnRef = useRef<HTMLButtonElement>(null);
  const drawingRef = useRef<{
    pid: number;
    cmd: MaskStroke;
    last: SketchPoint;
  } | null>(null);
  const panningRef = useRef<{ pid: number; x: number; y: number } | null>(null);
  const ptsWarnedRef = useRef(false);
  const [tool, setTool] = useState<"pen" | "eraser" | "pan">("pen");
  const [brush, setBrush] = useState(
    () => maskBrushRange(doc.width, doc.height).initial,
  );
  const [overlayHidden, setOverlayHidden] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [box, setBox] = useState<BoardBox | null>(null);
  const [hasSelection, setHasSelection] = useState(false);

  const brushRange = maskBrushRange(doc.width, doc.height);
  const name = inputName(props.naming, t);

  /* ── 布局：contain 容纳底图记为 1×；resize 只复位视图，不丢选区 ── */
  const fit = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const sw = stage.clientWidth;
    const sh = stage.clientHeight;
    const narrow = sw < 760;
    const pad = narrow ? 28 : 56;
    // 上下浮动条在窄屏会折行，高度不定：按实测值留白，底图不会被压住
    const gap = 8;
    const topEdge = 14 + (topRef.current?.offsetHeight ?? 40) + gap;
    const botEdge = sh - 14 - (botRef.current?.offsetHeight ?? 40) - gap;
    const aw = Math.max(80, sw - pad * 2);
    const ah = Math.max(80, botEdge - topEdge);
    const r = doc.width / doc.height;
    let w = aw;
    let h = w / r;
    if (h > ah) {
      h = ah;
      w = h * r;
    }
    const left = pad + (aw - w) / 2;
    const top = topEdge + (ah - h) / 2;
    setBox({
      fitW: w,
      fitH: h,
      dpr: Math.min(window.devicePixelRatio || 1, 2),
      left,
      top,
    });
    setZoom(1);
    setPan({ x: left, y: top });
  }, [doc.width, doc.height]);

  useLayoutEffect(() => {
    fit();
    const ro = new ResizeObserver(fit);
    if (stageRef.current) ro.observe(stageRef.current);
    // 浮动条折行数变化也会改变可用高度，跟着它们一起重排
    if (botRef.current) ro.observe(botRef.current);
    if (topRef.current) ro.observe(topRef.current);
    return () => ro.disconnect();
  }, [fit]);

  /* ── 显示层全量重绘：显示与判空/导出共用同一笔触轮廓 ── */
  const renderDisplay = useCallback(
    (live: MaskStroke | null) => {
      const cov = covRef.current;
      const ctx = cov?.getContext("2d");
      if (!cov || !ctx || !box) return;
      paintOverlayLayer(
        ctx,
        doc,
        cursor,
        live,
        cov.width / doc.width,
        overlayFill(),
      );
    },
    [doc, cursor, box],
  );

  useEffect(() => {
    renderDisplay(null);
    setHasSelection(maskHasSelectionQuick(doc, cursor));
  }, [doc, cursor, box, renderDisplay]);

  // FocusScope 负责限制与恢复焦点；进入时仍聚焦画笔。
  useEffect(() => {
    const frame = requestAnimationFrame(() => penBtnRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);

  /* ── 缩放/平移：围绕视口中心，1×–8×；钳制保证画布至少 48px 留在可视区 ── */
  const clampPan = useCallback(
    (next: { x: number; y: number }, z: number, b: BoardBox) => {
      const stage = stageRef.current!;
      const w = b.fitW * z;
      const h = b.fitH * z;
      const margin = 48;
      const clamp = (pos: number, size: number, view: number) =>
        Math.min(view - margin, Math.max(margin - size, pos));
      return {
        x: clamp(next.x, w, stage.clientWidth),
        y: clamp(next.y, h, stage.clientHeight),
      };
    },
    [],
  );

  const applyZoom = useCallback(
    (step: number) => {
      setZoom((z) => {
        const nz = Math.min(8, Math.max(1, Math.round((z + step) * 4) / 4));
        if (nz === z || !box || !stageRef.current) return z;
        const stage = stageRef.current.getBoundingClientRect();
        const frame = frameRef.current?.getBoundingClientRect();
        if (!frame) return z;
        const cx = stage.left + stage.width / 2;
        const cy = stage.top + stage.height / 2;
        const ix = (cx - frame.left) / frame.width;
        const iy = (cy - frame.top) / frame.height;
        setPan(() => {
          const raw = {
            x: cx - stage.left - ix * box.fitW * nz,
            y: cy - stage.top - iy * box.fitH * nz,
          };
          return clampPan(raw, nz, box);
        });
        return nz;
      });
    },
    [box, clampPan],
  );

  const fitView = useCallback(() => {
    setZoom(1);
    if (box) setPan({ x: box.left, y: box.top });
  }, [box]);

  /* ── 指针：一笔一命令；pan 工具拖画布；图片留白不接受画笔 ── */
  const toDocPoint = (clientX: number, clientY: number): SketchPoint | null => {
    const frame = frameRef.current?.getBoundingClientRect();
    if (!frame) return null;
    const x = ((clientX - frame.left) / frame.width) * doc.width;
    const y = ((clientY - frame.top) / frame.height) * doc.height;
    // 图片外留白不创建笔触：越界（±2px 容差）直接放弃本次事件
    if (x < -2 || y < -2 || x > doc.width + 2 || y > doc.height + 2)
      return null;
    return {
      x: Math.min(doc.width, Math.max(0, x)),
      y: Math.min(doc.height, Math.max(0, y)),
    };
  };

  /** rAF 节流的全量重绘调度：拖动期间每帧重画已提交 + 当前笔触 */
  const rafRef = useRef(0);
  const scheduleRender = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      renderDisplay(drawingRef.current?.cmd ?? null);
    });
  }, [renderDisplay]);
  useEffect(
    () => () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  const moveCursorRing = useCallback(
    (clientX: number, clientY: number) => {
      const ring = cursorRingRef.current;
      const frame = frameRef.current?.getBoundingClientRect();
      const stage = stageRef.current?.getBoundingClientRect();
      if (!ring || !frame || !stage || tool === "pan" || overlayHidden) {
        if (ring) ring.style.display = "none";
        return;
      }
      if (
        clientX < frame.left ||
        clientX > frame.right ||
        clientY < frame.top ||
        clientY > frame.bottom
      ) {
        ring.style.display = "none";
        return;
      }
      const d = brush * (frame.width / doc.width);
      ring.style.display = "block";
      ring.style.width = `${d}px`;
      ring.style.height = `${d}px`;
      ring.style.left = `${clientX - stage.left - d / 2}px`;
      ring.style.top = `${clientY - stage.top - d / 2}px`;
    },
    [tool, overlayHidden, brush, doc.width],
  );

  const onPointerDown = (e: React.PointerEvent) => {
    if (props.confirming) return;
    if (drawingRef.current || panningRef.current) {
      // 多指：终止未完成笔触，不触发新手势
      if (drawingRef.current) {
        drawingRef.current = null;
        renderDisplay(null);
      }
      return;
    }
    if (e.button !== 0 && e.pointerType === "mouse") return;
    if (tool === "pan") {
      panningRef.current = { pid: e.pointerId, x: e.clientX, y: e.clientY };
      try {
        stageRef.current?.setPointerCapture(e.pointerId);
      } catch {
        /* 无活动指针时降级为普通跟踪 */
      }
      return;
    }
    if (overlayHidden) return; // 隐藏选区时禁止涂画
    if (doc.commands.length >= SKETCH_MAX_COMMANDS) {
      props.onLimit("commands");
      return;
    }
    const pt = toDocPoint(e.clientX, e.clientY);
    if (!pt) return;
    const cmd: MaskStroke = {
      type: "stroke",
      tool: tool === "eraser" ? "eraser" : "pen",
      width: brush,
      points: [pt],
    };
    drawingRef.current = { pid: e.pointerId, cmd, last: pt };
    try {
      stageRef.current?.setPointerCapture(e.pointerId);
    } catch {
      /* 无活动指针时降级为普通跟踪 */
    }
    renderDisplay(cmd);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    moveCursorRing(e.clientX, e.clientY);
    const pan0 = panningRef.current;
    if (pan0) {
      if (e.pointerId !== pan0.pid) return;
      setPan((p) => {
        const raw = {
          x: p.x + e.clientX - pan0.x,
          y: p.y + e.clientY - pan0.y,
        };
        return box ? clampPan(raw, zoom, box) : raw;
      });
      panningRef.current = { ...pan0, x: e.clientX, y: e.clientY };
      return;
    }
    const d = drawingRef.current;
    if (!d || e.pointerId !== d.pid) return;
    const pt = toDocPoint(e.clientX, e.clientY);
    if (!pt) return;
    // perfect-freehand 的 streamline 负责抖动平滑；此处只做极小距离去重
    if (Math.hypot(pt.x - d.last.x, pt.y - d.last.y) < 0.8) return;
    if (
      totalMaskPoints(doc, cursor) + d.cmd.points.length >=
      SKETCH_MAX_POINTS
    ) {
      if (!ptsWarnedRef.current) {
        ptsWarnedRef.current = true;
        props.onLimit("points");
      }
      return;
    }
    d.cmd.points.push(pt);
    d.last = pt;
    scheduleRender();
  };

  const endDraw = (e: React.PointerEvent, discard: boolean) => {
    const pan0 = panningRef.current;
    if (pan0 && e.pointerId === pan0.pid) {
      panningRef.current = null;
      return;
    }
    const d = drawingRef.current;
    if (!d || e.pointerId !== d.pid) return;
    drawingRef.current = null;
    if (discard) {
      renderDisplay(null); // 指针中断：丢弃未完成的一笔
      return;
    }
    props.onStroke(d.cmd);
  };

  const canUndo = cursor > 0;
  const canRedo = cursor < doc.commands.length;
  const busy = props.confirming;

  const frameStyle = box
    ? {
        left: pan.x,
        top: pan.y,
        width: box.fitW * zoom,
        height: box.fitH * zoom,
      }
    : undefined;

  return (
    <FocusScope contain restoreFocus>
      <div className="pm-ip-overlay">
        <div
          className="pm-ip-board"
          role="dialog"
          aria-modal="true"
          aria-label={t("inpaint.board")}
        >
          <div
            className={"pm-ip-stage" + (tool === "pan" ? " panning" : "")}
            ref={stageRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={(e) => endDraw(e, false)}
            onPointerCancel={(e) => endDraw(e, true)}
            onLostPointerCapture={(e) => endDraw(e, true)}
          >
            {box && frameStyle && (
              <div className="pm-ip-frame" ref={frameRef} style={frameStyle}>
                <img
                  src={props.baseUrl}
                  alt={name}
                  draggable={false}
                  onLoad={() => renderDisplay(null)}
                />
                <canvas
                  ref={covRef}
                  className={"pm-ip-cov" + (overlayHidden ? " hidden" : "")}
                  width={Math.round(box.fitW * box.dpr)}
                  height={Math.round(box.fitH * box.dpr)}
                  aria-hidden
                />
              </div>
            )}
            <div
              className="pm-ip-ring"
              ref={cursorRingRef}
              style={{ display: "none" }}
            />
          </div>

          <div className="pm-ip-topbar" ref={topRef}>
            <button
              type="button"
              className="pm-ip-close"
              aria-label={t("inpaint.close")}
              disabled={busy}
              onClick={props.onRequestClose}
            >
              <X size={18} />
            </button>

            <div className="pm-ip-title">
              <b>{t("inpaint.board")}</b>
              <span className="name">{name}</span>
              <span className="dims">
                {props.baseW} × {props.baseH} px
              </span>
              {props.normalized && (
                <span className="norm">{t("inpaint.normalized")}</span>
              )}
            </div>

            <div
              className="pm-ip-hist"
              role="group"
              aria-label={t("inpaint.history")}
            >
              <button
                type="button"
                aria-label={t("common.undo")}
                disabled={!canUndo || busy}
                onClick={props.onUndo}
              >
                <Undo2 size={16} />
              </button>
              <button
                type="button"
                aria-label={t("common.redo")}
                disabled={!canRedo || busy}
                onClick={props.onRedo}
              >
                <Redo2 size={16} />
              </button>
              <button
                type="button"
                aria-label={t("inpaint.clearSelection")}
                disabled={!hasSelection || busy}
                onClick={props.onClear}
              >
                <Trash2 size={16} />
              </button>
              <span className="vr" />
              <button
                type="button"
                aria-pressed={overlayHidden}
                disabled={busy}
                title={
                  overlayHidden ? t("inpaint.show") : t("inpaint.hideTitle")
                }
                onClick={() => setOverlayHidden((v) => !v)}
              >
                {overlayHidden ? <EyeOff size={16} /> : <Eye size={16} />}
                {overlayHidden ? t("inpaint.show") : t("inpaint.hide")}
              </button>
            </div>
          </div>

          {props.error && (
            <p className="pm-ip-error" role="alert">
              {inpaintIssueText(props.error, t)}
            </p>
          )}
          {!props.error && !hasSelection && !busy && (
            <p className="pm-ip-hint">{t("inpaint.hint")}</p>
          )}

          <div className="pm-ip-botbar" ref={botRef}>
            <div
              className="pm-ip-zoombar"
              role="group"
              aria-label={t("inpaint.zoomGroup")}
            >
              <button
                type="button"
                aria-label={t("inpaint.zoomOut")}
                disabled={zoom <= 1 || busy}
                onClick={() => applyZoom(-0.25)}
              >
                <Minus size={14} />
              </button>
              <b>{Math.round(zoom * 100)}%</b>
              <button
                type="button"
                aria-label={t("inpaint.zoomIn")}
                disabled={zoom >= 8 || busy}
                onClick={() => applyZoom(0.25)}
              >
                <Plus size={14} />
              </button>
              <button type="button" onClick={fitView} disabled={busy}>
                <Maximize size={14} />
                {t("inpaint.fit")}
              </button>
              <button
                type="button"
                className={tool === "pan" ? "on" : ""}
                aria-pressed={tool === "pan"}
                title={t("inpaint.panTitle")}
                onClick={() => setTool((t) => (t === "pan" ? "pen" : "pan"))}
              >
                <Hand size={14} />
                {t("inpaint.pan")}
              </button>
            </div>

            <div
              className="pm-ip-tools"
              role="toolbar"
              aria-label={t("inpaint.tools")}
            >
              <button
                type="button"
                ref={penBtnRef}
                className={tool === "pen" ? "on" : ""}
                aria-label={t("inpaint.brush")}
                aria-pressed={tool === "pen"}
                title={t("inpaint.brushTitle")}
                disabled={busy}
                onClick={() => setTool("pen")}
              >
                <Brush size={15} />
                {t("inpaint.brush")}
              </button>
              <button
                type="button"
                className={tool === "eraser" ? "on" : ""}
                aria-label={t("inpaint.erase")}
                aria-pressed={tool === "eraser"}
                title={t("inpaint.eraseTitle")}
                disabled={busy}
                onClick={() => setTool("eraser")}
              >
                <Eraser size={15} />
                {t("inpaint.erase")}
              </button>
              <span className="vr" />
              <label className="pm-ip-size">
                {t("inpaint.size")}
                <input
                  type="range"
                  aria-label={t("inpaint.sizeRange")}
                  min={brushRange.min}
                  max={brushRange.max}
                  step={1}
                  value={brush}
                  onChange={(e) => setBrush(Number(e.target.value))}
                />
                <input
                  type="number"
                  aria-label={t("inpaint.sizeNumber")}
                  min={brushRange.min}
                  max={brushRange.max}
                  step={1}
                  value={brush}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (Number.isFinite(n))
                      setBrush(
                        Math.min(
                          brushRange.max,
                          Math.max(brushRange.min, Math.round(n)),
                        ),
                      );
                  }}
                />
                px
              </label>
            </div>

            <button
              type="button"
              className={"pm-ip-use" + (hasSelection && !busy ? " ready" : "")}
              disabled={!hasSelection || busy}
              onClick={props.onConfirm}
            >
              {busy ? <Loader2 size={16} /> : <Check size={16} />}
              {busy ? t("inpaint.busy") : t("inpaint.use")}
            </button>
          </div>
        </div>
      </div>
    </FocusScope>
  );
}
