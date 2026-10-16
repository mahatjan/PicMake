/** 草图纯规则：坐标换算、命令提交、撤销游标、形状几何、文档校验；Canvas 见 sketch-canvas.ts */
import type {
  SketchCommand,
  SketchDocument,
  SketchFill,
  SketchPoint,
  SketchShape,
  SketchShapeKind,
  SketchStroke,
  SketchText,
  SketchTextTransform,
} from "./types";

/** 固定色板（id 对应 i18n 资源 sketch.colors.*，用于无障碍名称；hex 为实际绘画颜色，不随主题） */
export const SKETCH_PALETTE = [
  { id: "black", hex: "#1A1A1A" },
  { id: "gray", hex: "#6B7280" },
  { id: "brown", hex: "#7C4A1E" },
  { id: "red", hex: "#E53935" },
  { id: "orange", hex: "#F4772E" },
  { id: "amber", hex: "#F5A623" },
  { id: "green", hex: "#2E9E4F" },
  { id: "teal", hex: "#1B8A7A" },
  { id: "sky", hex: "#26A9E0" },
  { id: "blue", hex: "#2E6FE8" },
  { id: "indigo", hex: "#4F46E5" },
  { id: "purple", hex: "#8B2FD6" },
  { id: "magenta", hex: "#D6247A" },
] as const;

export type SketchColorId = (typeof SKETCH_PALETTE)[number]["id"];

/** 内存保护阈值（建议值） */
export const SKETCH_MAX_COMMANDS = 2000;
export const SKETCH_MAX_POINTS = 100000;
export const SKETCH_TEXT_MAX_CHARS = 200;
/** 输出为 auto 时的新画布尺寸 */
export const SKETCH_DEFAULT_SIZE = 1024;

export function blankSketch(width: number, height: number): SketchDocument {
  return { version: 1, width, height, commands: [] };
}

/** 容器 CSS 像素 → 逻辑画布像素（显示缩放不改变文档坐标） */
export function toLogicalPoint(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  doc: Pick<SketchDocument, "width" | "height">,
): SketchPoint {
  return {
    x: ((clientX - rect.left) * doc.width) / rect.width,
    y: ((clientY - rect.top) * doc.height) / rect.height,
  };
}

/** 画笔/橡皮粗细：滑杆位置 t∈[0,1]（上大下小），基准为逻辑画布短边 */
export function penWidth(
  t: number,
  doc: Pick<SketchDocument, "width" | "height">,
): number {
  return Math.max(1.5, (0.0025 + 0.028 * t) * Math.min(doc.width, doc.height));
}

export function eraserWidth(
  t: number,
  doc: Pick<SketchDocument, "width" | "height">,
): number {
  return Math.max(5, (0.02 + 0.055 * t) * Math.min(doc.width, doc.height));
}

export function makeStroke(
  tool: "pen" | "eraser",
  color: string | undefined,
  width: number,
): SketchStroke {
  return tool === "pen"
    ? { type: "stroke", tool, color, width, points: [] }
    : { type: "stroke", tool, width, points: [] };
}

/** 字号同样随画布短边缩放，最小 12 逻辑像素。 */
export function textSize(
  t: number,
  doc: Pick<SketchDocument, "width" | "height">,
): number {
  return Math.max(12, (0.015 + 0.065 * t) * Math.min(doc.width, doc.height));
}

/** 输入与提交、读取共用规则：仅接受有可见内容的单行文字。 */
export function isValidSketchText(value: unknown): value is SketchText {
  if (!value || typeof value !== "object") return false;
  const c = value as SketchText;
  return (
    c.type === "text" &&
    typeof c.content === "string" &&
    c.content.trim().length > 0 &&
    c.content.length <= SKETCH_TEXT_MAX_CHARS &&
    !/[\r\n\u2028\u2029]/u.test(c.content) &&
    typeof c.color === "string" &&
    !!c.color &&
    Number.isFinite(c.fontSize) &&
    c.fontSize > 0 &&
    finitePoint(c)
  );
}

/** 调整只能引用当前前缀中、最后一次清空之后的原始文字。 */
export function isValidTextTransform(
  cmd: SketchTextTransform,
  commands: readonly SketchCommand[],
  cursor: number,
): boolean {
  return (
    Number.isInteger(cmd.target) &&
    cmd.target >= 0 &&
    cmd.target < cursor &&
    commands[cmd.target]?.type === "text" &&
    !commands.slice(cmd.target + 1, cursor).some((c) => c.type === "clear") &&
    finitePoint(cmd) &&
    Number.isFinite(cmd.fontSize) &&
    cmd.fontSize > 0
  );
}

/** 先求出文字的最终位置再按原顺序绘制，保留文字与笔画、橡皮的层次。 */
export function resolveSketchCommands(
  doc: Pick<SketchDocument, "commands">,
  cursor = doc.commands.length,
  preview?: SketchTextTransform | null,
): SketchCommand[] {
  const result = doc.commands.slice(0, cursor);
  const apply = (cmd: SketchTextTransform) => {
    const original = result[cmd.target];
    if (original?.type === "text")
      result[cmd.target] = {
        ...original,
        x: cmd.x,
        y: cmd.y,
        fontSize: cmd.fontSize,
      };
  };
  for (const cmd of result) if (cmd.type === "text-transform") apply(cmd);
  if (preview) apply(preview);
  return result;
}

/** 指针移动以逻辑坐标计算；缩放固定基线锚点，沿手柄初始方向投影。 */
export function transformSketchText(
  text: SketchText,
  target: number,
  mode: "move" | "resize",
  from: SketchPoint,
  to: SketchPoint,
  doc: Pick<SketchDocument, "width" | "height">,
): SketchTextTransform {
  const point =
    mode === "move"
      ? clampToCanvas(
          {
            x: text.x + to.x - from.x,
            y: text.y + to.y - from.y,
          },
          doc,
        )
      : text;
  const vx = from.x - text.x,
    vy = from.y - text.y;
  const length = vx * vx + vy * vy;
  const ratio =
    length > 0 ? ((to.x - text.x) * vx + (to.y - text.y) * vy) / length : 1;
  return {
    type: "text-transform",
    target,
    x: point.x,
    y: point.y,
    fontSize:
      mode === "resize"
        ? resizeSketchText(text.fontSize, ratio, doc)
        : text.fontSize,
  };
}

export function resizeSketchText(
  fontSize: number,
  ratio: number,
  doc: Pick<SketchDocument, "width" | "height">,
): number {
  return Math.max(
    12,
    Math.min(Math.max(12, Math.min(doc.width, doc.height)), fontSize * ratio),
  );
}

/* ── 形状：几何规则 ── */

export const SHAPE_KINDS = ["rect", "ellipse", "line", "arrow"] as const;
/** 直线与箭头不支持填充 */
export const SHAPE_FILLS = ["none", "solid"] as const;
/** 形状最小尺寸，单位为显示像素（换算到逻辑坐标需除以显示缩放） */
export const SKETCH_SHAPE_MIN_DISPLAY = 4;
/** Shift 吸附的最小角度步长：45° */
const SHAPE_ANGLE_STEP = Math.PI / 4;
/** 箭头三角形边长随线宽增长的系数与绝对下限（逻辑像素） */
const ARROW_HEAD_RATIO = 3.4;
const ARROW_HEAD_MIN = 6;
/** 箭头长度占比上限：短箭头不因箭头变形失真 */
const ARROW_HEAD_MAX_RATIO = 0.4;

export function isShapeKind(v: unknown): v is SketchShapeKind {
  return SHAPE_KINDS.includes(v as SketchShapeKind);
}

function isShapeFill(v: unknown): v is SketchFill {
  return SHAPE_FILLS.includes(v as SketchFill);
}

function finitePoint(p: unknown): p is SketchPoint {
  const pt = p as SketchPoint | null;
  return (
    !!pt &&
    typeof pt === "object" &&
    Number.isFinite(pt.x) &&
    Number.isFinite(pt.y)
  );
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** 起点归到画布内：形状几何不得越出纸面 */
export function clampToCanvas(
  p: SketchPoint,
  doc: Pick<SketchDocument, "width" | "height">,
): SketchPoint {
  return { x: clamp(p.x, 0, doc.width), y: clamp(p.y, 0, doc.height) };
}

/** 包围盒：任意方向拖动都归一为 [left, top, right, bottom] */
export function normalizeBox(
  a: SketchPoint,
  b: SketchPoint,
): { left: number; top: number; right: number; bottom: number } {
  return {
    left: Math.min(a.x, b.x),
    top: Math.min(a.y, b.y),
    right: Math.max(a.x, b.x),
    bottom: Math.max(a.y, b.y),
  };
}

/** 从 from 沿单位向量前进到画布边界的距离；方向完全朝外时返回 ≤0 */
function rayToEdge(
  from: SketchPoint,
  ux: number,
  uy: number,
  doc: Pick<SketchDocument, "width" | "height">,
): number {
  let t = Infinity;
  if (ux > 1e-9) t = Math.min(t, (doc.width - from.x) / ux);
  else if (ux < -1e-9) t = Math.min(t, -from.x / ux);
  if (uy > 1e-9) t = Math.min(t, (doc.height - from.y) / uy);
  else if (uy < -1e-9) t = Math.min(t, -from.y / uy);
  return t;
}

/** 拖动终点规范化：Shift 约束与画布边界同时生效，保持比例或角度 */
export function constrainShapeEnd(
  kind: SketchShapeKind,
  from: SketchPoint,
  raw: SketchPoint,
  opts: {
    shift: boolean;
    doc: Pick<SketchDocument, "width" | "height">;
  },
): SketchPoint {
  const { doc } = opts;
  const to = clampToCanvas(raw, doc);
  if (!opts.shift) return to;
  const dx = raw.x - from.x;
  const dy = raw.y - from.y;
  if (kind === "rect" || kind === "ellipse") {
    // 正方形 / 圆：取横纵较大者作边长；受边界时等比缩短
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    const sx = dx < 0 ? -1 : 1;
    const sy = dy < 0 ? -1 : 1;
    const roomX = sx > 0 ? doc.width - from.x : from.x;
    const roomY = sy > 0 ? doc.height - from.y : from.y;
    const fit = Math.min(side, roomX, roomY);
    return {
      x: from.x + sx * Math.max(0, fit),
      y: from.y + sy * Math.max(0, fit),
    };
  }
  // 直线 / 箭头：角度吸附到 45° 的倍数，再沿该方向缩短到边界
  const angle = Math.atan2(dy, dx);
  const snapped = Math.round(angle / SHAPE_ANGLE_STEP) * SHAPE_ANGLE_STEP;
  const ux = Math.cos(snapped);
  const uy = Math.sin(snapped);
  const t = Math.max(
    0,
    Math.min(Math.hypot(dx, dy), rayToEdge(from, ux, uy, doc)),
  );
  return clampToCanvas({ x: from.x + ux * t, y: from.y + uy * t }, doc);
}

/** 最小尺寸：矩形椭圆看宽高，线段箭头看长度；不足应丢弃且不占撤销步骤 */
export function shapeFitsMinSize(
  kind: SketchShapeKind,
  from: SketchPoint,
  to: SketchPoint,
  /** 显示缩放：逻辑像素 → 显示像素的倍数（纸面宽度 / 文档宽度） */
  displayScale: number,
): boolean {
  const min =
    SKETCH_SHAPE_MIN_DISPLAY /
    (Number.isFinite(displayScale) && displayScale > 0 ? displayScale : 1);
  if (kind === "rect" || kind === "ellipse")
    return Math.abs(to.x - from.x) >= min && Math.abs(to.y - from.y) >= min;
  return Math.hypot(to.x - from.x, to.y - from.y) >= min;
}

/** 箭头几何：线段终点即箭头尖端，另给实心三角形三点；长度趋零时返回 null */
export function arrowHead(
  from: SketchPoint,
  to: SketchPoint,
  width: number,
): {
  from: SketchPoint;
  tip: SketchPoint;
  base: SketchPoint;
  left: SketchPoint;
  right: SketchPoint;
} | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (!(len > 0)) return null;
  const size = Math.min(
    Math.max(width * ARROW_HEAD_RATIO, ARROW_HEAD_MIN),
    len * ARROW_HEAD_MAX_RATIO,
  );
  const ux = dx / len;
  const uy = dy / len;
  const base = { x: to.x - ux * size, y: to.y - uy * size };
  const half = size / 2;
  return {
    from,
    tip: to,
    base,
    // 面向箭头方向时的左、右底角（屏幕 y 向下）
    left: { x: base.x + uy * half, y: base.y - ux * half },
    right: { x: base.x - uy * half, y: base.y + ux * half },
  };
}

export function makeShape(
  kind: SketchShapeKind,
  fill: SketchFill,
  color: string,
  width: number,
  from: SketchPoint,
  to: SketchPoint,
): SketchShape {
  return {
    type: "shape",
    shape: kind,
    fill: kind === "line" || kind === "arrow" ? "none" : fill,
    color,
    width,
    from,
    to,
  };
}

/** 提交命令：丢弃重做分支；超上限拒绝。草图与选区共用 */
export function commitCommand<D extends SketchDocument>(
  doc: D,
  cursor: number,
  command: D["commands"][number],
): { doc: D; cursor: number } | null {
  if (doc.commands.length >= SKETCH_MAX_COMMANDS) return null;
  if (command.type === "text" && !isValidSketchText(command)) return null;
  if (
    command.type === "text-transform" &&
    !isValidTextTransform(command, doc.commands, cursor)
  )
    return null;
  return {
    doc: { ...doc, commands: [...doc.commands.slice(0, cursor), command] },
    cursor: cursor + 1,
  };
}

export function totalPoints(
  doc: Pick<SketchDocument, "commands">,
  cursor = doc.commands.length,
): number {
  let n = 0;
  for (let i = 0; i < cursor; i++) {
    const cmd = doc.commands[i];
    if (cmd.type === "stroke") n += cmd.points.length;
  }
  return n;
}

/** 变更检测：提交前缀的稳定序列化 */
export function sketchSnapshotKey(
  doc: Pick<SketchDocument, "commands">,
  cursor = doc.commands.length,
): string {
  return JSON.stringify(doc.commands.slice(0, cursor));
}

/** 确认快照：只保留提交前缀，此后不可原地修改 */
export function freezeSketch<D extends SketchDocument>(
  doc: D,
  cursor: number,
): D {
  return { ...doc, commands: doc.commands.slice(0, cursor) };
}

/** 读取校验：查结构完整（文档由本应用产出，笔画内容不作逐点复核） */
export function validateSketchDocument(value: unknown): SketchDocument | null {
  if (!value || typeof value !== "object") return null;
  const doc = value as Partial<SketchDocument>;
  const { width, height, commands } = doc;
  if (
    doc.version !== 1 ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    !width ||
    !height ||
    !Array.isArray(commands) ||
    !commands.every((cmd, index) =>
      cmd?.type === "text-transform"
        ? isValidTextTransform(cmd, commands, index)
        : isValidCommand(cmd),
    )
  )
    return null;
  return doc as SketchDocument;
}

function isValidCommand(cmd: unknown): boolean {
  if (!cmd || typeof cmd !== "object") return false;
  const c = cmd as SketchCommand;
  if (c.type === "clear") return true;
  if (c.type === "stroke") return Array.isArray(c.points);
  if (c.type === "text") return isValidSketchText(c);
  if (c.type !== "shape") return false;
  return (
    isShapeKind(c.shape) &&
    isShapeFill(c.fill) &&
    typeof c.color === "string" &&
    !!c.color &&
    typeof c.width === "number" &&
    Number.isFinite(c.width) &&
    c.width > 0 &&
    finitePoint(c.from) &&
    finitePoint(c.to)
  );
}

/** 比例是否不一致（容差 1%） */
export function ratioMismatch(
  a: { w: number; h: number },
  b: { w: number; h: number },
): boolean {
  return Math.abs(a.w / a.h - b.w / b.h) > 0.01;
}
