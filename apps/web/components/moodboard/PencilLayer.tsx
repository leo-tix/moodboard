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
  detectShape,
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
  /** Called once when the erasing gesture ends (pencil lift) — use to push history */
  onEraseEnd?: () => void;
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

  // Prune stale cache entries (key = stroke id)
  const currentIds = new Set(strokeElements.map((el) => el.stroke.id));
  for (const key of cache.keys()) {
    if (!currentIds.has(key)) cache.delete(key);
  }

  // Visible region in canvas coordinates — used for viewport culling below.
  // Small padding avoids edge-popping when a stroke's bbox grazes the viewport.
  const PAD   = 64;
  const vpW   = canvas.width  / dpr;
  const vpH   = canvas.height / dpr;
  const visX1 = (-pan.x - PAD) / zoom;
  const visY1 = (-pan.y - PAD) / zoom;
  const visX2 = (vpW - pan.x + PAD) / zoom;
  const visY2 = (vpH - pan.y + PAD) / zoom;

  // Sort by zIndex so strokes respect layering order
  const sorted = [...strokeElements].sort((a, b) => a.zIndex - b.zIndex);

  for (const el of sorted) {
    // Viewport culling: skip strokes whose bbox is entirely outside the visible region.
    if (el.x + el.w < visX1 || el.x > visX2 || el.y + el.h < visY1 || el.y > visY2) continue;

    if (!cache.has(el.stroke.id)) {
      cache.set(el.stroke.id, buildCachedStroke(el.stroke, 0));
    }

    // Per-element transform: scale from origin bbox, then apply pan+zoom
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

    drawCachedStroke(ctx, cache.get(el.stroke.id)!);
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
  onEraseEnd,
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
  const onEraseEndRef     = useRef(onEraseEnd);

  useEffect(() => { panRef.current              = pan;            }, [pan]);
  useEffect(() => { zoomRef.current             = zoom;           }, [zoom]);
  useEffect(() => { toolRef.current             = tool;           }, [tool]);
  useEffect(() => { colorRef.current            = color;          }, [color]);
  useEffect(() => { widthRef.current            = width;          }, [width]);
  useEffect(() => { strokeElementsRef.current   = strokeElements; }, [strokeElements]);
  useEffect(() => { activeRef.current           = active;         }, [active]);
  useEffect(() => { onToggleEraserRef.current   = onToggleEraser; }, [onToggleEraser]);
  useEffect(() => { onEraseEndRef.current       = onEraseEnd;     }, [onEraseEnd]);

  const currentStroke    = useRef<Stroke | null>(null);
  const rafId            = useRef<number | null>(null);   // live canvas rAF
  const committedRafRef  = useRef<number | null>(null);   // committed canvas rAF
  // Prevents the toggle firing multiple times per single Pencil Pro squeeze / double-tap
  const squeezeFiredRef = useRef(false);
  // Shape hold-to-snap: timer fires after 600ms stationary, snappedRef prevents double-commit
  const shapeHoldTimerRef = useRef<number | null>(null);
  const snappedRef        = useRef(false);
  // Toolbar tap via Pencil: track the element where pointerdown landed so we can
  // fire a synthetic click on pointerup (browser click synthesis can be unreliable
  // for pen events inside a viewport with touch-action:none / preventDefault calls).
  const penToolbarDownRef = useRef<HTMLElement | null>(null);

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
  //
  // Strategy: rAF-throttled useEffect.
  //
  // • useEffect (not useLayoutEffect): avoids blocking the main thread before
  //   every paint. useLayoutEffect ran synchronously on every pan event and
  //   stalled the frame budget with many strokes.
  //
  // • rAF coalescing: if multiple React renders happen inside one frame (rapid
  //   pan events), we cancel the pending rAF and reschedule — so only ONE
  //   redraw fires per frame, always with the freshest pan/zoom/strokes via refs.
  //
  // • Cache pre-warming: build Path2D for any new stroke BEFORE the rAF fires
  //   so redrawCommittedCanvas never has to run buildCachedStroke mid-draw.

  // ── Bitmap-cache pan + zoom (Excalidraw technique) ───────────────────────
  //
  // For BOTH pan and zoom we instantly apply a CSS matrix() to the committed
  // canvas (GPU composite, zero Path2D work). The bitmap is approximate until
  // a proper redraw fires:
  //
  // • Zoom → debounce 80 ms. The smooth-zoom rAF lerp fires many frames;
  //   the settle timer keeps resetting and fires once after the animation ends.
  //   No conflict with smooth zoom: the CSS transform tracks each lerp step.
  //
  // • Pan only (s = 1) → redraw next rAF (~16 ms). CSS translate lasts ≤ 1
  //   frame so edge exposure is at most ~10–15 px — imperceptible.
  //
  // • New stroke → immediate redraw, abort settle timer.
  const renderedZoomRef       = useRef(zoom);
  const renderedPanRef        = useRef({ x: pan.x, y: pan.y });
  const zoomSettleRef         = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevStrokeElementsRef = useRef(strokeElements);

  useLayoutEffect(() => {
    const strokesChanged = strokeElements !== prevStrokeElementsRef.current;
    prevStrokeElementsRef.current = strokeElements;

    // Pre-warm cache only when strokes actually changed (not on every pan/zoom frame)
    if (strokesChanged) {
      for (const el of strokeElements) {
        if (!strokeCacheRef.current.has(el.stroke.id)) {
          strokeCacheRef.current.set(el.stroke.id, buildCachedStroke(el.stroke, 0));
        }
      }
    }

    // Helper: clear CSS transform, re-render at current pan/zoom, update refs.
    const doFullRedraw = () => {
      if (committedRafRef.current !== null) cancelAnimationFrame(committedRafRef.current);
      committedRafRef.current = requestAnimationFrame(() => {
        committedRafRef.current = null;
        const c = committedRef.current;
        if (!c) return;
        c.style.transform       = "";
        c.style.transformOrigin = "";
        redrawCommittedCanvas(c, strokeElementsRef.current, panRef.current, zoomRef.current, strokeCacheRef.current);
        renderedZoomRef.current = zoomRef.current;
        renderedPanRef.current  = { x: panRef.current.x, y: panRef.current.y };
      });
    };

    if (strokesChanged) {
      // New stroke: must appear immediately — abort any pending zoom settle.
      if (zoomSettleRef.current) { clearTimeout(zoomSettleRef.current); zoomSettleRef.current = null; }
      doFullRedraw();
      return () => {
        if (committedRafRef.current !== null) { cancelAnimationFrame(committedRafRef.current); committedRafRef.current = null; }
      };
    }

    // Apply CSS matrix() immediately for any pan/zoom change (GPU, no redraw cost).
    // Math: maps every pixel rendered at (z0, p0) to its new screen position at (zoom, pan).
    //   s  = zoom / z0          (scale ratio — equals 1 for pan-only)
    //   tx = pan.x − p0.x × s  (translation that absorbs both the new pan and the scale shift)
    const z0 = renderedZoomRef.current;
    const p0 = renderedPanRef.current;
    const s  = zoom / z0;
    const tx = pan.x - p0.x * s;
    const ty = pan.y - p0.y * s;
    const canvas = committedRef.current;
    if (canvas) {
      canvas.style.transformOrigin = "0 0";
      canvas.style.transform = `matrix(${s},0,0,${s},${tx},${ty})`;
    }

    const zoomChanged = Math.abs(zoom - z0) > 1e-6;
    if (zoomChanged) {
      // Zoom: debounce 50 ms — smooth-zoom lerp fires many frames in a row.
      if (zoomSettleRef.current) clearTimeout(zoomSettleRef.current);
      zoomSettleRef.current = setTimeout(() => {
        zoomSettleRef.current = null;
        doFullRedraw();
      }, 50);
    } else {
      // Pan only (s = 1): schedule full redraw on next rAF — CSS translate lasts ≤ 1 frame.
      doFullRedraw();
    }

    return () => {
      if (zoomSettleRef.current) { clearTimeout(zoomSettleRef.current); zoomSettleRef.current = null; }
      if (committedRafRef.current !== null) { cancelAnimationFrame(committedRafRef.current); committedRafRef.current = null; }
    };
  // useLayoutEffect (not useEffect): fires synchronously before the browser paints,
  // so the CSS matrix() transform is visible in the *same* frame as the React render.
  // The body is O(1) (style.transform write + rAF schedule) — no stall risk.
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

      // ── Toolbar interaction: pencil tap on toolbar buttons ──────────────
      // Browser click synthesis for pen events inside a touch-action:none viewport
      // can be unreliable on iPadOS Safari. We take over: preventDefault to suppress
      // the native click, store the target, and fire a synthetic MouseEvent on pointerup.
      if ((e.target as HTMLElement).closest('[data-role="pencil-toolbar"]')) {
        penToolbarDownRef.current = e.target as HTMLElement;
        e.preventDefault(); // suppress browser click synthesis; we'll fire it manually
        return;
      }
      penToolbarDownRef.current = null;

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

      // ── Shape hold-to-snap ──────────────────────────────────────────────────
      // If the pencil stays stationary (< 3px movement) for 600ms at the end of
      // a stroke, detect a geometric shape and snap to it.
      const pts = currentStroke.current.points;
      if (pts.length >= 2) {
        const last = pts[pts.length - 1];
        const prev = pts[pts.length - 2];
        if (Math.hypot(last.x - prev.x, last.y - prev.y) < 3) {
          if (shapeHoldTimerRef.current === null) {
            shapeHoldTimerRef.current = window.setTimeout(() => {
              shapeHoldTimerRef.current = null;
              const stroke = currentStroke.current;
              if (!stroke || stroke.points.length < 4) return;
              const detected = detectShape(stroke);
              if (!detected) return; // ambiguous — let user lift normally
              const shaped: Stroke = { ...stroke, points: detected.points };
              // Clear live canvas immediately
              const lc = liveRef.current;
              if (lc) lc.getContext("2d")?.clearRect(0, 0, lc.width, lc.height);
              // Pre-warm cache then commit (committed canvas redraws on next rAF)
              strokeCacheRef.current.set(shaped.id, buildCachedStroke(shaped, 0));
              onStrokeAdd(shaped);
              currentStroke.current = null;
              snappedRef.current = true;
            }, 600);
          }
        } else if (shapeHoldTimerRef.current !== null) {
          clearTimeout(shapeHoldTimerRef.current);
          shapeHoldTimerRef.current = null;
        }
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerType !== "pen") return;
      setHoverVP(null);

      // ── Toolbar tap: fire synthetic click on the button/label ────────────
      // pointerdown on toolbar called preventDefault, so we dispatch the click here.
      const toolbarDown = penToolbarDownRef.current;
      penToolbarDownRef.current = null;
      if (toolbarDown) {
        // Only fire if pen is still inside the toolbar on pointerup
        if ((e.target as HTMLElement).closest('[data-role="pencil-toolbar"]')) {
          const interactive = toolbarDown.closest('button, label') as HTMLElement | null;
          if (interactive) interactive.click();
        }
        return;
      }

      // Cancel any pending shape-hold timer
      if (shapeHoldTimerRef.current !== null) {
        clearTimeout(shapeHoldTimerRef.current);
        shapeHoldTimerRef.current = null;
      }

      // Shape was already committed during the hold — pencil-up is a no-op
      if (snappedRef.current) {
        snappedRef.current = false;
        return;
      }

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
        strokeCacheRef.current.set(stroke.id, buildCachedStroke(stroke, 0));
        onStrokeAdd(stroke);
      } else if (toolRef.current === "eraser") {
        // Eraser gesture ended — signal parent to push one history entry
        onEraseEndRef.current?.();
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
