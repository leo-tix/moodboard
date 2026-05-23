"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { getImageUrl } from "@/lib/storage/urls";
import type {
  CanvasElement,
  ImageElement,
  TextElement,
  ColorElement,
  StickyElement,
  StrokeElement,
} from "@/lib/moodboard/types";
import { buildCachedStroke, drawCachedStroke } from "@/lib/moodboard/pencil";

interface Props {
  data: {
    id: string;
    title: string;
    canvasData: CanvasElement[];
    background: string;
  };
}

// ── Constants ─────────────────────────────────────────────────────────────────

const GRID_PX = 24;
const ZOOM_MIN = 0.05;
const ZOOM_MAX = 5;

// Custom crosshair cursor — same visual as the editor so external users see a
// consistent, design-tool-like cursor on the canvas background.
const CURSOR_CROSSHAIR_CSS = (() => {
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20">',
    '<circle cx="10" cy="10" r="4.5" fill="none" stroke="rgba(0,0,0,0.5)" stroke-width="3"/>',
    '<circle cx="10" cy="10" r="1.5" fill="rgba(0,0,0,0.4)"/>',
    '<line x1="10" y1="1" x2="10" y2="5.5" stroke="rgba(0,0,0,0.5)" stroke-width="2.5"/>',
    '<line x1="10" y1="14.5" x2="10" y2="19" stroke="rgba(0,0,0,0.5)" stroke-width="2.5"/>',
    '<line x1="1" y1="10" x2="5.5" y2="10" stroke="rgba(0,0,0,0.5)" stroke-width="2.5"/>',
    '<line x1="14.5" y1="10" x2="19" y2="10" stroke="rgba(0,0,0,0.5)" stroke-width="2.5"/>',
    '<circle cx="10" cy="10" r="4.5" fill="none" stroke="white" stroke-width="1.4"/>',
    '<circle cx="10" cy="10" r="1.5" fill="white"/>',
    '<line x1="10" y1="1" x2="10" y2="5.5" stroke="white" stroke-width="1.2"/>',
    '<line x1="10" y1="14.5" x2="10" y2="19" stroke="white" stroke-width="1.2"/>',
    '<line x1="1" y1="10" x2="5.5" y2="10" stroke="white" stroke-width="1.2"/>',
    '<line x1="14.5" y1="10" x2="19" y2="10" stroke="white" stroke-width="1.2"/>',
    '</svg>',
  ].join('');
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 10 10, crosshair`;
})();

// ── Navigation guide content ──────────────────────────────────────────────────

const GUIDE_ROWS: [string, string][] = [
  ["1 doigt · Glisser", "Déplacer la vue"],
  ["2 doigts · Pincer", "Zoom avant / arrière"],
  ["2 doigts · Glisser", "Déplacer la vue"],
  ["Molette / Trackpad", "Déplacer · Ctrl+molette = zoom"],
  ["F", "Tout afficher"],
];

// ── Navigation Guide ──────────────────────────────────────────────────────────

function NavigationGuide({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="absolute bottom-16 left-4 z-50 w-72 bg-[var(--bg-elevated)]/96 backdrop-blur border border-[var(--border-default)] rounded-xl shadow-2xl overflow-hidden"
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--border-subtle)]">
        <div className="flex items-center gap-2">
          {/* Compass icon */}
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="text-[var(--accent,#a78bfa)]">
            <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.3"/>
            <path d="M7 4L8.5 7H5.5L7 4Z" fill="currentColor"/>
            <path d="M7 10L5.5 7H8.5L7 10Z" fill="currentColor" opacity="0.4"/>
          </svg>
          <span className="text-[11px] font-medium text-[var(--text-secondary)] tracking-wide uppercase">
            Navigation
          </span>
        </div>
        <button
          onClick={onClose}
          className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors text-xs leading-none"
          title="Fermer"
        >
          ✕
        </button>
      </div>

      {/* Rows */}
      <div className="py-1">
        {GUIDE_ROWS.map(([kbd, desc], i) => (
          <div key={i} className="flex items-center justify-between px-4 py-1.5 gap-3">
            <span className="text-[11px] text-[var(--text-secondary)] flex-1 min-w-0">{desc}</span>
            <kbd className="flex-shrink-0 text-[10px] text-[var(--text-tertiary)] bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded px-1.5 py-0.5 font-mono whitespace-nowrap">
              {kbd}
            </kbd>
          </div>
        ))}
      </div>

      {/* Footer hint */}
      <div className="border-t border-[var(--border-subtle)] px-4 py-2 flex items-center justify-between">
        <span className="text-[10px] text-[var(--text-tertiary)]">Vue en lecture seule</span>
        <button
          onClick={onClose}
          className="text-[10px] text-[var(--accent,#a78bfa)] hover:opacity-80 transition-opacity"
        >
          Compris →
        </button>
      </div>
    </div>
  );
}

// ── Stroke canvas overlay ─────────────────────────────────────────────────────
// Renders all StrokeElements onto an offscreen canvas that is positioned exactly
// over the viewport.  Uses the same per-element matrix transform as PencilLayer
// so stroke positions match perfectly.

function StrokeCanvas({
  strokeElements,
  pan,
  zoom,
}: {
  strokeElements: StrokeElement[];
  pan: { x: number; y: number };
  zoom: number;
}) {
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const cacheRef   = useRef(new Map<string, ReturnType<typeof buildCachedStroke>>());

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;

    const dpr = window.devicePixelRatio || 1;

    const draw = () => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const sorted = [...strokeElements].sort((a, b) => a.zIndex - b.zIndex);
      for (const el of sorted) {
        const sid = el.stroke.id;
        if (!cacheRef.current.has(sid)) {
          cacheRef.current.set(sid, buildCachedStroke(el.stroke));
        }
        const cached = cacheRef.current.get(sid)!;

        const sx = el.originW > 0 ? el.w / el.originW : 1;
        const sy = el.originH > 0 ? el.h / el.originH : 1;
        const tx = el.x - el.originX * sx;
        const ty = el.y - el.originY * sy;

        ctx.save();
        ctx.globalAlpha = el.opacity ?? 1;
        ctx.setTransform(
          zoom * dpr * sx, 0,
          0, zoom * dpr * sy,
          (pan.x + tx * zoom) * dpr,
          (pan.y + ty * zoom) * dpr,
        );
        drawCachedStroke(ctx, cached);
        ctx.restore();
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    };

    const resize = () => {
      const w = parent.clientWidth;
      const h = parent.clientHeight;
      canvas.width  = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width  = `${w}px`;
      canvas.style.height = `${h}px`;
      draw();
    };

    const ro = new ResizeObserver(resize);
    ro.observe(parent);
    resize();

    return () => ro.disconnect();
  }, [strokeElements, pan, zoom]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 pointer-events-none"
      style={{ zIndex: 148 }}
    />
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function MoodboardViewer({ data }: Props) {
  const viewportRef = useRef<HTMLDivElement>(null);

  // ── Visual state ──
  const [pan,  setPan]  = useState({ x: 80, y: 60 });
  const [zoom, setZoom] = useState(1);
  const [cursor, setCursor] = useState("default");
  const [showGuide, setShowGuide] = useState(true);
  const [isTouchDevice, setIsTouchDevice] = useState(false);

  // ── Stable refs (event handlers must not capture stale state) ──
  const panRef  = useRef({ x: 80, y: 60 });
  const zoomRef = useRef(1);
  const isSpaceDown   = useRef(false);
  const isPanningRef  = useRef(false);
  const panStart      = useRef({ x: 0, y: 0 });
  const panOrigin     = useRef({ x: 0, y: 0 });

  // ── Smooth zoom (identical rAF lerp system as the editor) ──
  const zoomTargetRef = useRef(1);
  const panTargetRef  = useRef<{ x: number; y: number }>({ x: 80, y: 60 });
  const zoomRafRef    = useRef<number | null>(null);
  const zoomStepFnRef = useRef<() => void>(() => {});

  // Re-assigned every render so rAF always calls the latest version.
  zoomStepFnRef.current = () => {
    const L  = 0.22;
    const tz = zoomTargetRef.current;
    const tp = panTargetRef.current;
    const cz = zoomRef.current;
    const cp = panRef.current;
    const nz  = cz + (tz - cz) * L;
    const npx = cp.x + (tp.x - cp.x) * L;
    const npy = cp.y + (tp.y - cp.y) * L;
    const done = Math.abs(nz - tz) < 0.0008 && Math.abs(npx - tp.x) < 0.2 && Math.abs(npy - tp.y) < 0.2;
    const fz  = done ? tz : nz;
    const fpx = done ? tp.x : npx;
    const fpy = done ? tp.y : npy;
    zoomRef.current = fz;
    panRef.current  = { x: fpx, y: fpy };
    setZoom(fz);
    setPan({ x: fpx, y: fpy });
    zoomRafRef.current = done ? null : requestAnimationFrame(() => zoomStepFnRef.current());
  };

  const kickZoomAnimation = useCallback(() => {
    if (zoomRafRef.current === null) {
      zoomRafRef.current = requestAnimationFrame(() => zoomStepFnRef.current());
    }
  }, []);

  const applyZoom = useCallback((newZoom: number, pivotX: number, pivotY: number) => {
    const cz = zoomRef.current;
    const cp = panRef.current;
    const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, newZoom));
    const canvasX = (pivotX - cp.x) / cz;
    const canvasY = (pivotY - cp.y) / cz;
    zoomTargetRef.current = clamped;
    panTargetRef.current  = { x: pivotX - canvasX * clamped, y: pivotY - canvasY * clamped };
    kickZoomAnimation();
  }, [kickZoomAnimation]);

  const zoomToFit = useCallback(() => {
    const vp = viewportRef.current;
    if (!vp || data.canvasData.length === 0) return;
    const { width, height } = vp.getBoundingClientRect();
    const minX = Math.min(...data.canvasData.map((el) => el.x));
    const minY = Math.min(...data.canvasData.map((el) => el.y));
    const maxX = Math.max(...data.canvasData.map((el) => el.x + el.w));
    const maxY = Math.max(...data.canvasData.map((el) => el.y + el.h));
    const bw   = maxX - minX;
    const bh   = maxY - minY;
    const PAD  = 80;
    const newZoom = Math.min(
      ZOOM_MAX, Math.max(ZOOM_MIN,
        Math.min((width - PAD * 2) / Math.max(1, bw), (height - PAD * 2) / Math.max(1, bh))
      )
    );
    zoomTargetRef.current = newZoom;
    panTargetRef.current  = {
      x: (width  - bw * newZoom) / 2 - minX * newZoom,
      y: (height - bh * newZoom) / 2 - minY * newZoom,
    };
    kickZoomAnimation();
  }, [data.canvasData, kickZoomAnimation]);

  // ── Cancel rAF on unmount ──
  useEffect(() => {
    return () => { if (zoomRafRef.current !== null) cancelAnimationFrame(zoomRafRef.current); };
  }, []);

  // ── Touch device detection ──
  useEffect(() => {
    setIsTouchDevice(navigator.maxTouchPoints > 1);
  }, []);

  // ── Block native HTML5 drag on images (prevents freeze) ──
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const prevent = (e: DragEvent) => e.preventDefault();
    vp.addEventListener("dragstart", prevent, true);
    return () => vp.removeEventListener("dragstart", prevent, true);
  }, []);

  // ── Auto zoom-to-fit on mount ──
  const didFitRef = useRef(false);
  useEffect(() => {
    if (didFitRef.current) return;
    didFitRef.current = true;
    // Wait one tick so getBoundingClientRect() returns actual dimensions.
    const t = setTimeout(zoomToFit, 60);
    return () => clearTimeout(t);
  }, [zoomToFit]);

  // ── Wheel handler (must be non-passive to call preventDefault) ──
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = viewport.getBoundingClientRect();
      const px   = e.clientX - rect.left;
      const py   = e.clientY - rect.top;

      if (e.ctrlKey || e.metaKey) {
        // Pinch-to-zoom (trackpad) or Ctrl+scroll (mouse wheel)
        const factor   = e.deltaY > 0 ? 0.92 : 1.08;
        const newTarget = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoomTargetRef.current * factor));
        const cz = zoomRef.current;
        const cp = panRef.current;
        const canvasX  = (px - cp.x) / cz;
        const canvasY  = (py - cp.y) / cz;
        zoomTargetRef.current = newTarget;
        panTargetRef.current  = { x: px - canvasX * newTarget, y: py - canvasY * newTarget };
        kickZoomAnimation();
      } else {
        // Scroll → pan (direct, no lerp for trackpad responsiveness)
        const np = { x: panRef.current.x - e.deltaX, y: panRef.current.y - e.deltaY };
        panTargetRef.current = np;
        setPan(np);
        panRef.current = np;
      }
    };

    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", onWheel);
  }, [kickZoomAnimation]);

  // ── Touch gestures (iPad / iPhone) ──
  // Viewer is read-only: every 1-finger drag pans, 2-finger pinch zooms + translates.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const touchPanRef   = { current: null as { startX: number; startY: number; originX: number; originY: number } | null };
    const pinchRef      = { current: null as { startDist: number; startZoom: number; startMidViewX: number; startMidViewY: number; originPanX: number; originPanY: number } | null };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        touchPanRef.current = null;
        const t0 = e.touches[0], t1 = e.touches[1];
        const dx = t0.clientX - t1.clientX, dy = t0.clientY - t1.clientY;
        const rect = viewport.getBoundingClientRect();
        pinchRef.current = {
          startDist    : Math.sqrt(dx * dx + dy * dy),
          startZoom    : zoomRef.current,
          startMidViewX: (t0.clientX + t1.clientX) / 2 - rect.left,
          startMidViewY: (t0.clientY + t1.clientY) / 2 - rect.top,
          originPanX   : panRef.current.x,
          originPanY   : panRef.current.y,
        };
        return;
      }
      if (e.touches.length === 1) {
        e.preventDefault();
        pinchRef.current = null;
        const touch = e.touches[0];
        touchPanRef.current = {
          startX : touch.clientX,
          startY : touch.clientY,
          originX: panRef.current.x,
          originY: panRef.current.y,
        };
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && pinchRef.current) {
        e.preventDefault();
        const p  = pinchRef.current;
        const t0 = e.touches[0], t1 = e.touches[1];
        const dx = t0.clientX - t1.clientX, dy = t0.clientY - t1.clientY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const rect = viewport.getBoundingClientRect();
        const curMidX = (t0.clientX + t1.clientX) / 2 - rect.left;
        const curMidY = (t0.clientY + t1.clientY) / 2 - rect.top;

        const newZoom  = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, p.startZoom * (dist / p.startDist)));
        const canvasMidX = (p.startMidViewX - p.originPanX) / p.startZoom;
        const canvasMidY = (p.startMidViewY - p.originPanY) / p.startZoom;
        const newPanX = curMidX - canvasMidX * newZoom;
        const newPanY = curMidY - canvasMidY * newZoom;

        zoomRef.current       = newZoom;
        panRef.current        = { x: newPanX, y: newPanY };
        zoomTargetRef.current  = newZoom;
        panTargetRef.current   = { x: newPanX, y: newPanY };
        setZoom(newZoom);
        setPan({ x: newPanX, y: newPanY });
        return;
      }
      if (e.touches.length === 1 && touchPanRef.current) {
        e.preventDefault();
        const touch = e.touches[0];
        const p  = touchPanRef.current;
        const np = { x: p.originX + (touch.clientX - p.startX), y: p.originY + (touch.clientY - p.startY) };
        setPan(np);
        panRef.current       = np;
        panTargetRef.current  = np;
      }
    };

    const onTouchEnd = () => { touchPanRef.current = null; pinchRef.current = null; };

    viewport.addEventListener("touchstart",  onTouchStart,  { passive: false });
    viewport.addEventListener("touchmove",   onTouchMove,   { passive: false });
    viewport.addEventListener("touchend",    onTouchEnd);
    viewport.addEventListener("touchcancel", onTouchEnd);
    return () => {
      viewport.removeEventListener("touchstart",  onTouchStart);
      viewport.removeEventListener("touchmove",   onTouchMove);
      viewport.removeEventListener("touchend",    onTouchEnd);
      viewport.removeEventListener("touchcancel", onTouchEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Keyboard shortcuts ──
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const inInput = (e.target as HTMLElement).tagName === "INPUT"
        || (e.target as HTMLElement).tagName === "TEXTAREA"
        || (e.target as HTMLElement).isContentEditable;
      if (inInput) return;

      // Space → grab mode
      if (e.code === "Space") {
        e.preventDefault();
        isSpaceDown.current = true;
        if (!isPanningRef.current) setCursor("grab");
        return;
      }

      // F → zoom to fit
      if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        zoomToFit();
        return;
      }

      // Arrow keys → pan
      if (e.key.startsWith("Arrow")) {
        e.preventDefault();
        const step = e.shiftKey ? 120 : 30;
        const dx = e.key === "ArrowLeft" ? step : e.key === "ArrowRight" ? -step : 0;
        const dy = e.key === "ArrowUp"   ? step : e.key === "ArrowDown"  ? -step : 0;
        const np = { x: panRef.current.x + dx, y: panRef.current.y + dy };
        panTargetRef.current = np;
        setPan(np);
        panRef.current = np;
        return;
      }

      // Escape → close guide
      if (e.key === "Escape") {
        setShowGuide(false);
        return;
      }

      // +/= → zoom in; - → zoom out (without Ctrl, for convenience)
      if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        const vp = viewportRef.current;
        if (!vp) return;
        const r = vp.getBoundingClientRect();
        applyZoom(zoomTargetRef.current * 1.25, r.width / 2, r.height / 2);
        return;
      }
      if (e.key === "-") {
        e.preventDefault();
        const vp = viewportRef.current;
        if (!vp) return;
        const r = vp.getBoundingClientRect();
        applyZoom(zoomTargetRef.current * 0.8, r.width / 2, r.height / 2);
        return;
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        isSpaceDown.current = false;
        if (!isPanningRef.current) setCursor("default");
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [zoomToFit, applyZoom]);

  // ── Viewport pan (left-click drag = pan, middle-click = pan) ──
  // In read-only view every click-drag pans — there is no selection / rubber-band.
  const handleViewportMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.button !== 1) return;
    e.preventDefault();

    isPanningRef.current = true;
    panStart.current  = { x: e.clientX, y: e.clientY };
    panOrigin.current = { ...panRef.current };
    setCursor("grabbing");

    const onMove = (ev: MouseEvent) => {
      if (!isPanningRef.current) return;
      const np = {
        x: panOrigin.current.x + (ev.clientX - panStart.current.x),
        y: panOrigin.current.y + (ev.clientY - panStart.current.y),
      };
      panTargetRef.current = np;
      setPan(np);
      panRef.current = np;
    };
    const onUp = () => {
      isPanningRef.current = false;
      setCursor(isSpaceDown.current ? "grab" : "default");
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);

  // ── Grid style ──
  const gridSize   = GRID_PX * zoom;
  const gridStyle: React.CSSProperties = {
    backgroundColor: data.background,
    backgroundImage: `radial-gradient(circle, rgba(128,128,148,0.18) 1px, transparent 1px)`,
    backgroundSize: `${gridSize}px ${gridSize}px`,
    backgroundPosition: `${pan.x % gridSize}px ${pan.y % gridSize}px`,
    cursor: cursor === "default" ? CURSOR_CROSSHAIR_CSS : cursor,
  };

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-[var(--bg-base)]">

      {/* ── Top bar ── */}
      <div className="flex-shrink-0 h-11 border-b border-[var(--border-subtle)] flex items-center gap-3 px-4 select-none">
        <p className="flex-1 min-w-0 text-sm font-medium text-[var(--text-primary)] truncate">
          {data.title}
        </p>
        <span className="flex-shrink-0 text-[10px] text-[var(--text-tertiary)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] px-2 py-0.5 rounded">
          Lecture seule
        </span>
        {/* Guide toggle */}
        <button
          onClick={() => setShowGuide((v) => !v)}
          title="Raccourcis de navigation"
          className={`flex-shrink-0 w-6 h-6 rounded-full border flex items-center justify-center text-[11px] font-semibold transition-colors ${
            showGuide
              ? "bg-[var(--accent,#a78bfa)]/15 border-[var(--accent,#a78bfa)]/40 text-[var(--accent,#a78bfa)]"
              : "border-[var(--border-subtle)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:border-[var(--border-default)]"
          }`}
        >
          ?
        </button>
      </div>

      {/* ── Canvas viewport ── */}
      <div
        ref={viewportRef}
        className="flex-1 relative overflow-hidden"
        style={{ ...gridStyle, touchAction: "none" }}
        onMouseDown={handleViewportMouseDown}
      >
        {/* Canvas world (transformed) */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: "0 0",
            width: 0,
            height: 0,
          }}
        >
          {data.canvasData
            .filter((el) => el.type !== "stroke")
            .map((el) => (
              <div
                key={el.id}
                className="absolute pointer-events-none"
                style={{
                  left:    el.x,
                  top:     el.y,
                  width:   el.w,
                  height:  el.h,
                  // Sticky notes always render above images/colors/text (purely visual).
                  zIndex:  el.type === "sticky" ? el.zIndex + 100000 : el.zIndex,
                  opacity: el.opacity ?? 1,
                }}
              >
                <ViewerElement element={el} />
              </div>
            ))}
        </div>

        {/* Stroke canvas overlay — pencil drawings rendered at viewport coords */}
        {data.canvasData.some((el) => el.type === "stroke") && (
          <StrokeCanvas
            strokeElements={data.canvasData.filter((el) => el.type === "stroke") as StrokeElement[]}
            pan={pan}
            zoom={zoom}
          />
        )}

        {/* Space-hold hint — hidden on touch (no keyboard) */}
        {cursor === "grab" && !isTouchDevice && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-50 pointer-events-none text-[11px] text-[var(--text-tertiary)] bg-[var(--bg-elevated)]/80 px-2 py-1 rounded">
            Espace + glisser pour déplacer
          </div>
        )}

        {/* Navigation guide (auto-open for external users) */}
        {showGuide && <NavigationGuide onClose={() => setShowGuide(false)} />}

        {/* Zoom controls (bottom-right, matching editor style) */}
        <div className="absolute bottom-4 right-4 z-50 flex items-center gap-1 bg-[var(--bg-elevated)]/90 backdrop-blur border border-[var(--border-default)] rounded-lg px-2 py-1 shadow select-none">
          <button
            onClick={() => {
              const vp = viewportRef.current;
              if (!vp) return;
              const r = vp.getBoundingClientRect();
              applyZoom(zoomTargetRef.current * 0.8, r.width / 2, r.height / 2);
            }}
            className={`${isTouchDevice ? "w-10 h-10 text-lg" : "w-5 h-5 text-sm"} text-[var(--text-secondary)] hover:text-[var(--text-primary)] flex items-center justify-center`}
            title="Zoom arrière (−)"
          >
            −
          </button>
          <span className="text-[11px] text-[var(--text-tertiary)] w-10 text-center">
            {Math.round(zoom * 100)}%
          </span>
          <button
            onClick={() => {
              const vp = viewportRef.current;
              if (!vp) return;
              const r = vp.getBoundingClientRect();
              applyZoom(zoomTargetRef.current * 1.25, r.width / 2, r.height / 2);
            }}
            className={`${isTouchDevice ? "w-10 h-10 text-lg" : "w-5 h-5 text-sm"} text-[var(--text-secondary)] hover:text-[var(--text-primary)] flex items-center justify-center`}
            title="Zoom avant (+)"
          >
            +
          </button>
          <button
            onClick={zoomToFit}
            className={`${isTouchDevice ? "h-10 px-3 text-sm" : "text-[10px] px-1"} text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors`}
            title="Tout afficher (F)"
          >
            Tout afficher
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Element renderer (read-only, no editing controls) ────────────────────────

function ViewerElement({ element }: { element: CanvasElement }) {
  const br = 8;

  if (element.type === "image") {
    const el  = element as ImageElement;
    const fit = el.objectFit ?? "cover";
    const url = getImageUrl(el.storageKey);
    return (
      <div className="w-full h-full overflow-hidden relative" style={{ borderRadius: br }}>
        {el.isAnimated ? (
          <img
            src={url}
            alt={el.title}
            draggable={false}
            className={`absolute inset-0 w-full h-full ${fit === "contain" ? "object-contain" : "object-cover"}`}
          />
        ) : (
          <img
            src={url}
            alt={el.title}
            draggable={false}
            className={`absolute inset-0 w-full h-full ${fit === "contain" ? "object-contain" : "object-cover"}`}
          />
        )}
      </div>
    );
  }

  if (element.type === "text") {
    const el = element as TextElement;
    return (
      <div
        className="w-full h-full flex items-start p-1.5 break-words"
        style={{
          fontSize:   el.fontSize,
          color:      el.color,
          fontWeight: el.bold   ? "bold"   : "normal",
          fontStyle:  el.italic ? "italic" : "normal",
          lineHeight: 1.4,
          borderRadius: br,
        }}
      >
        {el.content}
      </div>
    );
  }

  if (element.type === "color") {
    const el = element as ColorElement;
    return (
      <div className="w-full h-full" style={{ backgroundColor: el.color, borderRadius: br }} />
    );
  }

  if (element.type === "sticky") {
    const el = element as StickyElement;
    return (
      <div
        className="w-full h-full flex flex-col p-3"
        style={{
          backgroundColor: el.backgroundColor,
          borderRadius: br,
          boxShadow: "2px 3px 8px rgba(0,0,0,0.18)",
        }}
      >
        <p className="text-sm leading-relaxed break-words" style={{ color: el.textColor }}>
          {el.content}
        </p>
      </div>
    );
  }

  return null;
}
