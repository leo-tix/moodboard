/**
 * Shared pencil stroke rendering logic.
 * Used by both PencilLayer (live canvas) and the PNG export pipeline.
 */

import type { Stroke, StrokePoint } from "./types";

// ── Smoothing helpers ─────────────────────────────────────────────────────────

/**
 * Bidirectional exponential moving average on pressure values.
 * Multiple passes + lower alpha produce very gradual, smooth width transitions.
 */
function smoothPressure(points: StrokePoint[], alpha = 0.2, passes = 3): number[] {
  const raw = points.map((p) => Math.max(0.08, p.pressure));
  const s   = [...raw];
  for (let pass = 0; pass < passes; pass++) {
    for (let i = 1;             i < s.length;     i++) s[i]   = s[i - 1] * (1 - alpha) + s[i] * alpha;
    for (let i = s.length - 2;  i >= 0;           i--) s[i]   = s[i + 1] * (1 - alpha) + s[i] * alpha;
  }
  return s;
}

/**
 * Multi-pass 3-point moving-average on XY.
 * Multiple passes progressively soften quantization artifacts and jitter.
 * Endpoints preserved exactly on every pass.
 */
function smoothPositions(points: StrokePoint[], passes = 3): StrokePoint[] {
  let pts = [...points];
  for (let p = 0; p < passes; p++) {
    if (pts.length < 3) break;
    pts = pts.map((pt, i) => {
      if (i === 0 || i === pts.length - 1) return pt;
      return {
        ...pt,
        x: (pts[i - 1].x + pt.x + pts[i + 1].x) / 3,
        y: (pts[i - 1].y + pt.y + pts[i + 1].y) / 3,
      };
    });
  }
  return pts;
}

/**
 * Catmull-Rom spline interpolation.
 * Produces a dense set of points that pass through all original points with
 * C1 continuity (smooth tangents at every joint). The step size is ~2px so
 * the path is dense enough for seamless round-cap overlapping without the
 * old per-segment sub-division loop.
 */
function catmullRom(points: StrokePoint[]): StrokePoint[] {
  if (points.length < 2) return points;
  if (points.length === 2) return points;

  const result: StrokePoint[] = [];
  const n = points.length;

  for (let i = 0; i < n - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(n - 1, i + 2)];

    // Adaptive step count: ~2px per step
    const segLen = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const steps  = Math.max(2, Math.ceil(segLen / 2));

    for (let s = 0; s < steps; s++) {
      const t  = s / steps;
      const t2 = t * t;
      const t3 = t2 * t;

      // Standard Catmull-Rom formula
      const x = 0.5 * (
        (2 * p1.x) +
        (-p0.x + p2.x) * t +
        (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
        (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3
      );
      const y = 0.5 * (
        (2 * p1.y) +
        (-p0.y + p2.y) * t +
        (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
        (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3
      );
      // Linearly interpolate pressure between segment endpoints
      const pressure = p1.pressure + (p2.pressure - p1.pressure) * t;

      result.push({ x, y, pressure });
    }
  }

  // Append the final point exactly
  result.push(points[n - 1]);
  return result;
}

// ── Pen tool ─────────────────────────────────────────────────────────────────

/**
 * Draw a pressure-sensitive pen stroke.
 *
 * Pipeline:
 *  1. Multi-pass position smoothing (3×) removes integer-quantization jitter.
 *  2. Multi-pass pressure smoothing (3×, α=0.2) gives gradual width changes.
 *  3. Catmull-Rom spline interpolation → dense, smooth path (~2px steps).
 *  4. Render each micro-segment with its interpolated lineWidth and round lineCap
 *     so adjacent caps overlap seamlessly, producing a velvety variable-width stroke.
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

  // Step 1: smooth positions + pressures
  const smoothed = smoothPositions(points, 3);
  const sp       = smoothPressure(smoothed, 0.2, 3);

  // Inject smoothed pressures back so catmullRom can interpolate them
  const withSmoothedPressure: StrokePoint[] = smoothed.map((p, i) => ({
    ...p,
    pressure: sp[i],
  }));

  // Step 2: Catmull-Rom interpolation → dense smooth path
  const dense = catmullRom(withSmoothedPressure);

  // Step 3: render
  for (let i = 1; i < dense.length; i++) {
    const a  = dense[i - 1];
    const b  = dense[i];
    const lw = ((a.pressure + b.pressure) / 2) * width * 2;
    ctx.beginPath();
    ctx.lineWidth = Math.max(0.5, lw);
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
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

  const smooth = smoothPositions(points, 3);

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
