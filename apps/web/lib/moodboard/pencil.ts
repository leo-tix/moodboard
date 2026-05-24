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

import type { Stroke, StrokePoint, StrokeElement } from "./types";

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

  // ── Pass 1: raw central-difference tangent angle at each point ──────────────
  for (let i = 0; i < n; i++) {
    const ax = i > 0     ? dense[i - 1].x : dense[0].x;
    const ay = i > 0     ? dense[i - 1].y : dense[0].y;
    const bx = i < n - 1 ? dense[i + 1].x : dense[n - 1].x;
    const by = i < n - 1 ? dense[i + 1].y : dense[n - 1].y;
    const tx = bx - ax, ty = by - ay;
    const tlen = Math.hypot(tx, ty);
    ta[i] = tlen < 1e-6 ? (i > 0 ? ta[i - 1] : 0) : Math.atan2(ty / tlen, tx / tlen);
  }

  // ── Pass 2: smooth tangent angles (2 iterations, vector averaging) ──────────
  // Prevents consecutive normals from pointing in nearly-opposite directions,
  // which would cause the outline polygon to self-intersect and produce
  // triangular fill artifacts under the nonzero winding rule.
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 1; i < n - 1; i++) {
      const dx = (Math.cos(ta[i - 1]) + Math.cos(ta[i]) + Math.cos(ta[i + 1])) / 3;
      const dy = (Math.sin(ta[i - 1]) + Math.sin(ta[i]) + Math.sin(ta[i + 1])) / 3;
      if (dx * dx + dy * dy > 1e-12) ta[i] = Math.atan2(dy, dx);
    }
  }

  // ── Pass 3: build left/right profile points using smoothed tangents ──────────
  for (let i = 0; i < n; i++) {
    const p  = dense[i];
    const h  = Math.max(0.3, p.pressure * width);
    hw[i] = h;
    // Normal: 90° CCW from tangent direction ta[i]
    const nx = -Math.sin(ta[i]), ny = Math.cos(ta[i]);
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
  // Multiply rather than replace so that an element-level opacity set by the
  // caller (e.g. the export pipeline) is respected in addition to the tool alpha.
  ctx.globalAlpha *= cached.globalAlpha;
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
 * Live preview: visually matches the committed result as closely as possible.
 *
 * Pen: 1-pass position + pressure smooth → filled outline polygon.
 *      Matches the committed appearance without the full Catmull-Rom pipeline cost.
 *
 * Marker: fixed width (width × 5 × tiltScale), matching buildMarkerPath exactly.
 *         The previous version used avgPressure × width × 5, which was consistently
 *         thinner than the committed stroke (pressure < 1).
 */
export function drawStrokeLive(ctx: CanvasRenderingContext2D, stroke: Stroke): void {
  const { points, tool, color, width } = stroke;
  if (points.length === 0) return;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle   = color;
  ctx.globalAlpha = tool === "marker" ? 0.38 : 1;

  if (points.length === 1) {
    const r = tool === "marker" ? width * 2.5 : Math.max(0.5, points[0].pressure * width);
    ctx.beginPath();
    ctx.arc(points[0].x, points[0].y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  if (tool === "pen") {
    // 1-pass smooth → outline polygon (no Catmull-Rom densification for speed)
    const smoothed = smoothPositions(points, 1);
    const sp       = smoothPressure(smoothed, 0.2, 1);
    const withSP   = smoothed.map((p, i) => ({ ...p, pressure: sp[i] }));
    ctx.fill(buildPenOutline(withSP, width));
  } else {
    // Marker: width matches committed result exactly
    const tilt      = points[0]?.tiltX ?? 0;
    const tiltScale = 1 + Math.abs(tilt) / 90;
    ctx.lineWidth = width * 5 * tiltScale;
    ctx.lineCap   = "round";
    ctx.lineJoin  = "round";
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

// ── Shape detection (hold-to-snap) ────────────────────────────────────────────

export type SnappedShape =
  | { type: "line";    points: StrokePoint[] }
  | { type: "rect";    points: StrokePoint[] }
  | { type: "ellipse"; points: StrokePoint[] };

function ptToSegDist(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number,
): number {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function generateLinePoints(a: StrokePoint, b: StrokePoint): StrokePoint[] {
  return [
    { x: a.x, y: a.y, pressure: 1 },
    { x: b.x, y: b.y, pressure: 1 },
  ];
}

function generateRectPoints(minX: number, minY: number, maxX: number, maxY: number): StrokePoint[] {
  const w = maxX - minX, h = maxY - minY;
  // Very light border radius: 7% of the shorter side, max 14 px
  const r     = Math.min(14, Math.min(w, h) * 0.07);
  const STEPS = 10; // straight-edge interpolation points
  const ARC   = 4;  // points per quarter-circle corner arc
  const pts: StrokePoint[] = [];

  /** Append a quarter-circle arc (clockwise) centred at (cx,cy) from startAngle to startAngle+π/2 */
  const arc = (cx: number, cy: number, startAngle: number) => {
    for (let i = 0; i <= ARC; i++) {
      const a = startAngle + (Math.PI / 2) * (i / ARC);
      pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a), pressure: 1 });
    }
  };

  // Top edge →
  for (let i = 0; i <= STEPS; i++) pts.push({ x: minX + r + (w - 2 * r) * i / STEPS, y: minY, pressure: 1 });
  // Top-right corner  (arc center: maxX-r, minY+r)  -π/2 → 0
  arc(maxX - r, minY + r, -Math.PI / 2);
  // Right edge ↓
  for (let i = 1; i <= STEPS; i++) pts.push({ x: maxX, y: minY + r + (h - 2 * r) * i / STEPS, pressure: 1 });
  // Bottom-right corner  (maxX-r, maxY-r)  0 → π/2
  arc(maxX - r, maxY - r, 0);
  // Bottom edge ←
  for (let i = 1; i <= STEPS; i++) pts.push({ x: maxX - r - (w - 2 * r) * i / STEPS, y: maxY, pressure: 1 });
  // Bottom-left corner  (minX+r, maxY-r)  π/2 → π
  arc(minX + r, maxY - r, Math.PI / 2);
  // Left edge ↑
  for (let i = 1; i <= STEPS; i++) pts.push({ x: minX, y: maxY - r - (h - 2 * r) * i / STEPS, pressure: 1 });
  // Top-left corner  (minX+r, minY+r)  π → 3π/2
  arc(minX + r, minY + r, Math.PI);
  // Close
  pts.push({ x: minX + r, y: minY, pressure: 1 });
  return pts;
}

function generateEllipsePoints(cx: number, cy: number, rx: number, ry: number): StrokePoint[] {
  const N = 48;
  const pts: StrokePoint[] = [];
  for (let i = 0; i <= N; i++) {
    const a = (2 * Math.PI * i) / N;
    pts.push({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a), pressure: 1 });
  }
  return pts;
}

/**
 * Count the number of sharp direction changes (corners) in a stroke.
 * thresholdDeg: minimum angle (degrees) at which a bend is counted as a corner.
 * WIN: look-ahead/behind window as a fraction of the point array length.
 * A rectangle should produce 3–5 corners; a smooth curve should produce 0.
 */
function countCorners(points: StrokePoint[], thresholdDeg: number): number {
  if (points.length < 5) return 0;
  const WIN = Math.max(3, Math.floor(points.length / 25));
  // The vectors (i→i-WIN) and (i→i+WIN) form a "V" shape.
  // Straight line  → both vectors anti-parallel → angle ≈ 180°
  // Smooth curve   → angle ≈ 165–175° (barely off anti-parallel)
  // 90° corner     → vectors perpendicular       → angle ≈ 90°
  // A sharp corner is detected when this angle is small, i.e. < (180 - thresholdDeg).
  const limitAngle = 180 - thresholdDeg; // e.g. 125° for thresholdDeg=55°
  let corners = 0;
  let i = WIN;
  while (i < points.length - WIN) {
    const ax = points[i - WIN].x - points[i].x;
    const ay = points[i - WIN].y - points[i].y;
    const bx = points[i + WIN].x - points[i].x;
    const by = points[i + WIN].y - points[i].y;
    const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
    if (la > 4 && lb > 4) {
      const dot   = (ax * bx + ay * by) / (la * lb);
      const angle = Math.acos(Math.max(-1, Math.min(1, dot))) * (180 / Math.PI);
      if (angle < limitAngle) {
        corners++;
        i += WIN; // jump past the corner to avoid double-counting
        continue;
      }
    }
    i++;
  }
  return corners;
}

/**
 * Analyse a stroke and return a snapped geometric shape if one is clearly recognised.
 * Returns null if the stroke is ambiguous — the caller should commit it as-is.
 *
 * Detection order: line → ellipse → rectangle.
 * Thresholds are intentionally conservative so only clearly-intended shapes snap.
 */
export function detectShape(stroke: Stroke): SnappedShape | null {
  const { points } = stroke;
  if (points.length < 4) return null;

  const start = points[0];
  const end   = points[points.length - 1];

  const xs    = points.map((p) => p.x);
  const ys    = points.map((p) => p.y);
  const minX  = Math.min(...xs), maxX = Math.max(...xs);
  const minY  = Math.min(...ys), maxY = Math.max(...ys);
  const bboxW = maxX - minX,    bboxH = maxY - minY;

  let arcLen = 0;
  for (let i = 1; i < points.length; i++) {
    arcLen += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  if (arcLen < 30) return null;

  // ── Line ───────────────────────────────────────────────────────────────────
  const maxDev = Math.max(
    ...points.map((p) => ptToSegDist(p.x, p.y, start.x, start.y, end.x, end.y))
  );
  if (maxDev < Math.max(15, arcLen * 0.07)) {
    return { type: "line", points: generateLinePoints(start, end) };
  }

  // ── Closed shape check ─────────────────────────────────────────────────────
  const closeDist = Math.hypot(start.x - end.x, start.y - end.y);
  if (closeDist > Math.max(50, arcLen * 0.15) || bboxW < 30 || bboxH < 30) return null;

  // Corner count drives the detection order below.
  // Squares have std/mean ≈ 0.15–0.18 which would falsely trigger the ellipse
  // threshold (0.22), so the sharp-corner rectangle check must run before ellipse.
  // However the nearEdge fallback (for very rounded rects) must run AFTER ellipse,
  // because every point on a circle is within ~16% of its bounding box from some
  // edge — nearEdge would otherwise catch circles as rectangles.
  const perim   = 2 * (bboxW + bboxH);
  const corners = countCorners(points, 55);

  // ── Rectangle primary: 3–8 sharp corners ≥ 55° ────────────────────────────
  // Upper bound is 8 (not 5) to tolerate wobbly freehand strokes that may
  // produce a few extra fake corners along imperfect edges.
  if (corners >= 3 && corners <= 8 && arcLen > 0.55 * perim && arcLen < 3.0 * perim) {
    return { type: "rect", points: generateRectPoints(minX, minY, maxX, maxY) };
  }

  // ── Ellipse: smooth closed curve (no sharp corners) ────────────────────────
  if (corners < 3) {
    const cx    = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const dists = points.map((p) => Math.hypot(p.x - cx, p.y - cy));
    const mean  = dists.reduce((a, b) => a + b) / dists.length;
    const std   = Math.sqrt(dists.reduce((s, d) => s + (d - mean) ** 2, 0) / dists.length);
    if (std / mean < 0.22) {
      return { type: "ellipse", points: generateEllipsePoints(cx, cy, bboxW / 2, bboxH / 2) };
    }
  }

  // ── Rectangle fallback: most points near the bounding-box edges ────────────
  // Catches rounded rects that missed the corner check (corners > 8 from wobble,
  // or very rounded corners). Upper bound is 3.0× perim so wobbly strokes pass.
  // Runs after ellipse so circles (all points near bbox edges too) are not caught.
  if (arcLen > 0.55 * perim && arcLen < 3.0 * perim) {
    const tol      = Math.max(22, Math.max(bboxW, bboxH) * 0.16);
    const nearEdge = points.filter(
      (p) =>
        Math.abs(p.x - minX) < tol || Math.abs(p.x - maxX) < tol ||
        Math.abs(p.y - minY) < tol || Math.abs(p.y - maxY) < tol,
    ).length;
    if (nearEdge / points.length > 0.62) {
      return { type: "rect", points: generateRectPoints(minX, minY, maxX, maxY) };
    }
  }

  return null;
}

// ── StrokeElement helpers ─────────────────────────────────────────────────────

/**
 * Compute the tight bounding box of a stroke, padded by the stroke width.
 * The padding ensures the drawn outline (which extends beyond the point coords
 * by ~strokeWidth/2) is fully enclosed.
 */
export function strokeBBox(stroke: Stroke): { x: number; y: number; w: number; h: number } {
  const { points, width, tool } = stroke;
  if (points.length === 0) return { x: 0, y: 0, w: 50, h: 50 };

  // Generous padding so round caps and thick markers are fully enclosed
  const pad = width * (tool === "marker" ? 8 : 4);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return {
    x: minX - pad,
    y: minY - pad,
    w: Math.max(10, maxX - minX + pad * 2),
    h: Math.max(10, maxY - minY + pad * 2),
  };
}

/**
 * Convert a raw Stroke into a StrokeElement ready to be added to the canvas.
 * The bounding box is computed once and stored as the origin for future transforms.
 */
export function strokeToElement(stroke: Stroke, zIndex: number): StrokeElement {
  const { x, y, w, h } = strokeBBox(stroke);
  return {
    type:    "stroke",
    id:      stroke.id,
    x, y, w, h,
    originX: x,
    originY: y,
    originW: w,
    originH: h,
    zIndex,
    stroke,
  };
}
