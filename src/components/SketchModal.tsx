/** 草图画板弹层：白纸全幅编辑器，控件浮在纸面。受控展示组件；Esc 不关闭，
 *  有修改时关闭由接线层确认。
 *  副作用（随卸载清理）：ResizeObserver / 初始焦点 rAF / 指针捕获 /
 *  形状模式的 Shift 与 Esc 窗口监听 / 形状预览 rAF 合并 */
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
  ArrowRight,
  Check,
  Circle,
  Eraser,
  Loader2,
  Minus,
  Pencil,
  Redo2,
  Scan,
  Shapes,
  Square,
  Trash2,
  Type,
  Undo2,
  X,
} from "lucide-react";
import { sketchMeta } from "../i18n/labels";
import type {
  SketchCommand,
  SketchDocument,
  SketchFill,
  SketchOrigin,
  SketchPoint,
  SketchShape,
  SketchShapeKind,
  SketchStroke,
} from "../lib/types";
import {
  SHAPE_KINDS,
  SKETCH_MAX_COMMANDS,
  SKETCH_MAX_POINTS,
  SKETCH_PALETTE,
  clampToCanvas,
  constrainShapeEnd,
  eraserWidth,
  makeShape,
  makeStroke,
  penWidth,
  shapeFitsMinSize,
  toLogicalPoint,
  totalPoints,
} from "../lib/sketch";
import {
  drawSketchCommand,
  drawSketchShape,
  replaySketch,
  sketchHasInk,
} from "../lib/sketch-canvas";
import {
  FIT_SKETCH_VIEW,
  pinchSketchViewport,
  type SketchViewport,
} from "../lib/sketch-viewport";

type SketchTool = "pen" | "eraser" | "shape";

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
  const shapeBtnRef = useRef<HTMLButtonElement>(null);
  const customColorRef = useRef<HTMLInputElement>(null);
  const drawingRef = useRef<{
    pid: number;
    last: SketchPoint;
    cmd: SketchStroke;
  } | null>(null);
  /** 形状拖动：属性在按下时定稿，预览每帧从已提交命令重放后重绘 */
  const shapeRef = useRef<{
    pid: number;
    scale: number;
    raw: SketchPoint;
    cmd: SketchShape;
  } | null>(null);
  const shapeFrameRef = useRef(0);
  const ptsWarnedRef = useRef(false);
  const touchesRef = useRef(new Map<number, SketchPoint>());
  // 双指手势结束后，剩下的一指不接着画，直到全部抬起后重新落指。
  const navigatingRef = useRef(false);
  const pinchRef = useRef<{
    center: SketchPoint;
    distance: number;
    view: SketchViewport;
  } | null>(null);
  const [view, setView] = useState(FIT_SKETCH_VIEW);
  const viewRef = useRef(view);
  const [tool, setTool] = useState<SketchTool>("pen");
  const [shapeKind, setShapeKind] = useState<SketchShapeKind>("rect");
  const [shapeFill, setShapeFill] = useState<SketchFill>("none");
  const [shapePanel, setShapePanel] = useState(false);
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
      touchesRef.current.clear();
      pinchRef.current = null;
      navigatingRef.current = false;
      drawingRef.current = null;
      shapeRef.current = null;
      cancelAnimationFrame(shapeFrameRef.current);
      shapeFrameRef.current = 0;
      if (ghostRef.current) ghostRef.current.style.display = "none";
      viewRef.current = FIT_SKETCH_VIEW;
      setView(FIT_SKETCH_VIEW);
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

  // 缩放时提高栅格精度，长边最多 4096px，避免移动端创建过大的 Canvas。
  const density = box
    ? Math.min(box.dpr * view.scale, 4096 / Math.max(box.width, box.height))
    : 1;
  const rasterWidth = box ? Math.round(box.width * density) : 0;
  const rasterHeight = box ? Math.round(box.height * density) : 0;
  useLayoutEffect(() => {
    replayToCanvas();
  }, [box, rasterWidth, rasterHeight, replayToCanvas]);

  useEffect(() => {
    // hasInk 由栅格结果派生，仅在重放后同步
    setHasInk(sketchHasInk(doc, cursor));
  }, [doc, cursor]);

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
      const localScale = paper.offsetWidth / r.width;
      const d = eraserWidth(sizeT, doc) * 2 * (paper.offsetWidth / doc.width);
      ghost.style.display = "block";
      ghost.style.width = `${d}px`;
      ghost.style.height = `${d}px`;
      ghost.style.left = `${(clientX - r.left) * localScale - d / 2}px`;
      ghost.style.top = `${(clientY - r.top) * localScale - d / 2}px`;
    },
    [tool, sizeT, doc, props.confirming, hideGhost],
  );

  useEffect(() => {
    if (tool !== "eraser") hideGhost();
  }, [tool, hideGhost]);

  /* ── 形状预览：每帧从已提交命令重放再画当前形状，避免残影与重复叠加 ── */
  const paintShape = useCallback(() => {
    const cv = canvasRef.current;
    const ctx = cv?.getContext("2d");
    const d = shapeRef.current;
    if (!cv || !ctx || !d) return;
    const scale = cv.width / doc.width;
    replaySketch(ctx, doc, cursor, scale);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    drawSketchShape(ctx, d.cmd);
  }, [doc, cursor]);

  const scheduleShape = useCallback(() => {
    if (shapeFrameRef.current) return;
    shapeFrameRef.current = requestAnimationFrame(() => {
      shapeFrameRef.current = 0;
      paintShape();
    });
  }, [paintShape]);

  // 预览帧仅服务当前画板会话，卸载时取消尚未执行的帧。
  useEffect(() => () => cancelAnimationFrame(shapeFrameRef.current), []);

  const updateShape = useCallback(
    (raw: SketchPoint, shift: boolean) => {
      const s = shapeRef.current;
      if (!s) return;
      s.raw = raw;
      s.cmd = {
        ...s.cmd,
        to: constrainShapeEnd(s.cmd.shape, s.cmd.from, raw, { shift, doc }),
      };
      scheduleShape();
    },
    [doc, scheduleShape],
  );

  const dropShape = useCallback(() => {
    if (shapeFrameRef.current) {
      cancelAnimationFrame(shapeFrameRef.current);
      shapeFrameRef.current = 0;
    }
    if (!shapeRef.current) return;
    shapeRef.current = null;
    replayToCanvas(); // 丢弃未完成的形状，回到已提交画面
  }, [replayToCanvas]);

  const dropStroke = useCallback(() => {
    if (!drawingRef.current) return;
    drawingRef.current = null;
    replayToCanvas();
  }, [replayToCanvas]);

  /** 切换工具或执行其他画板操作前，先丢掉未完成的预览 */
  const dropLive = useCallback(() => {
    dropShape();
    dropStroke();
    hideGhost();
  }, [dropShape, dropStroke, hideGhost]);

  const cancelInteraction = useCallback(() => {
    touchesRef.current.clear();
    pinchRef.current = null;
    navigatingRef.current = false;
    dropLive();
  }, [dropLive]);

  // 所有工具的临时操作随失焦、页面隐藏取消；会话卸载时移除监听。
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) cancelInteraction();
    };
    window.addEventListener("blur", cancelInteraction);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("blur", cancelInteraction);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [cancelInteraction]);

  /* ── 形状模式的窗口监听：Shift 约束、Esc 取消、失焦丢弃；离开形状模式即解除 ── */
  useEffect(() => {
    if (tool !== "shape") return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Shift" && shapeRef.current)
        updateShape(shapeRef.current.raw, true);
      if (e.key === "Escape") {
        if (shapeRef.current) {
          dropShape();
          return;
        }
        if (shapePanel) {
          setShapePanel(false);
          shapeBtnRef.current?.focus();
        }
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Shift" && shapeRef.current)
        updateShape(shapeRef.current.raw, false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [tool, shapePanel, dropShape, updateShape]);

  const selectTool = (next: SketchTool) => {
    dropLive();
    setTool(next);
    if (next !== "shape") setShapePanel(false);
  };

  /** 选色：形状模式保持形状，其余沿用切回画笔的既有行为 */
  const selectPenTool = () => {
    if (tool !== "shape") selectTool("pen");
  };

  const onShapeDown = (e: React.PointerEvent, rect: DOMRect) => {
    setShapePanel(false);
    const from = clampToCanvas(
      toLogicalPoint(e.clientX, e.clientY, rect, doc),
      doc,
    );
    shapeRef.current = {
      pid: e.pointerId,
      scale: rect.width / doc.width,
      raw: from,
      // 本次预览与提交固定同一组属性，后续改设置不影响已开始的形状
      cmd: makeShape(
        shapeKind,
        shapeFill,
        colorHex,
        penWidth(sizeT, doc),
        from,
        from,
      ),
    };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (props.confirming || drawingRef.current || shapeRef.current) return;
    if (doc.commands.length >= SKETCH_MAX_COMMANDS) {
      props.onLimit("commands");
      return;
    }
    if (e.button !== 0 && e.pointerType === "mouse") return;
    e.preventDefault();
    const rect = paperRef.current?.getBoundingClientRect();
    if (!rect) return;
    if (tool === "shape") {
      onShapeDown(e, rect);
    } else {
      const cmd = makeStroke(
        tool,
        tool === "pen" ? colorHex : undefined,
        tool === "eraser" ? eraserWidth(sizeT, doc) : penWidth(sizeT, doc),
      );
      const pt = toLogicalPoint(e.clientX, e.clientY, rect, doc);
      cmd.points.push(pt);
      drawingRef.current = { pid: e.pointerId, last: pt, cmd };
      liveSeg(pt, null, cmd);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    moveGhost(e.clientX, e.clientY);
    const s = shapeRef.current;
    if (s) {
      if (e.pointerId !== s.pid) return;
      const rect = paperRef.current?.getBoundingClientRect();
      if (!rect) return;
      const raw = toLogicalPoint(e.clientX, e.clientY, rect, doc);
      updateShape(raw, e.shiftKey); // 指针携带实际修饰键状态，包括进入形状模式前按住的 Shift。
      return;
    }
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
    const s = shapeRef.current;
    if (s && e.pointerId === s.pid) {
      if (!discard) {
        const rect = paperRef.current?.getBoundingClientRect();
        if (rect) {
          s.scale = rect.width / doc.width;
          updateShape(
            toLogicalPoint(e.clientX, e.clientY, rect, doc),
            e.shiftKey,
          );
        }
      }
      if (
        !discard &&
        shapeFitsMinSize(s.cmd.shape, s.cmd.from, s.cmd.to, s.scale)
      )
        props.onStroke(s.cmd);
      dropShape(); // 尺寸不足或取消：不提交，恢复已提交画面
      return;
    }
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

  const touchPair = () => {
    const [a, b] = [...touchesRef.current.values()];
    if (!a || !b) return null;
    return {
      center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
    };
  };

  // 捕获在整个绘图区：第二指可以落在纸面外；浮动工具条不参与手势。
  const onZoneDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (props.confirming || (e.pointerType === "mouse" && e.button !== 0))
      return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* 合成事件或无活动指针时仍可普通跟踪。 */
    }
    if (e.pointerType === "touch") {
      touchesRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const pair = touchPair();
      if (pair) {
        dropLive();
        navigatingRef.current = true;
        pinchRef.current = { ...pair, view: viewRef.current };
      }
    }
    if (navigatingRef.current) return;
    if (e.target instanceof Node && paperRef.current?.contains(e.target))
      onPointerDown(e);
  };

  const onZoneMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (touchesRef.current.has(e.pointerId))
      touchesRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (navigatingRef.current) {
      const pair = touchPair();
      const start = pinchRef.current;
      const zone = zoneRef.current?.getBoundingClientRect();
      if (pair && start && box && zone) {
        const next = pinchSketchViewport(
          start.view,
          { x: start.center.x - zone.left, y: start.center.y - zone.top },
          { x: pair.center.x - zone.left, y: pair.center.y - zone.top },
          pair.distance / start.distance,
          box,
        );
        viewRef.current = next;
        setView(next);
      }
      return;
    }
    onPointerMove(e);
  };

  const onZoneEnd = (e: React.PointerEvent, discard: boolean) => {
    const wasNavigating = navigatingRef.current;
    touchesRef.current.delete(e.pointerId);
    const pair = touchPair();
    pinchRef.current = pair ? { ...pair, view: viewRef.current } : null;
    if (touchesRef.current.size === 0) navigatingRef.current = false;
    if (!wasNavigating) endDraw(e, discard);
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
          <div
            className="pm-sk-zone"
            ref={zoneRef}
            onPointerDown={onZoneDown}
            onPointerMove={onZoneMove}
            onPointerUp={(e) => onZoneEnd(e, false)}
            onPointerCancel={(e) => onZoneEnd(e, true)}
            onLostPointerCapture={(e) => onZoneEnd(e, true)}
          >
            {box && (
              <div
                className={`pm-sk-paper ${tool}`}
                ref={paperRef}
                style={{
                  left: box.left,
                  top: box.top,
                  width: box.width,
                  height: box.height,
                  transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
                }}
                onPointerLeave={hideGhost}
              >
                <canvas
                  ref={canvasRef}
                  width={rasterWidth}
                  height={rasterHeight}
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
            className="pm-sk-fit"
            aria-label={t("sketch.fit")}
            title={t("sketch.fit")}
            disabled={busy}
            onClick={() => {
              cancelInteraction();
              viewRef.current = FIT_SKETCH_VIEW;
              setView(FIT_SKETCH_VIEW);
            }}
          >
            <Scan size={17} />
            <span>
              {t("sketch.zoomPercent", {
                percent: Math.round(view.scale * 100),
              })}
            </span>
          </button>
          <p className="pm-sk-gesture-hint">{t("sketch.gestureHint")}</p>

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
              onClick={() => selectTool("pen")}
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
              ref={shapeBtnRef}
              className={"pm-sk-tool" + (tool === "shape" ? " on" : "")}
              aria-label={t("sketch.shape")}
              aria-pressed={tool === "shape"}
              aria-expanded={tool === "shape" && shapePanel}
              disabled={busy}
              onClick={() => {
                dropLive();
                if (tool === "shape") {
                  setShapePanel((open) => !open);
                  return;
                }
                setTool("shape");
                setShapePanel(true);
              }}
            >
              <Shapes size={19} />
            </button>
            <button
              type="button"
              className={"pm-sk-tool" + (tool === "eraser" ? " on" : "")}
              aria-label={t("sketch.eraser")}
              aria-pressed={tool === "eraser"}
              onClick={() => selectTool("eraser")}
            >
              <Eraser size={19} />
            </button>
          </div>

          {tool === "shape" && shapePanel && (
            <div
              className="pm-sk-shapes"
              role="group"
              aria-label={t("sketch.shapeOptions")}
            >
              <div className="pm-sk-shape-row" role="group">
                {SHAPE_KINDS.map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    className={
                      "pm-sk-shape-btn" + (shapeKind === kind ? " on" : "")
                    }
                    aria-label={t(`sketch.shapeKind.${kind}`)}
                    aria-pressed={shapeKind === kind}
                    disabled={busy}
                    onClick={() => {
                      dropLive();
                      setShapeKind(kind);
                    }}
                  >
                    {shapeIcon(kind)}
                  </button>
                ))}
              </div>
              {(shapeKind === "rect" || shapeKind === "ellipse") && (
                <div className="pm-sk-shape-row" role="group">
                  {(["none", "solid"] as const).map((fill) => (
                    <button
                      key={fill}
                      type="button"
                      className={
                        "pm-sk-shape-btn" + (shapeFill === fill ? " on" : "")
                      }
                      aria-label={t(`sketch.fill.${fill}`)}
                      aria-pressed={shapeFill === fill}
                      disabled={busy}
                      onClick={() => {
                        dropLive();
                        setShapeFill(fill);
                      }}
                    >
                      {shapeFillIcon(fill)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div
            className="pm-sk-hist"
            role="group"
            aria-label={t("sketch.history")}
          >
            <button
              type="button"
              aria-label={t("common.undo")}
              disabled={!canUndo || busy}
              onClick={() => {
                dropLive();
                props.onUndo();
              }}
            >
              <Undo2 size={19} />
            </button>
            <button
              type="button"
              aria-label={t("common.redo")}
              disabled={!canRedo || busy}
              onClick={() => {
                dropLive();
                props.onRedo();
              }}
            >
              <Redo2 size={19} />
            </button>
            <button
              type="button"
              aria-label={t("sketch.clear")}
              disabled={!hasInk || busy}
              onClick={() => {
                dropLive();
                props.onClear();
              }}
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
                  selectPenTool();
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
                    selectPenTool();
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
                  selectPenTool();
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
            onClick={() => {
              dropLive();
              props.onConfirm();
            }}
          >
            {busy ? <Loader2 size={21} /> : <Check size={21} />}
          </button>

          <p className="pm-sk-meta">{sketchMeta(doc, props.origin, t)}</p>
        </div>
      </div>
    </FocusScope>
  );
}

/** 形状种类图标：与面板按钮一一对应，图标本身随语言不变 */
function shapeIcon(kind: SketchShapeKind) {
  const size = 19;
  if (kind === "rect") return <Square size={size} />;
  if (kind === "ellipse") return <Circle size={size} />;
  if (kind === "line") return <Minus size={size + 2} />;
  return <ArrowRight size={size + 2} />;
}

/** 填充图标：空心描边、实心填充，用同一枚方块区分 */
function shapeFillIcon(fill: SketchFill) {
  return (
    <Square
      size={19}
      strokeWidth={1.5}
      fill={fill === "solid" ? "currentColor" : "none"}
    />
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
