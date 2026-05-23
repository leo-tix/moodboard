/**
 * Shared pencil stroke rendering logic.
 * Used by both PencilLayer (live canvas) and the PNG export pipeline.
 */

import type { Stroke, StrokePoint } from "./types";

// ── Smoothing helpers ─────────────────────────────────────────────────────────

/**
 * Bidirectional exponential moving average on pressure values.
 * Forward + backward pass removes sudden spikes and makes width transitions smooth.
 */
function smoothPressure(points: StrokePoint[], alpha = 0.3): number[] {
  const raw = points.map((p) => Math.max(0.08, p.pressure));
  const s   = [...raw];
  for (let i = 1;         i < s.length;     i++) s[i]   = s[i - 1] * (1 - alpha) + s[i] * alpha;
  for (let i = s.length - 2; i >= 0;        i--) s[i]   = s[i + 1] * (1 - alpha) + s[i] * alpha;
  return s;
}

/**
 * 3-point moving-average on XY to soften integer-quantization artifacts.
 * Only touches interior points; endpoints are preserved exactly.
 */
function smoothPositions(points: StrokePoint[]): StrokePoint[] {
  if (points.length < 3) return points;
  return points.map((p, i) => {
    if (i === 0 || i === points.length - 1) return p;
    return {
      ...p,
      x: (points[i - 1].x + p.x + points[i + 1].x) / 3,
      y: (points[i - 1].y + p.y + points[i + 1].y) / 3,
    };
  });
}

// ── Pen tool ─────────────────────────────────────────────────────────────────

/**
 * Draw a pressure-sensitive pen stroke with smooth width transitions.
 *
 * Approach: sub-segment each point-to-point span into 1px steps, interpolating
 * the lineWidth at the midpoint of each step. With round lineCap the caps of
 * adjacent micro-segments overlap perfectly, eliminating the seams produced by
 * abrupt lineWidth changes. Combined with pressure smoothing this produces
 * calligraphic, velvety strokes.
 */
function drawPen(
  ctx: CanvasRenderingContext2D,
  points: StrokePoint[],
  width: number,
  color: string,
): void {
  ctx.strokeStyle = color;
  ctx.globalAlpha = 1;
  ctx.lineCap     = "round";
  ctx.lineJoin    = "round";

  if (points.length === 1) {
    const r = Math.max(0.5, points[0].pressure * width);
    ctx.beginPath();
    ctx.arc(points[0].x, points[0].y, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    return;
  }

  const smooth = smoothPositions(points);
  const sp     = smoothPressure(smooth);

  for (let i = 1; i < smooth.length; i++) {
    const a = smooth[i - 1];
    const b = smooth[i];
    const pa = sp[i - 1];
    const pb = sp[i];

    const dx   = b.x - a.x;
    const dy   = b.y - a.y;
    const dist = Math.hypot(dx, dy);
    // One sub-segment per pixel so round caps overlap seamlessly
    const steps = Math.max(1, Math.ceil(dist));

    for (let s = 0; s < steps; s++) {
      const t0  = s       / steps;
      const t1  = (s + 1) / steps;
      const tm  = (t0 + t1) / 2;
      // Interpolate lineWidth at mid-step for smooth gradient
      const lw  = (pa + (pb - pa) * tm) * width * 2;
      ctx.beginPath();
      ctx.lineWidth = Math.max(0.5, lw);
      ctx.moveTo(a.x + dx * t0, a.y + dy * t0);
      ctx.lineTo(a.x + dx * t1, a.y + dy * t1);
      ctx.stroke();
    }
  }
}

// ── Marker tool ───────────────────────────────────────────────────────────────

/**
 * Semi-transparent marker using smooth quadratic bezier curves.
 * Tilt angle widens the nib like a real chisel-tip marker.
 */
function drawMarker(
  ctx: CanvasRenderingContext2D,
  points: StrokePoint[],
  width: number,
  color: string,
): void {
  ctx.globalAlpha = 0.38;
  ctx.strokeStyle = color;
  ctx.lineCap     = "square";
  ctx.lineJoin    = "round";

  const tilt      = points[0]?.tiltX ?? 0;
  const tiltScale = 1 + Math.abs(tilt) / 90;
  ctx.lineWidth   = width * 5 * tiltScale;

  if (points.length === 1) {
    ctx.beginPath();
    ctx.arc(points[0].x, points[0].y, width * 2.5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    return;
  }

  const smooth = smoothPositions(points);

  ctx.beginPath();
  ctx.moveTo(smooth[0].x, smooth[0].y);
  for (let i = 1; i < smooth.length - 1; i++) {
    const mx = (smooth[i].x + smooth[i + 1].x) / 2;
    const my = (smooth[i].y + smooth[i + 1].y) / 2;
    ctx.quadraticCurveTo(smooth[i].x, smooth[i].y, mx, my);
  }
  ctx.lineTo(smooth[smooth.length - 1].x, smooth[smooth.length - 1].y);
  ctx.stroke();
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Render a single stroke onto a 2D canvas context.
 * The context must already be transformed to canvas coordinate space
 * (i.e. pan/zoom or export offset/scale applied via setTransform).
 */
export function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke): void {
  const { points, tool, color, width } = stroke;
  if (points.length === 0) return;

  ctx.save();

  if (tool === "pen") {
    drawPen(ctx, points, width, color);
  } else if (tool === "marker") {
    drawMarker(ctx, points, width, color);
  }
  // Eraser strokes are never stored — nothing to render.

  ctx.restore();
}
