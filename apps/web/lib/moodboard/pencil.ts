/**
 * Shared pencil stroke rendering logic.
 * Used by both PencilLayer (live canvas) and the PNG export pipeline.
 */

import type { Stroke } from "./types";

/**
 * Render a single stroke onto a 2D canvas context.
 * The context must already be transformed to canvas coordinate space
 * (i.e. pan/zoom or export offset/scale applied via setTransform).
 */
export function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke): void {
  const { points, tool, color, width } = stroke;
  if (points.length === 0) return;

  ctx.save();
  ctx.lineCap  = "round";
  ctx.lineJoin = "round";

  // ── Pen: pressure-sensitive variable-width segments ──────────────────────
  if (tool === "pen") {
    ctx.globalAlpha  = 1;
    ctx.strokeStyle  = color;

    if (points.length === 1) {
      ctx.beginPath();
      ctx.arc(
        points[0].x,
        points[0].y,
        (width * Math.max(0.2, points[0].pressure)) / 2,
        0,
        Math.PI * 2,
      );
      ctx.fillStyle = color;
      ctx.fill();
    } else {
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1];
        const b = points[i];
        const p = Math.max(0.08, (a.pressure + b.pressure) / 2);
        ctx.beginPath();
        ctx.lineWidth = width * p * 2;
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }

  // ── Marker: semi-transparent constant-width bezier path ──────────────────
  } else if (tool === "marker") {
    ctx.globalAlpha = 0.38;
    ctx.strokeStyle = color;
    ctx.lineCap     = "square";

    const tilt      = points[0]?.tiltX ?? 0;
    const tiltScale = 1 + Math.abs(tilt) / 90;
    ctx.lineWidth   = width * 5 * tiltScale;

    if (points.length === 1) {
      ctx.beginPath();
      ctx.arc(points[0].x, points[0].y, width * 2.5, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length - 1; i++) {
        const mx = (points[i].x + points[i + 1].x) / 2;
        const my = (points[i].y + points[i + 1].y) / 2;
        ctx.quadraticCurveTo(points[i].x, points[i].y, mx, my);
      }
      ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
      ctx.stroke();
    }
  }
  // Eraser strokes are never stored — no rendering needed here.

  ctx.restore();
}
