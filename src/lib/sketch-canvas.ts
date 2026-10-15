/** 草图 Canvas 侧：顺序重放、形状绘制、alpha 判空、白底合成导出；无 React 状态 */
import { arrowHead, normalizeBox } from "./sketch";
import type { SketchCommand, SketchDocument, SketchShape } from "./types";

/** 单个形状的绘制；调用方须已设置好指向逻辑坐标的 transform */
export function drawSketchShape(
  ctx: CanvasRenderingContext2D,
  cmd: SketchShape,
): void {
  const color = cmd.color || "#1A1A1A";
  const solid = cmd.fill === "solid";
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = cmd.width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (cmd.shape === "line") {
    ctx.beginPath();
    ctx.moveTo(cmd.from.x, cmd.from.y);
    ctx.lineTo(cmd.to.x, cmd.to.y);
    ctx.stroke();
    return;
  }
  if (cmd.shape === "arrow") {
    const head = arrowHead(cmd.from, cmd.to, cmd.width);
    if (!head) return;
    const angle = Math.atan2(cmd.to.y - cmd.from.y, cmd.to.x - cmd.from.x);
    const radius = cmd.width / 2;
    const nx = -Math.sin(angle) * radius;
    const ny = Math.cos(angle) * radius;
    // 箭杆止于头部底边，与三角头合成一个填充轮廓；仅尾部画半圆，尖端没有线帽外露。
    ctx.beginPath();
    ctx.moveTo(cmd.from.x + nx, cmd.from.y + ny);
    ctx.lineTo(head.base.x + nx, head.base.y + ny);
    ctx.lineTo(head.right.x, head.right.y);
    ctx.lineTo(head.tip.x, head.tip.y);
    ctx.lineTo(head.left.x, head.left.y);
    ctx.lineTo(head.base.x - nx, head.base.y - ny);
    ctx.lineTo(cmd.from.x - nx, cmd.from.y - ny);
    ctx.arc(
      cmd.from.x,
      cmd.from.y,
      radius,
      angle - Math.PI / 2,
      angle + Math.PI / 2,
      true,
    );
    ctx.closePath();
    ctx.fill();
    return;
  }
  const box = normalizeBox(cmd.from, cmd.to);
  ctx.beginPath();
  if (cmd.shape === "rect")
    ctx.rect(box.left, box.top, box.right - box.left, box.bottom - box.top);
  else
    ctx.ellipse(
      (box.left + box.right) / 2,
      (box.top + box.bottom) / 2,
      (box.right - box.left) / 2,
      (box.bottom - box.top) / 2,
      0,
      0,
      Math.PI * 2,
    );
  // 实心填满当前颜色，不再叠边框；空心只描边
  if (solid) ctx.fill();
  else ctx.stroke();
}

/** 单条命令绘制；调用方须已设置好指向逻辑坐标的 transform */
export function drawSketchCommand(
  ctx: CanvasRenderingContext2D,
  cmd: SketchCommand,
  size: Pick<SketchDocument, "width" | "height">,
): void {
  if (cmd.type === "clear") {
    ctx.clearRect(0, 0, size.width, size.height);
    return;
  }
  if (cmd.type === "shape") {
    ctx.save();
    drawSketchShape(ctx, cmd);
    ctx.restore();
    return;
  }
  ctx.save();
  if (cmd.tool === "eraser") ctx.globalCompositeOperation = "destination-out";
  const color = cmd.tool === "pen" ? (cmd.color ?? "#1A1A1A") : "#000000";
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = cmd.width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const points = cmd.points;
  if (points.length === 1) {
    ctx.beginPath();
    ctx.arc(points[0].x, points[0].y, cmd.width / 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++)
      ctx.lineTo(points[i].x, points[i].y);
    ctx.stroke();
  }
  ctx.restore();
}

/** 重放命令[0, cursor) 到已按 scale 缩放配好的 ctx（scale=1 即文档原始尺寸） */
export function replaySketch(
  ctx: CanvasRenderingContext2D,
  doc: SketchDocument,
  cursor = doc.commands.length,
  scale = 1,
): void {
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, doc.width, doc.height);
  for (let i = 0; i < cursor; i++) drawSketchCommand(ctx, doc.commands[i], doc);
}

/** 空白判定：降采样到最长边 ≤512 扫描 alpha */
export function sketchHasInk(
  doc: SketchDocument,
  cursor = doc.commands.length,
): boolean {
  const scale = Math.min(1, 512 / Math.max(doc.width, doc.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(doc.width * scale));
  canvas.height = Math.max(1, Math.round(doc.height * scale));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return false;
  replaySketch(ctx, doc, cursor, scale);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 2) return true;
  return false;
}

/** 导出：文档原始尺寸，白底合成；空白判定见画板内的 sketchHasInk */
export async function exportSketchPng(
  doc: SketchDocument,
): Promise<Blob | null> {
  const strokes = document.createElement("canvas");
  strokes.width = doc.width;
  strokes.height = doc.height;
  const sctx = strokes.getContext("2d");
  if (!sctx) return null;
  replaySketch(sctx, doc);
  sctx.globalCompositeOperation = "destination-over";
  sctx.fillStyle = "#FFFFFF";
  sctx.fillRect(0, 0, doc.width, doc.height);
  return new Promise<Blob | null>((resolve) =>
    strokes.toBlob(resolve, "image/png"),
  );
}
