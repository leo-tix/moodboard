"use client";

/**
 * PencilLayer — Apple Pencil drawing overlay for the moodboard canvas.
 *
 * Uses the Web PointerEvents API to capture Apple Pencil input:
 *  · pointerType === "pen"       → Pencil only (palm rejection built-in)
 *  · pressure                   → variable stroke width (0–1)
 *  · tiltX / tiltY              → brush angle (marker simulation)
 *  · twist                      → barrel rotation (Pencil Pro)
 *  · getCoalescedEvents()       → sub-frame accuracy for smooth curves
 *  · pressure === 0 (hover)     → cursor preview before contact
 *
 * NOTE: Apple PencilKit native brushes are not available in web browsers.
 * This layer implements custom pressure-sensitive brushes via Canvas 2D API.
 *
 * Architecture:
 *  · committedCanvas  — all finished strokes (redrawn on strokes/pan/zoom change)
 *  · liveCanvas       — current in-progress stroke (cleared/redrawn each frame)
 *  · Hover div        — cursor preview driven by React state (pointer pressure=0)
 */

import { useRef, useEffect, useCallback, useState } from "react";
import type { PencilTool, StrokePoint, Stroke } from "@/lib/moodboard/types";

// Re-export for consumers that import from this file
export type { PencilTool, StrokePoint, Stroke };

interface Props {
  /** Whether drawing mode is active (pen events are captured) */
  active: boolean;
  pan: { x: number; y: number };
  zoom: number;
  tool: PencilTool;
  color: string;
  /** Base stroke width in canvas units */
  width: number;
  strokes: Stroke[];
  onStrokeAdd: (stroke: Stroke) => void;
  /** Called continuously while eraser moves over the canvas */
  onEraseAt: (canvasX: number, canvasY: number, radius: number) => void;
  /** The viewport element to attach pointer listeners to */
  viewportRef: React.RefObject<HTMLDivElement | null>;
}

// ── Utilities ──────────────────────────────────────────────────────────────

/**
 * Round point values before storage to reduce JSON payload size.
 * x/y: integer (sub-pixel precision unnecessary for drawing)
 * pressure: 2 decimals (0.01 granularity sufficient for brush width)
 * tilt: integer degrees
 * Result: ~35 bytes/pt vs ~65 bytes/pt uncompressed (≈46% smaller)
 */
function compressPoint(pos: { x: number; y: number }, e: { pressure: number; tiltX?: number; tiltY?: number }) {
  return {
    x: Math.round(pos.x),
    y: Math.round(pos.y),
    pressure: Math.round((e.pressure || 0.5) * 100) / 100,
    tiltX: e.tiltX !== undefined ? Math.round(e.tiltX) : undefined,
    tiltY: e.tiltY !== undefined ? Math.round(e.tiltY) : undefined,
  };
}

function makeId() {
  return Math.random().toString(36).slice(2, 9);
}

/** Apply canvas transform (DPR + pan + zoom) to a 2D context. */
function applyCanvasTransform(
  ctx: CanvasRenderingContext2D,
  pan: { x: number; y: number },
  zoom: number,
  dpr: number,
) {
  ctx.setTransform(zoom * dpr, 0, 0, zoom * dpr, pan.x * dpr, pan.y * dpr);
}

/** Render a single stroke onto a canvas context (already transformed to canvas space). */
function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke) {
  const { points, tool, color, width } = stroke;
  if (points.length === 0) return;

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // ── Pen: pressure-sensitive variable-width segments ──────────────────────
  if (tool === "pen") {
    ctx.globalAlpha = 1;
    ctx.strokeStyle = color;

    if (points.length === 1) {
      // Single dot
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
      // Each segment drawn independently so lineWidth can vary with pressure
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

  // ── Marker: semi-transparent constant-width smooth bezier path ────────────
  } else if (tool === "marker") {
    // Draw the path first at full opacity, then composite at marker alpha.
    // Using a single path prevents opacity accumulation at stroke overlaps.
    ctx.globalAlpha = 0.38;
    ctx.strokeStyle = color;
    ctx.lineCap = "square";

    // Width scaled by tilt (flatter = wider, like a real marker nib)
    const tilt = points[0]?.tiltX ?? 0;
    const tiltScale = 1 + Math.abs(tilt) / 90;
    ctx.lineWidth = width * 5 * tiltScale;

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

  ctx.restore();
}

/** Redraw all strokes onto the committed canvas. */
function redrawCommittedCanvas(
  canvas: HTMLCanvasElement,
  strokes: Stroke[],
  pan: { x: number; y: number },
  zoom: number,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx || canvas.width === 0) return;
  const dpr = window.devicePixelRatio || 1;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  applyCanvasTransform(ctx, pan, zoom, dpr);
  for (const stroke of strokes) {
    drawStroke(ctx, stroke);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

// ── Component ──────────────────────────────────────────────────────────────

export function PencilLayer({
  active,
  pan,
  zoom,
  tool,
  color,
  width,
  strokes,
  onStrokeAdd,
  onEraseAt,
  viewportRef,
}: Props) {
  const committedRef = useRef<HTMLCanvasElement>(null);
  const liveRef      = useRef<HTMLCanvasElement>(null);

  // Stable refs so event handlers always see the latest values without
  // being recreated (avoids removing/re-adding listeners on every render).
  const panRef     = useRef(pan);
  const zoomRef    = useRef(zoom);
  const toolRef    = useRef(tool);
  const colorRef   = useRef(color);
  const widthRef   = useRef(width);
  const strokesRef = useRef(strokes);
  const activeRef  = useRef(active);

  useEffect(() => { panRef.current    = pan;     }, [pan]);
  useEffect(() => { zoomRef.current   = zoom;    }, [zoom]);
  useEffect(() => { toolRef.current   = tool;    }, [tool]);
  useEffect(() => { colorRef.current  = color;   }, [color]);
  useEffect(() => { widthRef.current  = width;   }, [width]);
  useEffect(() => { strokesRef.current = strokes; }, [strokes]);
  useEffect(() => { activeRef.current  = active;  }, [active]);

  const currentStroke  = useRef<Stroke | null>(null);
  const rafId          = useRef<number | null>(null);

  // Hover cursor state: viewport coords (already offset by rect)
  const [hoverVP, setHoverVP] = useState<{ vx: number; vy: number } | null>(null);

  // ── Canvas resize ────────────────────────────────────────────────────────

  const resizeToViewport = useCallback(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const { width: w, height: h } = vp.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    for (const canvas of [committedRef.current, liveRef.current]) {
      if (!canvas) continue;
      canvas.width  = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width  = `${w}px`;
      canvas.style.height = `${h}px`;
    }
  }, [viewportRef]);

  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    resizeToViewport();
    const ro = new ResizeObserver(() => {
      resizeToViewport();
      // Redraw after resize
      if (committedRef.current) {
        redrawCommittedCanvas(committedRef.current, strokesRef.current, panRef.current, zoomRef.current);
      }
    });
    ro.observe(vp);
    return () => ro.disconnect();
  }, [viewportRef, resizeToViewport]);

  // ── Committed canvas redraw ──────────────────────────────────────────────

  useEffect(() => {
    if (committedRef.current) {
      redrawCommittedCanvas(committedRef.current, strokes, pan, zoom);
    }
  }, [strokes, pan, zoom]);

  // ── Live canvas helpers (rAF-throttled) ──────────────────────────────────

  const redrawLive = useCallback(() => {
    rafId.current = null;
    const canvas = liveRef.current;
    if (!canvas || canvas.width === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!currentStroke.current) return;
    applyCanvasTransform(ctx, panRef.current, zoomRef.current, dpr);
    drawStroke(ctx, currentStroke.current);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }, []);

  const scheduleLiveRedraw = useCallback(() => {
    if (!rafId.current) {
      rafId.current = requestAnimationFrame(redrawLive);
    }
  }, [redrawLive]);

  // ── Pointer event listeners ──────────────────────────────────────────────

  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;

    /** Convert client coords → moodboard canvas coords */
    const toCanvas = (clientX: number, clientY: number) => {
      const rect = vp.getBoundingClientRect();
      return {
        x: (clientX - rect.left  - panRef.current.x) / zoomRef.current,
        y: (clientY - rect.top   - panRef.current.y) / zoomRef.current,
      };
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== "pen") return;
      if (!activeRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      vp.setPointerCapture(e.pointerId);
      setHoverVP(null);

      const pos = toCanvas(e.clientX, e.clientY);

      if (toolRef.current === "eraser") {
        const radius = (widthRef.current * 20) / zoomRef.current;
        onEraseAt(pos.x, pos.y, radius);
        return;
      }

      currentStroke.current = {
        id: makeId(),
        tool:  toolRef.current,
        color: colorRef.current,
        width: widthRef.current,
        points: [compressPoint(pos, e)],
      };
      scheduleLiveRedraw();
    };

    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType !== "pen") return;
      if (!activeRef.current) return;

      // Hover (pencil above surface, not touching)
      if (e.pressure === 0) {
        const rect = vp.getBoundingClientRect();
        setHoverVP({ vx: e.clientX - rect.left, vy: e.clientY - rect.top });
        return;
      }

      setHoverVP(null);
      e.preventDefault();

      if (toolRef.current === "eraser") {
        const pos = toCanvas(e.clientX, e.clientY);
        const radius = (widthRef.current * 20) / zoomRef.current;
        onEraseAt(pos.x, pos.y, radius);
        return;
      }

      if (!currentStroke.current) return;

      // getCoalescedEvents() gives sub-frame accuracy (higher point density)
      const evts: PointerEvent[] = e.getCoalescedEvents
        ? e.getCoalescedEvents()
        : [e];

      for (const ev of evts) {
        const pos = toCanvas(ev.clientX, ev.clientY);
        currentStroke.current.points.push(compressPoint(pos, ev));
      }

      scheduleLiveRedraw();
    };

    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerType !== "pen") return;
      setHoverVP(null);

      const stroke = currentStroke.current;
      currentStroke.current = null;

      // Clear live canvas
      const live = liveRef.current;
      if (live) {
        live.getContext("2d")?.clearRect(0, 0, live.width, live.height);
      }

      if (stroke && stroke.points.length > 0 && stroke.tool !== "eraser") {
        onStrokeAdd(stroke);
      }
    };

    const onPointerLeave = () => setHoverVP(null);

    vp.addEventListener("pointerdown",  onPointerDown,  { passive: false });
    vp.addEventListener("pointermove",  onPointerMove,  { passive: false });
    vp.addEventListener("pointerup",    onPointerUp);
    vp.addEventListener("pointercancel", onPointerUp);
    vp.addEventListener("pointerleave", onPointerLeave);

    return () => {
      vp.removeEventListener("pointerdown",  onPointerDown);
      vp.removeEventListener("pointermove",  onPointerMove);
      vp.removeEventListener("pointerup",    onPointerUp);
      vp.removeEventListener("pointercancel", onPointerUp);
      vp.removeEventListener("pointerleave", onPointerLeave);
    };
  }, [viewportRef, onStrokeAdd, onEraseAt, scheduleLiveRedraw]);

  // ── Eraser cursor size in viewport pixels ────────────────────────────────
  const eraserRadius = widthRef.current * 20; // approx viewport px

  return (
    <>
      {/* Committed strokes */}
      <canvas
        ref={committedRef}
        className="absolute inset-0 pointer-events-none"
        style={{ zIndex: 148 }}
      />
      {/* Live (in-progress) stroke — only visible while drawing */}
      <canvas
        ref={liveRef}
        className="absolute inset-0 pointer-events-none"
        style={{ zIndex: 149 }}
      />
      {/* Hover cursor — shown when Pencil is hovering above screen */}
      {hoverVP && active && (
        <div
          className="absolute pointer-events-none"
          style={{
            zIndex: 150,
            left: hoverVP.vx,
            top:  hoverVP.vy,
            transform: "translate(-50%, -50%)",
          }}
        >
          {tool === "eraser" ? (
            // Eraser: larger hollow circle
            <div
              style={{
                width:  eraserRadius * 2,
                height: eraserRadius * 2,
                borderRadius: "50%",
                border: "1.5px solid rgba(255,255,255,0.7)",
                boxShadow: "0 0 0 1px rgba(0,0,0,0.4)",
              }}
            />
          ) : (
            // Pen/marker: small dot with tool color
            <div
              style={{
                width:  tool === "marker" ? width * zoom * 5 : width * zoom,
                height: tool === "marker" ? width * zoom * 5 : width * zoom,
                borderRadius: "50%",
                backgroundColor: color,
                opacity: tool === "marker" ? 0.4 : 0.85,
                border: "1px solid rgba(255,255,255,0.5)",
                boxShadow: "0 0 0 1px rgba(0,0,0,0.3)",
              }}
            />
          )}
        </div>
      )}
    </>
  );
}
