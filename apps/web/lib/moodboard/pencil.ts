/**
 * Shared pencil stroke rendering logic.
 * Used by both PencilLayer (live canvas) and the PNG export pipeline.
 *
 * ── Performance architecture ──────────────────────────────────────────────────
 *
 * The bottleneck is the committed canvas (all finished strokes), which
 * redraws on every pan/zoom event (60 fps during gestures). The solution:
 *
 *   1. Pre-compute a Path2D for each stroke ONCE, when it is committed.
 *      Store in a Map<strokeId, CachedStroke> in PencilLayer.
 *      On subsequent redraws: ctx.fill(cachedPath) — O(1) GPU call per stroke.
 *
 *   2. Pen strokes are rendered as a FILLED OUTLINE POLYGON
 *      (variable-width, with round caps), not as hundreds of micro-segments.
 *      This collapses N×beginPath/stroke calls into 1 fill call per stroke.
 *
 *   3. Live (in-progress) strokes use a FAST PATH: a single quadratic-bezier
 *      stroke, zero smoothing, one draw call.  Full quality is applied when the
 *      stroke is committed and cached.
 */

import type { Stroke, StrokePoint } from "./types";

// ── Smoothing / interpolation helpers (commit-time only) ──────────────────────

/** Multi-pass 3-point moving-average — runs at commit time only. */
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

/** Multi-pass bidirectional EMA on pressure — runs at commit time only. */
function smoothPressure(points: StrokePoint[], alpha = 0.2, passes = 3): number[] {
  const raw = points.map((p) => Math.max(0.08, p.pressure));
  const s   = [...raw];
  for (let pass = 0; pass < passes; pass++) {
    for (let i = 1;            i < s.length;  i++) s[i]   = s[i - 1] * (1 - alpha) + s[i] * alpha;
    for (let i = s.length - 2; i >= 0;        i--) s[i]   = s[i + 1] * (1 - alpha) + s[i] * alpha;
  }
  return s;
}

/**
 * Catmull-Rom spline — densifies the point array to ~2px spacing, giving
 * smooth curves through every original sample point.
 * Runs at commit time; result is stored in the Path2D cache.
 */
function catmullRom(points: StrokePoint[]): StrokePoint[] {
  if (points.length < 2) return points;
  const result: StrokePoint[] = [];
  const n = points.length;

  for (let i = 0; i < n - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(n - 1, i + 2)];

    const steps = Math.max(2, Math.ceil(Math.hypot(p2.x - p1.x, p2.y - p1.y) / 2));

    for (let s = 0; s < steps; s++) {
      const t  = s / steps;
      const t2 = t * t;
      const t3 = t2 * t;

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
      result.push({ x, y, pressure: p1.pressure + (p2.pressure - p1.pressure) * t });
    }
  }

  result.push(points[n - 1]);
  return result;
}

// ── Pen: variable-width outline polygon ───────────────────────────────────────

/**
 * Build a filled Path2D outline for a pen stroke.
 *
 * Algorithm: for each dense CR point compute left/right profile points
 * (perpendicular offsets by the pressure-scaled half-width).  Connect them
 * into a single closed polygon with polygon-approximated round caps at both
 * ends.  Filling this path with ctx.fill() is a single GPU draw call.
 *
 * Cap geometry (8-step polygon semicircle):
 *   – Start cap: from right[0] (angle ta - π/2) going BACKWARD (decreasing by π) to left[0]
 *   – End cap:   from left[n-1] (angle ta + π/2) going FORWARD (decreasing by π) to right[n-1]
 */
function buildPenOutline(dense: StrokePoint[], width: number): Path2D {
  const path = new Path2D();
  const n    = dense.length;

  if (n === 0) return path;

  if (n === 1) {
    path.arc(dense[0].x, dense[0].y, Math.max(0.3, dense[0].pressure * width), 0, Math.PI * 2);
    return path;
  }

  const left:  { x: number; y: number }[] = new Array(n);
  const right: { x: number; y: number }[] = new Array(n);
  const hw: number[] = new Array(n);
  const ta: number[] = new Array(n);

  for (let i = 0; i < n; i++) {
    const p  = dense[i];
    const h  = Math.max(0.3, p.pressure * width);
    hw[i] = h;

    // Central-difference tangent
    const ax = i > 0     ? dense[i - 1].x : dense[0].x;
    const ay = i > 0     ? dense[i - 1].y : dense[0].y;
    const bx = i < n - 1 ? dense[i + 1].x : dense[n - 1].x;
    const by = i < n - 1 ? dense[i + 1].y : dense[n - 1].y;
    let tx = bx - ax, ty = by - ay;
    const tlen = Math.hypot(tx, ty);
    if (tlen < 1e-6) { tx = 1; ty = 0; } else { tx /= tlen; ty /= tlen; }

    ta[i] = Math.atan2(ty, tx);

    // Normal: 90° CCW from tangent = (-ty, tx)
    const nx = -ty, ny = tx;
    left[i]  = { x: p.x + nx * h, y: p.y + ny * h };
    right[i] = { x: p.x - nx * h, y: p.y - ny * h };
  }

  const N_CAP = 8;

  // ── Start cap (backward-facing semicircle) ──
  // Polygon from right[0] (ta[0]-π/2) going backward (angle decreasing by π total)
  const startAngle = ta[0] - Math.PI / 2;
  path.moveTo(right[0].x, right[0].y);
  for (let i = 1; i <= N_CAP; i++) {
    const a = startAngle - (Math.PI * i) / N_CAP;
    path.lineTo(dense[0].x + Math.cos(a) * hw[0], dense[0].y + Math.sin(a) * hw[0]);
  }
  // After N_CAP steps we arrive at left[0] (ta[0]+π/2 ≡ startAngle - π)

  // ── Left outline (forward along stroke) ──
  for (let i = 0; i < n; i++) path.lineTo(left[i].x, left[i].y);

  // ── End cap (forward-facing semicircle) ──
  // Polygon from left[n-1] (ta[n-1]+π/2) going forward (angle decreasing by π total)
  const endAngle = ta[n - 1] + Math.PI / 2;
  for (let i = 1; i <= N_CAP; i++) {
    const a = endAngle - (Math.PI * i) / N_CAP;
    path.lineTo(dense[n - 1].x + Math.cos(a) * hw[n - 1], dense[n - 1].y + Math.sin(a) * hw[n - 1]);
  }
  // After N_CAP steps we arrive at right[n-1] (ta[n-1]-π/2)

  // ── Right outline (backward along stroke) ──
  for (let i = n - 2; i >= 0; i--) path.lineTo(right[i].x, right[i].y);

  path.closePath();
  return path;
}

// ── Marker: single bezier Path2D ─────────────────────────────────────────────

function buildMarkerPath(smooth: StrokePoint[], width: number): { path: Path2D; lineWidth: number } {
  const path = new Path2D();

  if (smooth.length === 1) {
    path.arc(smooth[0].x, smooth[0].y, width * 2.5, 0, Math.PI * 2);
    return { path, lineWidth: width * 5 };
  }

  const tilt      = smooth[0]?.tiltX ?? 0;
  const tiltScale = 1 + Math.abs(tilt) / 90;

  path.moveTo(smooth[0].x, smooth[0].y);
  for (let i = 1; i < smooth.length - 1; i++) {
    const mx = (smooth[i].x + smooth[i + 1].x) / 2;
    const my = (smooth[i].y + smooth[i + 1].y) / 2;
    path.quadraticCurveTo(smooth[i].x, smooth[i].y, mx, my);
  }
  path.lineTo(smooth[smooth.length - 1].x, smooth[smooth.length - 1].y);

  return { path, lineWidth: width * 5 * tiltScale };
}

// ── Public cache types ────────────────────────────────────────────────────────

/**
 * Pre-computed render data for a single stroke.
 * Built once at commit time; reused on every subsequent canvas redraw.
 */
export interface CachedStroke {
  /** Filled polygon outline for pen strokes (null for marker) */
  fillPath:   Path2D | null;
  /** Stroked bezier path for marker strokes (null for pen) */
  strokePath: Path2D | null;
  strokeStyle: string;
  globalAlpha: number;
  /** Line width for the marker stroke() call */
  lineWidth: number;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Pre-compute the full-quality Path2D for a committed stroke.
 * Call once when a stroke is added; cache the result in PencilLayer.
 */
export function buildCachedStroke(stroke: Stroke): CachedStroke {
  const { points, tool, color, width } = stroke;

  if (tool === "pen" && points.length > 0) {
    // Full-quality pipeline: position smooth → pressure smooth → Catmull-Rom → outline
    const smoothed = smoothPositions(points, 3);
    const sp       = smoothPressure(smoothed, 0.2, 3);
    const withSP   = smoothed.map((p, i) => ({ ...p, pressure: sp[i] }));
    const dense    = catmullRom(withSP);
    return {
      fillPath:    buildPenOutline(dense, width),
      strokePath:  null,
      strokeStyle: color,
      globalAlpha: 1,
      lineWidth:   0,
    };
  }

  if (tool === "marker" && points.length > 0) {
    const smooth              = smoothPositions(points, 3);
    const { path, lineWidth } = buildMarkerPath(smooth, width);
    return {
      fillPath:    null,
      strokePath:  path,
      strokeStyle: color,
      globalAlpha: 0.38,
      lineWidth,
    };
  }

  // Eraser or empty — nothing to render
  return { fillPath: null, strokePath: null, strokeStyle: color, globalAlpha: 1, lineWidth: 0 };
}

/**
 * Draw a pre-built CachedStroke onto a 2D context.
 * O(1) GPU draw call per stroke — the heavy geometry work was done in buildCachedStroke.
 * The context transform (pan/zoom) must already be applied by the caller.
 */
export function drawCachedStroke(ctx: CanvasRenderingContext2D, cached: CachedStroke): void {
  ctx.save();
  ctx.globalAlpha  = cached.globalAlpha;
  ctx.strokeStyle  = cached.strokeStyle;
  ctx.fillStyle    = cached.strokeStyle;

  if (cached.fillPath) {
    ctx.fill(cached.fillPath);
  } else if (cached.strokePath) {
    ctx.lineCap    = "square";
    ctx.lineJoin   = "round";
    ctx.lineWidth  = cached.lineWidth;
    ctx.stroke(cached.strokePath);
  }

  ctx.restore();
}

/**
 * Fast live preview: single quadratic-bezier stroke, no smoothing, one draw call.
 * Used for the in-progress stroke on the live canvas.
 * Full quality is applied when the stroke is committed and cached.
 */
export function drawStrokeLive(ctx: CanvasRenderingContext2D, stroke: Stroke): void {
  const { points, tool, color, width } = stroke;
  if (points.length === 0) return;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineCap     = "round";
  ctx.lineJoin    = "round";
  ctx.globalAlpha = tool === "marker" ? 0.38 : 1;

  if (points.length === 1) {
    const r = Math.max(0.5, points[0].pressure * width);
    ctx.beginPath();
    ctx.arc(points[0].x, points[0].y, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
    return;
  }

  // Average pressure → stable uniform lineWidth (avoids flickering during drawing)
  const avgPressure = points.reduce((s, p) => s + p.pressure, 0) / points.length;
  ctx.lineWidth = Math.max(0.5, avgPressure * width * (tool === "marker" ? 5 : 2));

  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length - 1; i++) {
    const mx = (points[i].x + points[i + 1].x) / 2;
    const my = (points[i].y + points[i + 1].y) / 2;
    ctx.quadraticCurveTo(points[i].x, points[i].y, mx, my);
  }
  ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
  ctx.stroke();

  ctx.restore();
}

/**
 * Render a stroke directly onto a 2D context (no caching).
 * Used by the PNG export pipeline (one-shot, no need for cache).
 */
export function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke): void {
  const cached = buildCachedStroke(stroke);
  drawCachedStroke(ctx, cached);
}
