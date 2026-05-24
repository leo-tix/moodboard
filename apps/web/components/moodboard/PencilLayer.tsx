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
 * ── Performance architecture ───────────────────────────────────────────────────
 *  · committedCanvas  — all finished strokes.
 *                       Redraws use a Path2D CACHE so all geometry (Catmull-Rom,
 *                       smoothing, outline polygon) is computed ONCE at commit
 *                       time, not on every pan/zoom frame.
 *                       Each stroke = 1 ctx.fill() call (pen) or 1 ctx.stroke()
 *                       call (marker), regardless of point count.
 *  · liveCanvas       — current in-progress stroke (cleared/redrawn each rAF).
 *                       Uses a fast single-bezier preview (no smoothing, 1 draw
 *                       call).  Full quality kicks in when the stroke is committed.
 *  · Hover div        — cursor preview driven by React state (pointer pressure=0)
 */

import { useRef, useEffect, useLayoutEffect, useCallback, useState } from "react";
import type { PencilTool, StrokePoint, Stroke, StrokeElement } from "@/lib/moodboard/types";
import {
  buildCachedStroke,
  drawCachedStroke,
  drawStrokeLive,
  type CachedStroke,
} from "@/lib/moodboard/pencil";

// Re-export for consumers that import from this file
export type { PencilTool, StrokePoint, Stroke, StrokeElement };

interface Props {
  /** Whether drawing mode is active (pen events are captured) */
  active: boolean;
  pan: { x: number; y: number };
  zoom: number;
  tool: PencilTool;
  color: string;
  /** Base stroke width in canvas units */
  width: number;
  /** All committed stroke elements (replaces the old Stroke[] array) */
  strokeElements: StrokeElement[];
  /** Called when a new stroke is committed — parent converts to StrokeElement */
  onStrokeAdd: (stroke: Stroke) => void;
  /** Called continuously while eraser moves over the canvas */
  onEraseAt: (canvasX: number, canvasY: number, radius: number) => void;
  /**
   * Called when the Apple Pencil Pro barrel button / squeeze is detected.
   * Use this to toggle between the active tool and the eraser.
   */
  onToggleEraser: () => void;
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


/**
 * Redraw all committed stroke elements using pre-built Path2D cache.
 *
 * Each stroke element supports independent move/resize via a per-element
 * matrix transform derived from (x,y,w,h) vs (originX,originY,originW,originH).
 * The Path2D is built once at commit time and never invalidated on move/resize —
 * only the transform matrix changes.
 *
 * Each stroke = 1 ctx.fill() or 1 ctx.stroke() call regardless of point count.
 */
function redrawCommittedCanvas(
  canvas: HTMLCanvasElement,
  strokeElements: StrokeElement[],
  pan: { x: number; y: number },
  zoom: number,
  cache: Map<string, CachedStroke>,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx || canvas.width === 0) return;
  const dpr = window.devicePixelRatio || 1;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Prune stale cache entries (elements that were deleted by undo/erase)
  const currentIds = new Set(strokeElements.map((el) => el.stroke.id));
  for (const id of cache.keys()) {
    if (!currentIds.has(id)) cache.delete(id);
  }

  // Sort by zIndex so strokes respect layering order
  const sorted = [...strokeElements].sort((a, b) => a.zIndex - b.zIndex);

  for (const el of sorted) {
    const sid = el.stroke.id;
    // Lazy build: compute Path2D only on first draw after commit
    if (!cache.has(sid)) {
      cache.set(sid, buildCachedStroke(el.stroke));
    }

    // Per-element transform: scale from origin bbox, then apply pan+zoom
    // sx/sy handle resize; tx/ty handle move (after accounting for scale)
    const sx = el.originW > 0 ? el.w / el.originW : 1;
    const sy = el.originH > 0 ? el.h / el.originH : 1;
    const tx = el.x - el.originX * sx;
    const ty = el.y - el.originY * sy;
    ctx.setTransform(
      zoom * dpr * sx,
      0,
      0,
      zoom * dpr * sy,
      (pan.x + tx * zoom) * dpr,
      (pan.y + ty * zoom) * dpr,
    );

    drawCachedStroke(ctx, cache.get(sid)!);
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
  strokeElements,
  onStrokeAdd,
  onEraseAt,
  onToggleEraser,
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
  const strokeElementsRef = useRef(strokeElements);
  const activeRef         = useRef(active);
  const onToggleEraserRef = useRef(onToggleEraser);

  useEffect(() => { panRef.current              = pan;            }, [pan]);
  useEffect(() => { zoomRef.current             = zoom;           }, [zoom]);
  useEffect(() => { toolRef.current             = tool;           }, [tool]);
  useEffect(() => { colorRef.current            = color;          }, [color]);
  useEffect(() => { widthRef.current            = width;          }, [width]);
  useEffect(() => { strokeElementsRef.current   = strokeElements; }, [strokeElements]);
  useEffect(() => { activeRef.current           = active;         }, [active]);
  useEffect(() => { onToggleEraserRef.current   = onToggleEraser; }, [onToggleEraser]);

  const currentStroke  = useRef<Stroke | null>(null);
  const rafId          = useRef<number | null>(null);
  // Prevents the toggle firing multiple times per single Pencil Pro squeeze / double-tap
  const squeezeFiredRef = useRef(false);

  /**
   * Path2D cache: stroke.id → CachedStroke (pre-built outline polygon / bezier path).
   * Populated lazily in redrawCommittedCanvas; pruned when strokes are removed.
   * Avoids re-running Catmull-Rom + smoothing on every pan/zoom redraw.
   */
  const strokeCacheRef = useRef<Map<string, CachedStroke>>(new Map());

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
        redrawCommittedCanvas(committedRef.current, strokeElementsRef.current, panRef.current, zoomRef.current, strokeCacheRef.current);
      }
    });
    ro.observe(vp);
    return () => ro.disconnect();
  }, [viewportRef, resizeToViewport]);

  // ── Committed canvas redraw ──────────────────────────────────────────────
  // useLayoutEffect fires synchronously BEFORE the browser paint, in the same
  // cycle as React's DOM updates. This ensures the canvas and the DOM elements
  // (which also depend on pan/zoom) are painted together in one frame.
  // Using useEffect would fire AFTER paint: canvas lags 1 frame behind DOM → flicker.

  useLayoutEffect(() => {
    if (committedRef.current) {
      redrawCommittedCanvas(committedRef.current, strokeElements, pan, zoom, strokeCacheRef.current);
    }
  }, [strokeElements, pan, zoom]);

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
    // Fast preview path: single quadratic-bezier, 1 draw call, no heavy processing
    drawStrokeLive(ctx, currentStroke.current);
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

      // ── Toolbar interaction: let pencil tap toolbar buttons naturally ────
      // Don't intercept pointer events that target the drawing toolbar.
      if ((e.target as HTMLElement).closest('[data-role="pencil-toolbar"]')) return;

      // ── Apple Pencil Pro barrel / squeeze / double-tap button ────────────
      // Any non-primary button on a pen device triggers the eraser toggle.
      // Apple Pencil Pro squeeze fires as button 2 or 5 depending on
      // iPadOS/Safari version. Using e.button >= 1 catches all cases.
      if (e.button >= 1) {
        e.preventDefault();
        if (!squeezeFiredRef.current) {
          squeezeFiredRef.current = true;
          onToggleEraserRef.current();
          // Reset debounce after 600ms so rapid re-fires are treated as new events
          setTimeout(() => { squeezeFiredRef.current = false; }, 600);
        }
        return;
      }

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

      // Don't draw / show cursor when hovering over toolbar buttons
      if ((e.target as HTMLElement).closest('[data-role="pencil-toolbar"]')) {
        setHoverVP(null);
        return;
      }

      // ── Apple Pencil Pro double-tap (hover + side button) ─────────────────
      // Some iPadOS/Safari versions fire pointermove with pressure===0 and
      // e.buttons having a non-primary bit set when the double-tap gesture
      // is detected while the Pencil is hovering above the screen.
      if (e.pressure === 0 && e.buttons > 1) {
        e.preventDefault();
        if (!squeezeFiredRef.current) {
          squeezeFiredRef.current = true;
          onToggleEraserRef.current();
          setTimeout(() => { squeezeFiredRef.current = false; }, 600);
        }
        return;
      }

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
        // Pre-warm the cache synchronously before calling onStrokeAdd.
        // This way the Path2D is ready before the committed canvas redraws,
        // so the first post-commit redraw costs O(1) draw calls, not O(N_points).
        strokeCacheRef.current.set(stroke.id, buildCachedStroke(stroke));
        onStrokeAdd(stroke);
      }
    };

    const onPointerLeave = () => setHoverVP(null);

    // ── Apple Pencil Pro squeeze → contextmenu (Safari 17.4+) ───────────────
    // Starting with Safari 17.4 / iPadOS 17.4, the Apple Pencil Pro squeeze
    // gesture fires a `contextmenu` event on the target element.  We suppress
    // the browser menu and use it to toggle the eraser, same as the button
    // detection above.  Guard with activeRef so this only fires in drawing mode.
    const onContextMenuPen = (e: Event) => {
      if (!activeRef.current) return;
      e.preventDefault();
      if (!squeezeFiredRef.current) {
        squeezeFiredRef.current = true;
        onToggleEraserRef.current();
        setTimeout(() => { squeezeFiredRef.current = false; }, 600);
      }
    };

    vp.addEventListener("pointerdown",  onPointerDown,  { passive: false });
    vp.addEventListener("pointermove",  onPointerMove,  { passive: false });
    vp.addEventListener("pointerup",    onPointerUp);
    vp.addEventListener("pointercancel", onPointerUp);
    vp.addEventListener("pointerleave", onPointerLeave);
    vp.addEventListener("contextmenu",  onContextMenuPen);

    return () => {
      vp.removeEventListener("pointerdown",  onPointerDown);
      vp.removeEventListener("pointermove",  onPointerMove);
      vp.removeEventListener("pointerup",    onPointerUp);
      vp.removeEventListener("pointercancel", onPointerUp);
      vp.removeEventListener("pointerleave", onPointerLeave);
      vp.removeEventListener("contextmenu",  onContextMenuPen);
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
