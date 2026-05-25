"use client";

import {
  useState,
  useCallback,
  useRef,
  useEffect,
  useMemo,
} from "react";
import { Rnd } from "react-rnd";
import { useRouter } from "next/navigation";
import { getImageUrl, getThumbnailUrl } from "@/lib/storage/urls";
import type {
  MoodboardData,
  CanvasElement,
  ImageElement,
  TextElement,
  ColorElement,
  StickyElement,
} from "@/lib/moodboard/types";
import { LibraryPanel } from "@/components/moodboard/LibraryPanel";
import { SharePanel } from "@/components/moodboard/SharePanel";
import { ContextualToolbar } from "@/components/moodboard/ContextualToolbar";
import { PencilLayer, type Stroke, type PencilTool, type StrokeElement, type PencilLayerHandle } from "@/components/moodboard/PencilLayer";
import { PencilToolbar } from "@/components/moodboard/PencilToolbar";
import { AI_IMPORT_KEY } from "@/components/settings/GeneralSettings";
import { exportMoodboardAsPng } from "@/lib/moodboard/export";
import { strokeToElement, eraseStroke } from "@/lib/moodboard/pencil";

interface Props {
  initialData: MoodboardData;
}

// ── Constants ────────────────────────────────────────────────────────────────

const GRID_PX = 24;   // logical grid size (canvas coords)
const SNAP_PX = 8;    // snap resolution
const ZOOM_MIN = 0.08;
const ZOOM_MAX = 5;
const HISTORY_MAX = 60;

function makeId() {
  return Math.random().toString(36).slice(2, 9);
}

// ── Custom canvas cursor (crosshair with ring, white with shadow underlay) ──
// Computed once — works on server (no window API needed, just string ops).
const CURSOR_CROSSHAIR_CSS = (() => {
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20">',
    // Shadow layer (dark, slightly offset)
    '<circle cx="10" cy="10" r="4.5" fill="none" stroke="rgba(0,0,0,0.5)" stroke-width="3"/>',
    '<circle cx="10" cy="10" r="1.5" fill="rgba(0,0,0,0.4)"/>',
    '<line x1="10" y1="1" x2="10" y2="5.5" stroke="rgba(0,0,0,0.5)" stroke-width="2.5"/>',
    '<line x1="10" y1="14.5" x2="10" y2="19" stroke="rgba(0,0,0,0.5)" stroke-width="2.5"/>',
    '<line x1="1" y1="10" x2="5.5" y2="10" stroke="rgba(0,0,0,0.5)" stroke-width="2.5"/>',
    '<line x1="14.5" y1="10" x2="19" y2="10" stroke="rgba(0,0,0,0.5)" stroke-width="2.5"/>',
    // White layer
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

// ── Main Component ───────────────────────────────────────────────────────────

export function MoodboardEditor({ initialData }: Props) {
  const router = useRouter();

  // ── Canvas state ──
  const [elements, setElements] = useState<CanvasElement[]>(initialData.canvasData);
  // pan and zoom are now refs-only — no React state.
  // displayZoom is only for the toolbar % display (updated at zoom settle).
  // rndScale is for react-rnd's scale prop (updated at zoom settle).
  const [displayZoom, setDisplayZoom] = useState(1);
  const [rndScale, setRndScale] = useState(1);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [shiftHeld, setShiftHeld] = useState(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [draggingId,    setDraggingId]    = useState<string | null>(null);
  const [dragAxisState, setDragAxisState] = useState<"both" | "x" | "y">("both");
  // Ghost copies shown during Alt+drag — rendered as non-interactive overlays at the
  // original positions so the user sees the duplication result in real time.
  // Kept in a separate state from `elements` so inserting them doesn't trigger a
  // re-render of the Rnd components (which would break the in-progress drag).
  const [altDragGhosts, setAltDragGhosts] = useState<CanvasElement[] | null>(null);

  // ── Rubber band ──
  const [rubberBand, setRubberBand] = useState<{
    sx: number; sy: number; ex: number; ey: number;
  } | null>(null);

  // ── Metadata ──
  const [title, setTitle] = useState(initialData.title);
  const [background, setBackground] = useState(initialData.background);
  const [shareToken, setShareToken] = useState(initialData.shareToken);
  const [shareExpiry, setShareExpiry] = useState(initialData.shareExpiry);

  // ── Panel visibility ──
  const [showLibrary, setShowLibrary] = useState(false);
  const [showShare, setShowShare] = useState(false);

  // ── Context menu ──
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  // ── Status ──
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportTransparent, setExportTransparent] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [cursor, setCursor] = useState("default");
  // Detected after mount — avoids SSR mismatch
  const [isTouchDevice, setIsTouchDevice] = useState(false);

  // ── Apple Pencil drawing mode ──
  const [drawingMode,  setDrawingMode]  = useState(false);
  const [pencilTool,   setPencilTool]   = useState<PencilTool>("pen");
  const [pencilColor,  setPencilColor]  = useState("#ffffff");
  const [pencilSize,   setPencilSize]   = useState(5);
  // Stable ref so native touch handlers can read drawingMode without being recreated
  const drawingModeRef = useRef(drawingMode);
  useEffect(() => { drawingModeRef.current = drawingMode; }, [drawingMode]);

  // ── Refs (avoid stale closures in event handlers) ──
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasWrapperRef = useRef<HTMLDivElement>(null);
  const pencilLayerRef   = useRef<PencilLayerHandle | null>(null);
  const visMapRef        = useRef<Record<string, boolean>>({});
  const [visMap, setVisMap] = useState<Record<string, boolean>>({});
  const panRef = useRef({ x: 80, y: 60 });
  const zoomRef = useRef(1);
  const selectedIdsRef = useRef(selectedIds);
  const elementsRef = useRef(elements);
  const snapEnabledRef = useRef(snapEnabled);
  const nextZRef = useRef(
    Math.max(100, ...initialData.canvasData.map((el) => el.zIndex), 0)
  );
  const isSpaceDown = useRef(false);
  const isPanningRef = useRef(false);
  const panStart = useRef({ x: 0, y: 0 });
  const panOrigin = useRef({ x: 0, y: 0 });
  const rubberBandActive = useRef(false);
  const rubberBandStart = useRef({ sx: 0, sy: 0 });
  const multiDragStartPositions = useRef<Map<string, { x: number; y: number }>>(new Map());
  const draggedElementStartPos = useRef({ x: 0, y: 0 });
  const aiOnImport = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // ── Feature refs ──
  const altHeldRef = useRef(false);       // Alt key tracking
  const shiftHeldRef = useRef(false);     // Shift key (sync ref for drag handlers)
  const dragAxisRef = useRef<"h" | "v" | null>(null); // Shift+drag axis lock
  const altDuplicateRef = useRef(false);  // Alt+drag: duplicate was triggered
  const clipboardRef = useRef<CanvasElement[]>([]); // Ctrl+C clipboard

  // ── Touch gesture refs ──
  const touchPanRef   = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const pinchRef      = useRef<{ startDist: number; startZoom: number; startMidViewX: number; startMidViewY: number; originPanX: number; originPanY: number } | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressPosRef   = useRef<{ clientX: number; clientY: number } | null>(null);
  // Touch rubber band (long-press + slide on empty canvas)
  const touchRubberBandRef      = useRef(false); // true while rubber band mode is active
  const touchRubberBandStartRef = useRef<{ vx: number; vy: number } | null>(null); // view coords of hold point
  const touchRubberBandRectRef  = useRef<{ sx: number; sy: number; ex: number; ey: number } | null>(null); // live rect (for onTouchEnd closure)
  // Touch tap vs pan tracking
  const touchStartedOnElementRef = useRef(false); // was the touch on an element?
  const touchDidPanRef           = useRef(false);  // did the touch produce a significant pan movement?
  // Multi-finger tap: 2 fingers = undo, 3 fingers = redo
  const multiTapRef = useRef<{ count: number; startTime: number; didMove: boolean } | null>(null);

  // ── Smooth zoom (rAF lerp) ──
  // zoomTargetRef / panTargetRef hold the *desired* state.
  // A requestAnimationFrame loop lerps the visual state toward the target each frame,
  // giving buttery smooth zoom on mouse wheel and trackpad pinch.
  const zoomTargetRef  = useRef(1);
  const panTargetRef   = useRef<{ x: number; y: number }>({ x: 80, y: 60 });
  const zoomRafRef     = useRef<number | null>(null);
  // Throttle direct pan state updates (trackpad wheel) to rAF frequency.
  // panRef is updated immediately so the canvas always has the freshest value;
  // setPan is deferred so React re-renders at most once per frame (~60 Hz)
  // instead of at the wheel-event rate (120 Hz+ on modern trackpads).
  const panFlushRafRef = useRef<number | null>(null);
  // Holds the step function; re-assigned every render so the closure always
  // captures the latest React state setters — stale-closure safe ref wrapper pattern.
  const zoomStepFnRef = useRef<() => void>(() => {});
  // Ref wrapper for applyViewTransform — lets zoomStepFnRef call it before it's defined.
  const applyViewTransformRef = useRef<(px: number, py: number, z: number) => void>(() => {});

  // ── History ──
  const historyRef = useRef<CanvasElement[][]>([
    JSON.parse(JSON.stringify(initialData.canvasData)),
  ]);
  const historyIdxRef = useRef(0);

  // ── Smooth zoom step (reassigned every render — always captures latest setters) ──
  // L = lerp factor per 60 Hz frame. 0.22 → reaches ~95% of target in ~12 frames ≈ 200 ms.
  // Using the ref-wrapper pattern: rAF calls `() => zoomStepFnRef.current()` which
  // always dereferences the latest version of the function.
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
    applyViewTransformRef.current(fpx, fpy, fz);
    if (done) {
      setDisplayZoom(fz);
      setRndScale(fz);
    }
    zoomRafRef.current = done ? null : requestAnimationFrame(() => zoomStepFnRef.current());
  };

  // Sync refs
  useEffect(() => { selectedIdsRef.current = selectedIds; }, [selectedIds]);
  useEffect(() => { elementsRef.current = elements; }, [elements]);
  useEffect(() => { snapEnabledRef.current = snapEnabled; }, [snapEnabled]);

  useEffect(() => {
    aiOnImport.current = localStorage.getItem(AI_IMPORT_KEY) === "true";
  }, []);

  // Detect touch device after mount (no SSR mismatch)
  useEffect(() => {
    setIsTouchDevice(navigator.maxTouchPoints > 1);
  }, []);

  // ── Snap helper ──
  const snap = useCallback(
    (v: number) => (snapEnabledRef.current ? Math.round(v / SNAP_PX) * SNAP_PX : v),
    []
  );

  // ── Auto-save ──
  const save = useCallback(
    async (data: { title?: string; canvasData?: CanvasElement[]; background?: string }) => {
      setSaving(true);
      setSaved(false);
      try {
        await fetch(`/api/moodboards/${initialData.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
        setSaved(true);
      } finally {
        setSaving(false);
      }
    },
    [initialData.id]
  );

  const scheduleSave = useCallback(
    (data: Parameters<typeof save>[0]) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => save(data), 1200);
    },
    [save]
  );

  // ── History push ──
  const pushHistory = useCallback((els: CanvasElement[]) => {
    const slice = historyRef.current.slice(0, historyIdxRef.current + 1);
    const copy = JSON.parse(JSON.stringify(els));
    historyRef.current = [...slice, copy].slice(-HISTORY_MAX);
    historyIdxRef.current = historyRef.current.length - 1;
  }, []);

  // ── Update elements (with optional history push) ──
  const updateElements = useCallback(
    (
      updater: (prev: CanvasElement[]) => CanvasElement[],
      options: { history?: boolean } = {}
    ) => {
      const { history = true } = options;
      setElements((prev) => {
        const next = updater(prev);
        scheduleSave({ canvasData: next });
        setSaved(false);
        if (history) pushHistory(next);
        return next;
      });
    },
    [scheduleSave, pushHistory]
  );

  // ── Undo / Redo ──
  const undo = useCallback(() => {
    if (historyIdxRef.current <= 0) return;
    historyIdxRef.current--;
    const prev = historyRef.current[historyIdxRef.current];
    setElements(prev);
    scheduleSave({ canvasData: prev });
    setSaved(false);
    setSelectedIds([]);
  }, [scheduleSave]);

  const redo = useCallback(() => {
    if (historyIdxRef.current >= historyRef.current.length - 1) return;
    historyIdxRef.current++;
    const next = historyRef.current[historyIdxRef.current];
    setElements(next);
    scheduleSave({ canvasData: next });
    setSaved(false);
    setSelectedIds([]);
  }, [scheduleSave]);

  // Refs so the touch useEffect (empty dep array) always calls the latest undo/redo
  const undoRef       = useRef(undo);
  const redoRef       = useRef(redo);
  useEffect(() => { undoRef.current = undo; }, [undo]);
  useEffect(() => { redoRef.current = redo; }, [redo]);

  // ── Pencil Pro eraser toggle ──
  // Remembers the last non-eraser tool so squeeze switches back to it.
  const prevPencilToolRef = useRef<Exclude<PencilTool, "eraser">>("pen");
  const handleToggleEraser = useCallback(() => {
    setPencilTool((prev) => {
      if (prev === "eraser") return prevPencilToolRef.current;
      prevPencilToolRef.current = prev as Exclude<PencilTool, "eraser">;
      return "eraser";
    });
  }, []);

  // ── Delete selected ──
  const deleteSelected = useCallback(() => {
    const ids = selectedIdsRef.current;
    if (ids.length === 0) return;
    // Skip locked elements — they are immutable until explicitly unlocked
    const toDelete = ids.filter((id) => {
      const el = elementsRef.current.find((e) => e.id === id);
      return !el?.locked;
    });
    if (toDelete.length === 0) return;
    updateElements((prev) => prev.filter((el) => !toDelete.includes(el.id)));
    setSelectedIds((prev) => prev.filter((id) => !toDelete.includes(id)));
  }, [updateElements]);

  // ── Select element ──
  const handleSelect = useCallback((id: string, shift: boolean) => {
    // Compute next selection synchronously so selectedIdsRef is up-to-date
    // before any drag handler fires in the same mousedown event batch.
    const prev = selectedIdsRef.current;
    const clicked = elementsRef.current.find((el) => el.id === id);
    const gid = clicked?.groupId;

    let next: string[];
    if (shift) {
      next = prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id];
    } else {
      // Already selected among multiple — keep selection unchanged
      if (prev.includes(id) && prev.length > 1) {
        next = prev;
      } else {
        next = [id];
      }
    }
    // Auto-expand selection to all members of the clicked element's group
    if (gid) {
      const members = elementsRef.current
        .filter((el) => el.groupId === gid)
        .map((el) => el.id);
      next = [...new Set([...next, ...members])];
    }

    // Synchronously update the ref so drag/context handlers see the correct
    // selection immediately (setSelectedIds is async — ref would lag one render)
    selectedIdsRef.current = next;
    setSelectedIds(next);
    // Bring to front — skip for locked elements (z-order is frozen when locked)
    if (!clicked?.locked) {
      setElements((prev) =>
        prev.map((el) =>
          el.id === id ? { ...el, zIndex: ++nextZRef.current } : el
        )
      );
      scheduleSave({
        canvasData: elementsRef.current.map((el) =>
          el.id === id ? { ...el, zIndex: nextZRef.current } : el
        ),
      });
    }
  }, [scheduleSave]);

  // ── Smooth zoom helpers ──
  // All zoom mutations set targets and kick off the rAF loop (if not already running).
  // Pan mutations during zoom also update panTarget so the loop converges correctly.
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
    panTargetRef.current  = {
      x: pivotX - canvasX * clamped,
      y: pivotY - canvasY * clamped,
    };
    kickZoomAnimation();
  }, [kickZoomAnimation]);

  const resetView = useCallback(() => {
    zoomTargetRef.current = 1;
    panTargetRef.current  = { x: 80, y: 60 };
    kickZoomAnimation();
  }, [kickZoomAnimation]);

  // ── Cancel smooth-zoom rAF on unmount ──
  useEffect(() => {
    return () => {
      if (zoomRafRef.current !== null) cancelAnimationFrame(zoomRafRef.current);
    };
  }, []);

  // ── Zoom-to-fit on first load ──
  // Give the browser one frame to measure the viewport before computing the fit.
  // If the canvas is empty the call is a no-op (zoomToFit guards against 0 elements).
  useEffect(() => {
    const t = setTimeout(() => zoomToFit(), 80);
    return () => clearTimeout(t);
    // zoomToFit is stable (useCallback with stable deps) — intentional empty dep array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Touch gestures (iPad / iPhone) ──
  // Registered as non-passive native listeners so we can call preventDefault()
  // to stop the browser from synthesising duplicate mouse events.
  //
  // Gesture map:
  //  1 finger on empty canvas       → pan immediately
  //    + hold 600ms without moving  → cancel pan, enter rubber band mode
  //    + slide after hold           → draw rubber band rect, select on lift
  //  1 finger on element            → react-rnd handles (tap = select, drag only if already selected)
  //  2 fingers anywhere             → pinch-zoom + pan simultaneously
  //  600ms hold on element          → context menu (replaces right-click)
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const clearLongPress = () => {
      if (longPressTimerRef.current) { clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null; }
      longPressPosRef.current = null;
    };

    const clearTouchRubberBand = () => {
      touchRubberBandRef.current      = false;
      touchRubberBandStartRef.current = null;
      touchRubberBandRectRef.current  = null;
    };

    const onTouchStart = (e: TouchEvent) => {
      // Close context menu on any new touch outside the menu
      const target = e.target as HTMLElement;
      if (!target.closest('[data-role="context-menu"]')) setContextMenu(null);

      // Toolbar buttons: let React synthetic handlers run uninterrupted.
      // Also set the "started on element" flag so onTouchEnd doesn't deselect.
      if (target.closest('[data-role="toolbar"]') || target.closest('[data-role="pencil-toolbar"]')) {
        touchStartedOnElementRef.current = true;
        return;
      }

      // Resize handles manage their own touch event handlers — don't pan.
      if (target.closest('[data-role="resize-handle"]')) return;

      // ── Drawing mode touch handling ───────────────────────────────────────
      // The PencilLayer handles all pen (stylus) input via pointer events.
      // Finger gestures supported in drawing mode:
      //   1 finger → pan (Pencil is a separate pointer stream — no conflict)
      //   2 fingers → pinch-zoom + pan, or 2-finger tap = pencil undo
      //   3 fingers → 3-finger tap = redo
      if (drawingModeRef.current) {
        e.preventDefault();

        if (e.touches.length >= 3) {
          // 3-finger: clear pinch so move handler doesn't mistake it for 2-finger
          pinchRef.current    = null;
          touchPanRef.current = null;
          multiTapRef.current = { count: 3, startTime: Date.now(), didMove: false };
          return;
        }

        if (e.touches.length === 2) {
          multiTapRef.current = { count: 2, startTime: Date.now(), didMove: false };
          touchPanRef.current = null;
          const t0 = e.touches[0], t1 = e.touches[1];
          const ddx = t0.clientX - t1.clientX, ddy = t0.clientY - t1.clientY;
          const dist = Math.sqrt(ddx * ddx + ddy * ddy);
          const rect = viewport.getBoundingClientRect();
          pinchRef.current = {
            startDist    : dist,
            startZoom    : zoomRef.current,
            startMidViewX: (t0.clientX + t1.clientX) / 2 - rect.left,
            startMidViewY: (t0.clientY + t1.clientY) / 2 - rect.top,
            originPanX   : panRef.current.x,
            originPanY   : panRef.current.y,
          };
          return;
        }

        if (e.touches.length === 1) {
          // 1-finger pan — Apple Pencil uses pointer events (separate stream).
          // However, on some iPadOS/browser combinations the Pencil also fires
          // touch events with touchType === "stylus".  Skip pan for stylus
          // touches so drawing doesn't simultaneously move the canvas.
          const t = e.touches[0];
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          if ((t as any).touchType === "stylus") return;
          touchPanRef.current = {
            startX : t.clientX,
            startY : t.clientY,
            originX: panRef.current.x,
            originY: panRef.current.y,
          };
          multiTapRef.current = null;
          return;
        }
        return;
      }

      clearLongPress();

      // ── 3-finger: redo tap (track and wait for touchend) ──
      if (e.touches.length === 3) {
        e.preventDefault();
        multiTapRef.current = { count: 3, startTime: Date.now(), didMove: false };
        return;
      }

      // ── 2-finger: init pinch/zoom + pan ──
      if (e.touches.length === 2) {
        e.preventDefault();
        // Cancel any in-progress react-rnd drag so the selected element doesn't
        // jump when a second finger lands (react-rnd tracks finger 1 as a drag).
        document.dispatchEvent(new PointerEvent('pointerup', {
          bubbles: true, cancelable: true,
          clientX: e.touches[0].clientX, clientY: e.touches[0].clientY,
        }));
        // Track for 2-finger undo tap
        multiTapRef.current = { count: 2, startTime: Date.now(), didMove: false };
        touchPanRef.current = null;
        clearTouchRubberBand();
        setRubberBand(null);
        const t0 = e.touches[0], t1 = e.touches[1];
        const dx = t0.clientX - t1.clientX, dy = t0.clientY - t1.clientY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const rect = viewport.getBoundingClientRect();
        pinchRef.current = {
          startDist    : dist,
          startZoom    : zoomRef.current,
          startMidViewX: (t0.clientX + t1.clientX) / 2 - rect.left,
          startMidViewY: (t0.clientY + t1.clientY) / 2 - rect.top,
          originPanX   : panRef.current.x,
          originPanY   : panRef.current.y,
        };
        return;
      }

      // ── 1-finger ──
      if (e.touches.length === 1) {
        pinchRef.current = null;
        touchDidPanRef.current = false;
        const touch = e.touches[0];
        const rect  = viewport.getBoundingClientRect();
        const viewX = touch.clientX - rect.left;
        const viewY = touch.clientY - rect.top;

        // Hit-test: find topmost canvas element under the touch
        const canvasX = (viewX - panRef.current.x) / zoomRef.current;
        const canvasY = (viewY - panRef.current.y) / zoomRef.current;
        const sorted = [...elementsRef.current].sort((a, b) => {
          const az = a.type === "sticky" ? a.zIndex + 100_000 : a.zIndex;
          const bz = b.type === "sticky" ? b.zIndex + 100_000 : b.zIndex;
          return bz - az;
        });
        const hitEl = sorted.find(
          (el) => canvasX >= el.x && canvasX <= el.x + el.w && canvasY >= el.y && canvasY <= el.y + el.h
        );

        if (!hitEl) {
          // ── Empty canvas ──
          touchStartedOnElementRef.current = false;
          e.preventDefault(); // prevent synthetic mousedown → no accidental rubber band via mouse handler
          touchPanRef.current = {
            startX : touch.clientX,
            startY : touch.clientY,
            originX: panRef.current.x,
            originY: panRef.current.y,
          };

          // Long-press on empty → rubber band mode (400ms, shorter than element menu)
          longPressPosRef.current = { clientX: touch.clientX, clientY: touch.clientY };
          longPressTimerRef.current = setTimeout(() => {
            longPressTimerRef.current = null;
            if (!longPressPosRef.current) return; // cancelled (finger moved > 10px)
            touchPanRef.current = null; // stop panning, switch to rubber band
            touchRubberBandRef.current = true;
            const r = viewport.getBoundingClientRect();
            const vx = longPressPosRef.current.clientX - r.left;
            const vy = longPressPosRef.current.clientY - r.top;
            touchRubberBandStartRef.current = { vx, vy };
            touchRubberBandRectRef.current  = { sx: vx, sy: vy, ex: vx, ey: vy };
            setRubberBand({ sx: vx, sy: vy, ex: vx, ey: vy });
            if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(8);
            longPressPosRef.current = null;
          }, 400); // 400ms: snappy enough to not feel accidental

        } else {
          // ── On element ──
          touchStartedOnElementRef.current = true;

          // If the element is NOT selected, allow pan from this touch (lazy: only triggers
          // if the finger actually moves > 4px, so taps still select via synthetic mousedown).
          if (!selectedIdsRef.current.includes(hitEl.id)) {
            touchPanRef.current = {
              startX : touch.clientX,
              startY : touch.clientY,
              originX: panRef.current.x,
              originY: panRef.current.y,
            };
          }

          // Long-press → context menu (600ms, intentional delay)
          longPressPosRef.current = { clientX: touch.clientX, clientY: touch.clientY };
          longPressTimerRef.current = setTimeout(() => {
            longPressTimerRef.current = null;
            if (!longPressPosRef.current) return;
            const { clientX, clientY } = longPressPosRef.current;
            const r = viewport.getBoundingClientRect();
            if (!selectedIdsRef.current.includes(hitEl.id)) {
              selectedIdsRef.current = [hitEl.id];
              setSelectedIds([hitEl.id]);
            }
            touchPanRef.current = null; // don't pan after menu appears
            setContextMenu({ x: clientX - r.left, y: clientY - r.top });
            if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(8);
            longPressPosRef.current = null;
          }, 600);
        }
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault();

      // Drawing mode: allow 1-finger pan and 2-finger pinch/pan
      if (drawingModeRef.current) {
        if (e.touches.length >= 3) {
          // 3-finger move invalidates the redo tap
          if (multiTapRef.current) multiTapRef.current.didMove = true;
        } else if (e.touches.length === 2 && pinchRef.current) {
          if (multiTapRef.current) multiTapRef.current.didMove = true;
          const p   = pinchRef.current;
          const t0  = e.touches[0], t1 = e.touches[1];
          const ddx = t0.clientX - t1.clientX, ddy = t0.clientY - t1.clientY;
          const dist = Math.sqrt(ddx * ddx + ddy * ddy);
          const rect = viewport.getBoundingClientRect();
          const curMidX = (t0.clientX + t1.clientX) / 2 - rect.left;
          const curMidY = (t0.clientY + t1.clientY) / 2 - rect.top;
          const newZoom    = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, p.startZoom * (dist / p.startDist)));
          const canvasMidX = (p.startMidViewX - p.originPanX) / p.startZoom;
          const canvasMidY = (p.startMidViewY - p.originPanY) / p.startZoom;
          const newPanX    = curMidX - canvasMidX * newZoom;
          const newPanY    = curMidY - canvasMidY * newZoom;
          zoomRef.current       = newZoom;
          panRef.current        = { x: newPanX, y: newPanY };
          zoomTargetRef.current = newZoom;
          panTargetRef.current  = { x: newPanX, y: newPanY };
          applyViewTransformRef.current(newPanX, newPanY, newZoom);
          setDisplayZoom(newZoom);
          setRndScale(newZoom);
        } else if (e.touches.length === 1 && touchPanRef.current) {
          const touch = e.touches[0];
          const p  = touchPanRef.current;
          const dx = touch.clientX - p.startX;
          const dy = touch.clientY - p.startY;
          const np = { x: p.originX + dx, y: p.originY + dy };
          panRef.current       = np;
          panTargetRef.current = np;
          applyViewTransformRef.current(np.x, np.y, zoomRef.current);
        }
        return;
      }

      // ── 2-finger: pinch-zoom + translate simultaneously ──
      if (e.touches.length === 2 && pinchRef.current) {
        // Any 2-finger movement = not a tap
        if (multiTapRef.current) multiTapRef.current.didMove = true;
        const p  = pinchRef.current;
        const t0 = e.touches[0], t1 = e.touches[1];
        const dx = t0.clientX - t1.clientX, dy = t0.clientY - t1.clientY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const rect = viewport.getBoundingClientRect();
        const curMidX = (t0.clientX + t1.clientX) / 2 - rect.left;
        const curMidY = (t0.clientY + t1.clientY) / 2 - rect.top;
        const newZoom    = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, p.startZoom * (dist / p.startDist)));
        const canvasMidX = (p.startMidViewX - p.originPanX) / p.startZoom;
        const canvasMidY = (p.startMidViewY - p.originPanY) / p.startZoom;
        const newPanX = curMidX - canvasMidX * newZoom;
        const newPanY = curMidY - canvasMidY * newZoom;
        zoomRef.current      = newZoom;
        panRef.current       = { x: newPanX, y: newPanY };
        zoomTargetRef.current = newZoom;
        panTargetRef.current  = { x: newPanX, y: newPanY };
        applyViewTransformRef.current(newPanX, newPanY, newZoom);
        setDisplayZoom(newZoom);
        setRndScale(newZoom);
        return;
      }

      if (e.touches.length === 1) {
        const touch = e.touches[0];

        // ── Rubber band mode: update the selection rect ──
        if (touchRubberBandRef.current && touchRubberBandStartRef.current) {
          e.preventDefault();
          const rect = viewport.getBoundingClientRect();
          const vx = touch.clientX - rect.left;
          const vy = touch.clientY - rect.top;
          const { vx: sx, vy: sy } = touchRubberBandStartRef.current;
          const rb = { sx, sy, ex: vx, ey: vy };
          touchRubberBandRectRef.current = rb;
          setRubberBand(rb);
          return;
        }

        // ── Pan mode ──
        if (touchPanRef.current) {
          const p  = touchPanRef.current;
          const dx = touch.clientX - p.startX;
          const dy = touch.clientY - p.startY;
          const moved = Math.sqrt(dx * dx + dy * dy);

          // For element-started pans: require > 4px before panning so quick taps
          // still propagate as synthetic mousedown → select. Once the threshold is
          // crossed, e.preventDefault() suppresses the mousedown synthesis at touchend.
          // For empty-canvas pans: no threshold (mousedown already prevented in touchstart).
          if (!touchStartedOnElementRef.current || moved > 4) {
            e.preventDefault();
            touchDidPanRef.current = true;
            const np = { x: p.originX + dx, y: p.originY + dy };
            panRef.current       = np;
            panTargetRef.current  = np;
            applyViewTransformRef.current(np.x, np.y, zoomRef.current);
          }
        }

        // Cancel long-press if finger moves > 10px (allows free panning)
        if (longPressPosRef.current) {
          const ddx = touch.clientX - longPressPosRef.current.clientX;
          const ddy = touch.clientY - longPressPosRef.current.clientY;
          if (Math.sqrt(ddx * ddx + ddy * ddy) > 10) clearLongPress();
        }
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      // Drawing mode: handle 1-finger pan end + multi-finger taps (undo/redo)
      if (drawingModeRef.current) {
        if (e.touches.length === 0 && multiTapRef.current && !multiTapRef.current.didMove) {
          const elapsed = Date.now() - multiTapRef.current.startTime;
          if (elapsed < 350) {
            if (multiTapRef.current.count === 2) pencilUndoRef.current();
            else if (multiTapRef.current.count === 3) redoRef.current();
          }
        }
        if (e.touches.length === 0) {
          multiTapRef.current = null;
          pinchRef.current    = null;
          touchPanRef.current = null;
        }
        return;
      }

      // ── Multi-finger tap: undo (2 fingers) / redo (3 fingers) ──
      // Evaluate when the last finger lifts.
      let wasMultiTap = false;
      if (e.touches.length === 0 && multiTapRef.current && !multiTapRef.current.didMove) {
        const elapsed = Date.now() - multiTapRef.current.startTime;
        if (elapsed < 350) {
          wasMultiTap = true;
          if (multiTapRef.current.count === 2) undoRef.current();
          else if (multiTapRef.current.count === 3) redoRef.current();
        }
      }
      if (e.touches.length === 0) multiTapRef.current = null;
      // If it was a multi-tap gesture, skip all other end-of-touch logic
      if (wasMultiTap) {
        clearTouchRubberBand();
        touchPanRef.current = null;
        pinchRef.current     = null;
        touchDidPanRef.current = false;
        touchStartedOnElementRef.current = false;
        clearLongPress();
        return;
      }

      // Finalise rubber band: select elements that intersect the rect
      if (touchRubberBandRef.current && touchRubberBandRectRef.current) {
        const { sx, sy, ex, ey } = touchRubberBandRectRef.current;
        const minVX = Math.min(sx, ex), maxVX = Math.max(sx, ex);
        const minVY = Math.min(sy, ey), maxVY = Math.max(sy, ey);
        if (maxVX - minVX > 4 || maxVY - minVY > 4) {
          const minCX = (minVX - panRef.current.x) / zoomRef.current;
          const maxCX = (maxVX - panRef.current.x) / zoomRef.current;
          const minCY = (minVY - panRef.current.y) / zoomRef.current;
          const maxCY = (maxVY - panRef.current.y) / zoomRef.current;
          const ids = elementsRef.current
            .filter(el => !el.locked &&
              el.x < maxCX && el.x + el.w > minCX &&
              el.y < maxCY && el.y + el.h > minCY)
            .map(el => el.id);
          selectedIdsRef.current = ids;
          setSelectedIds(ids);
        }
        setRubberBand(null);
      }

      // Tap on empty canvas (no rubber band, no significant pan, not on an element) → deselect
      if (!touchRubberBandRef.current && !touchDidPanRef.current && !touchStartedOnElementRef.current) {
        selectedIdsRef.current = [];
        setSelectedIds([]);
      }

      clearTouchRubberBand();
      touchPanRef.current            = null;
      pinchRef.current               = null;
      touchDidPanRef.current         = false;
      touchStartedOnElementRef.current = false;
      clearLongPress();
    };

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
  }, []); // refs + stable setters — no reactive deps needed

  // ── Block native HTML5 drag inside the canvas viewport ──
  // react-rnd uses mouse events; if the browser enters native drag mode
  // (e.g. from an <img> inside a canvas element), mousemove stops firing
  // and the view freezes. Capturing dragstart and calling preventDefault
  // stops the browser from entering that mode entirely.
  // External drops (files from desktop, library panel items) are unaffected
  // because their dragstart fires OUTSIDE the viewport element.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const prevent = (e: DragEvent) => e.preventDefault();
    viewport.addEventListener("dragstart", prevent, true); // capture phase
    return () => viewport.removeEventListener("dragstart", prevent, true);
  }, []);

  // ── Wheel handler (non-passive) ──
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = viewport.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;

      if (e.ctrlKey || e.metaKey) {
        // Smooth zoom: accumulate into the target each wheel event so rapid scrolling
        // stacks correctly, then the rAF loop lerps the visual state toward the target.
        const factor = e.deltaY > 0 ? 0.92 : 1.08;
        const newTarget = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoomTargetRef.current * factor));
        // Compute new pan so the canvas point under the cursor stays fixed.
        // Use zoomRef (current visual zoom) as the pivot base so the anchor is correct
        // even when the animation hasn't finished yet.
        const cz = zoomRef.current;
        const cp = panRef.current;
        const canvasX = (px - cp.x) / cz;
        const canvasY = (py - cp.y) / cz;
        zoomTargetRef.current = newTarget;
        panTargetRef.current  = { x: px - canvasX * newTarget, y: py - canvasY * newTarget };
        kickZoomAnimation();
      } else {
        // Pan — no lerp (must feel instant). Apply imperatively — no React state update.
        const np = {
          x: panRef.current.x - e.deltaX,
          y: panRef.current.y - e.deltaY,
        };
        panTargetRef.current = np;
        panRef.current = np;
        applyViewTransformRef.current(np.x, np.y, zoomRef.current);
      }
    };

    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", onWheel);
  }, [applyZoom, kickZoomAnimation]);

  // ── Group / Ungroup (declared early — used by keyboard handler below) ──
  const handleGroup = useCallback(() => {
    const ids = selectedIdsRef.current;
    if (ids.length < 2) return;
    const groupId = makeId();
    updateElements((prev) =>
      prev.map((el) => (ids.includes(el.id) ? { ...el, groupId } : el))
    );
    setContextMenu(null);
  }, [updateElements]);

  const handleUngroup = useCallback(() => {
    const ids = selectedIdsRef.current;
    updateElements((prev) =>
      prev.map((el) =>
        ids.includes(el.id) ? { ...el, groupId: undefined } : el
      )
    );
    setContextMenu(null);
  }, [updateElements]);

  // ── Zoom-to-fit helper ──
  const zoomToFit = useCallback((targetIds?: string[]) => {
    const vp = viewportRef.current;
    if (!vp) return;
    const { width, height } = vp.getBoundingClientRect();
    const targets = targetIds && targetIds.length > 0
      ? elementsRef.current.filter((el) => targetIds.includes(el.id))
      : elementsRef.current;
    if (targets.length === 0) return;
    const minX = Math.min(...targets.map((el) => el.x));
    const minY = Math.min(...targets.map((el) => el.y));
    const maxX = Math.max(...targets.map((el) => el.x + el.w));
    const maxY = Math.max(...targets.map((el) => el.y + el.h));
    const bw = maxX - minX;
    const bh = maxY - minY;
    const PAD = 80;
    const newZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN,
      Math.min((width - PAD * 2) / Math.max(1, bw), (height - PAD * 2) / Math.max(1, bh))
    ));
    const newPan = {
      x: (width  - bw * newZoom) / 2 - minX * newZoom,
      y: (height - bh * newZoom) / 2 - minY * newZoom,
    };
    zoomTargetRef.current = newZoom;
    panTargetRef.current  = newPan;
    kickZoomAnimation();
  }, [kickZoomAnimation]);

  // ── Duplicate helper (shared by Ctrl+D and Alt+drag) ──
  const duplicateElements = useCallback(
    (ids: string[], offsetX = 20, offsetY = 20): CanvasElement[] => {
      const toDup = elementsRef.current.filter((el) => ids.includes(el.id));
      const groupIdMap = new Map<string, string>();
      return toDup.map((el) => {
        let newGroupId = el.groupId;
        if (el.groupId) {
          if (!groupIdMap.has(el.groupId)) groupIdMap.set(el.groupId, makeId());
          newGroupId = groupIdMap.get(el.groupId)!;
        }
        return { ...el, id: makeId(), groupId: newGroupId,
          x: el.x + offsetX, y: el.y + offsetY,
          zIndex: ++nextZRef.current };
      });
    },
    []
  );

  // ── Keyboard shortcuts ──
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const inInput = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;

      // Track modifier keys (always, even in inputs)
      if (e.key === "Shift") { setShiftHeld(true); shiftHeldRef.current = true; }
      if (e.key === "Alt")   { altHeldRef.current = true; }

      if (e.code === "Space" && !inInput) {
        e.preventDefault();
        isSpaceDown.current = true;
        setSpaceHeld(true);
        if (!isPanningRef.current) setCursor("grab");
        return;
      }

      if (inInput) return;

      // ── Ctrl / Meta combos ──
      if (e.ctrlKey || e.metaKey) {
        if (e.key === "z" && !e.shiftKey) { e.preventDefault(); undo(); return; }
        if (e.key === "z" &&  e.shiftKey) { e.preventDefault(); redo(); return; }
        if (e.key === "y") { e.preventDefault(); redo(); return; }

        if (e.key === "a") {
          e.preventDefault();
          const all = elementsRef.current.map((el) => el.id);
          selectedIdsRef.current = all;
          setSelectedIds(all);
          return;
        }

        if (e.key.toLowerCase() === "g") {
          e.preventDefault();
          if (e.shiftKey) handleUngroup(); else handleGroup();
          return;
        }

        // Ctrl+C — copy selection to clipboard
        if (e.key === "c") {
          e.preventDefault();
          const ids = selectedIdsRef.current;
          if (ids.length === 0) return;
          clipboardRef.current = elementsRef.current.filter((el) => ids.includes(el.id));
          return;
        }

        // Ctrl+V — paste clipboard (element duplication, not image paste)
        if (e.key === "v") {
          if (clipboardRef.current.length === 0) return; // let image-paste handler run
          e.preventDefault();
          if (e.repeat) return; // prevent runaway duplication on key hold
          const copies = duplicateElements(clipboardRef.current.map((el) => el.id));
          // Shift clipboard for next paste so items stack neatly
          clipboardRef.current = clipboardRef.current.map((el) => ({ ...el, x: el.x + 20, y: el.y + 20 }));
          updateElements((prev) => [...prev, ...copies]);
          const newIds = copies.map((el) => el.id);
          selectedIdsRef.current = newIds;
          setSelectedIds(newIds);
          return;
        }

        // Ctrl+D — duplicate in place
        if (e.key === "d") {
          e.preventDefault();
          if (e.repeat) return; // prevent runaway duplication on key hold
          const ids = selectedIdsRef.current;
          if (ids.length === 0) return;
          const copies = duplicateElements(ids);
          updateElements((prev) => [...prev, ...copies]);
          const newIds = copies.map((el) => el.id);
          selectedIdsRef.current = newIds;
          setSelectedIds(newIds);
          return;
        }

        // Ctrl+L — toggle lock on selected elements
        if (e.key === "l") {
          e.preventDefault();
          const ids = selectedIdsRef.current;
          if (ids.length === 0) return;
          const anyUnlocked = elementsRef.current
            .filter((el) => ids.includes(el.id))
            .some((el) => !el.locked);
          updateElements((prev) =>
            prev.map((el) => ids.includes(el.id) ? { ...el, locked: anyUnlocked } : el)
          );
          return;
        }

        return;
      }

      // ── Arrow keys — nudge ──
      if (e.key.startsWith("Arrow")) {
        const ids = selectedIdsRef.current;
        if (ids.length === 0) return;
        // Don't interfere with browser scroll on unrelated keys
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp"   ? -step : e.key === "ArrowDown"  ? step : 0;
        updateElements((prev) =>
          prev.map((el) =>
            ids.includes(el.id) && !el.locked
              ? { ...el, x: el.x + dx, y: el.y + dy }
              : el
          )
        );
        return;
      }

      // ── F — zoom to fit (selection or all) ──
      if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        zoomToFit(selectedIdsRef.current.length > 0 ? selectedIdsRef.current : undefined);
        return;
      }

      // ── Shift+1 — zoom 100% at viewport center ──
      // Use e.code (layout-independent) — e.key varies: "!" on QWERTY, "1" on AZERTY, etc.
      if (e.shiftKey && e.code === "Digit1") {
        e.preventDefault();
        const vp = viewportRef.current;
        if (!vp) return;
        const { width, height } = vp.getBoundingClientRect();
        applyZoom(1, width / 2, height / 2);
        return;
      }

      // ── Delete / Backspace ──
      if (e.key === "Delete" || e.key === "Backspace") {
        deleteSelected();
        return;
      }

      // ── Escape ──
      if (e.key === "Escape") {
        setSelectedIds([]);
        selectedIdsRef.current = [];
        setContextMenu(null);
        return;
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        isSpaceDown.current = false;
        setSpaceHeld(false);
        if (!isPanningRef.current) setCursor("default");
      }
      if (e.key === "Shift") { setShiftHeld(false); shiftHeldRef.current = false; }
      if (e.key === "Alt")   { altHeldRef.current = false; }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [undo, redo, deleteSelected, handleGroup, handleUngroup, duplicateElements, updateElements, zoomToFit, applyZoom]);

  // ── Viewport mouse handlers (pan + rubber band) ──
  const handleViewportMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    // Ignore synthetic mouse events that originate from Apple Pencil in drawing mode
    if (drawingModeRef.current) return;

    if (e.button === 1 || (e.button === 0 && isSpaceDown.current)) {
      // Pan
      e.preventDefault();
      isPanningRef.current = true;
      panStart.current = { x: e.clientX, y: e.clientY };
      panOrigin.current = { ...panRef.current };
      setCursor("grabbing");

      const onMove = (ev: MouseEvent) => {
        if (!isPanningRef.current) return;
        const np = {
          x: panOrigin.current.x + (ev.clientX - panStart.current.x),
          y: panOrigin.current.y + (ev.clientY - panStart.current.y),
        };
        panRef.current = np;
        // Keep the smooth-zoom rAF target in sync — without this, any running
        // zoom animation would fight the manual pan and snap back to the old target.
        panTargetRef.current = np;
        applyViewTransformRef.current(np.x, np.y, zoomRef.current);
      };
      const onUp = () => {
        isPanningRef.current = false;
        setCursor(isSpaceDown.current ? "grab" : "default");
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
      return;
    }

    if (e.button === 0) {
      // Rubber band
      if (!e.shiftKey) setSelectedIds([]);
      setContextMenu(null);
      const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      rubberBandActive.current = true;
      rubberBandStart.current = { sx, sy };
      setRubberBand({ sx, sy, ex: sx, ey: sy });

      const onMove = (ev: MouseEvent) => {
        if (!rubberBandActive.current) return;
        const ex = ev.clientX - rect.left;
        const ey = ev.clientY - rect.top;
        setRubberBand({ sx, sy, ex, ey });
      };
      const onUp = (ev: MouseEvent) => {
        if (!rubberBandActive.current) return;
        rubberBandActive.current = false;
        const ex = ev.clientX - rect.left;
        const ey = ev.clientY - rect.top;
        // Convert to canvas coords
        const cp = panRef.current;
        const cz = zoomRef.current;
        const x1 = (Math.min(sx, ex) - cp.x) / cz;
        const y1 = (Math.min(sy, ey) - cp.y) / cz;
        const x2 = (Math.max(sx, ex) - cp.x) / cz;
        const y2 = (Math.max(sy, ey) - cp.y) / cz;
        const w = x2 - x1;
        const h = y2 - y1;
        if (w > 4 && h > 4) {
          const ids = elementsRef.current
            .filter(
              (el) =>
                el.x < x2 && el.x + el.w > x1 && el.y < y2 && el.y + el.h > y1
            )
            .map((el) => el.id);
          setSelectedIds((prev) => e.shiftKey ? [...new Set([...prev, ...ids])] : ids);
        }
        setRubberBand(null);
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    }
  }, []);

  // ── Element drag (multi-select, Shift+axis, Alt+duplicate) ──
  const handleElemDragStart = useCallback((id: string) => {
    const dragged = elementsRef.current.find((el) => el.id === id);
    if (!dragged || dragged.locked) return;
    draggedElementStartPos.current = { x: dragged.x, y: dragged.y };

    // Reset per-drag state
    dragAxisRef.current     = null;
    altDuplicateRef.current = false;
    setDraggingId(id);
    setDragAxisState("both");

    // Use ref (already synchronously updated by handleSelect) and defensively
    // expand to group members in case the group was just formed / ref lagged.
    let ids = selectedIdsRef.current;
    const gid = dragged.groupId;
    if (gid) {
      const members = elementsRef.current
        .filter((el) => el.groupId === gid)
        .map((el) => el.id);
      ids = [...new Set([...ids, ...members])];
    }

    if (ids.includes(id)) {
      const map = new Map<string, { x: number; y: number }>();
      elementsRef.current.forEach((el) => {
        if (ids.includes(el.id)) map.set(el.id, { x: el.x, y: el.y });
      });
      multiDragStartPositions.current = map;
    }

    // Alt+drag: flag intent and show ghost copies at the current positions.
    // Ghosts live in a separate state so they never re-render the Rnd components
    // (which would interrupt the in-progress drag and risk infinite duplication).
    // Real copies are only committed to `elements` at DragStop once a genuine drag
    // is confirmed (movement > 3px threshold).
    if (altHeldRef.current && ids.includes(id)) {
      altDuplicateRef.current = true;
      // Snapshot unlocked selected elements — these are what will be duplicated
      const ghosts = elementsRef.current.filter(
        (el) => ids.includes(el.id) && !el.locked
      );
      setAltDragGhosts(ghosts);
    }
  }, []);

  const handleElemDragStop = useCallback(
    (id: string, newX: number, newY: number) => {
      let dx = newX - draggedElementStartPos.current.x;
      let dy = newY - draggedElementStartPos.current.y;

      // Ignore accidental micro-drags (right-click, click-to-select, etc.)
      if (Math.abs(dx) < 3 && Math.abs(dy) < 3) {
        // Alt was held but no real move → clear flag and ghosts, do nothing
        altDuplicateRef.current = false;
        setAltDragGhosts(null);
        return;
      }

      // Shift+drag: constrain to dominant axis at stop time
      if (shiftHeldRef.current || dragAxisRef.current) {
        const axis = dragAxisRef.current ?? (Math.abs(dx) >= Math.abs(dy) ? "h" : "v");
        if (axis === "h") { dy = 0; newY = draggedElementStartPos.current.y; }
        else              { dx = 0; newX = draggedElementStartPos.current.x; }
      }

      // Reset visual axis constraint on the Rnd component
      setDraggingId(null);
      setDragAxisState("both");

      const ids = selectedIdsRef.current;

      // Alt+drag duplicate — real drag confirmed.
      // Create copies at the drag-START positions (they stay put) while
      // moving the originals to their drag-END positions.
      // Everything is committed in a single updateElements call to avoid
      // triggering extra re-renders (which was the root cause of infinite duplication
      // when copies were inserted in onDragStart instead of here).
      if (altDuplicateRef.current) {
        altDuplicateRef.current = false;
        setAltDragGhosts(null); // ghosts replaced by real copies below
        const groupIdMap = new Map<string, string>();
        const elementsToDup = elementsRef.current.filter((el) => ids.includes(el.id));
        const copies = elementsToDup.map((el) => {
          let newGroupId = el.groupId;
          if (el.groupId) {
            if (!groupIdMap.has(el.groupId)) groupIdMap.set(el.groupId, makeId());
            newGroupId = groupIdMap.get(el.groupId)!;
          }
          // Copy stays at the original (pre-drag) position
          const start = multiDragStartPositions.current.get(el.id);
          return {
            ...el,
            id: makeId(),
            groupId: newGroupId,
            x: start?.x ?? el.x,
            y: start?.y ?? el.y,
            zIndex: ++nextZRef.current,
          };
        });
        // One atomic update: move originals (skip locked) + insert copies
        updateElements((prev) => {
          const moved = prev.map((el) => {
            if (!ids.includes(el.id)) return el;
            if (el.locked) return el; // locked elements never move
            const s = multiDragStartPositions.current.get(el.id);
            if (!s) return el;
            if (ids.length > 1) return { ...el, x: snap(s.x + dx), y: snap(s.y + dy) };
            return el.id === id ? { ...el, x: snap(newX), y: snap(newY) } : el;
          });
          return [...moved, ...copies];
        });
        return;
      }

      if (ids.includes(id) && ids.length > 1) {
        updateElements((prev) =>
          prev.map((el) => {
            if (!ids.includes(el.id)) return el;
            if (el.locked) return el; // locked elements never move
            const s = multiDragStartPositions.current.get(el.id);
            if (!s) return el;
            return { ...el, x: snap(s.x + dx), y: snap(s.y + dy) };
          })
        );
      } else {
        updateElements((prev) =>
          prev.map((el) =>
            el.id === id ? { ...el, x: snap(newX), y: snap(newY) } : el
          )
        );
      }
    },
    [updateElements, snap]
  );

  // Real-time visual update for followers during multi-drag
  // Uses setElements directly (no save, no history) — onDragStop applies snap + saves
  const handleElemDragMove = useCallback((id: string, newX: number, newY: number) => {
    const ids = selectedIdsRef.current;
    let dx = newX - draggedElementStartPos.current.x;
    let dy = newY - draggedElementStartPos.current.y;

    // Shift+drag: determine and lock axis once movement exceeds threshold.
    // Done BEFORE the early-return so single-element drags also lock their axis.
    // We also update dragAxisState so react-rnd's dragAxis prop physically constrains
    // the leader element's visual position in real-time (not just at drop time).
    if (shiftHeldRef.current) {
      if (!dragAxisRef.current && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
        dragAxisRef.current = Math.abs(dx) >= Math.abs(dy) ? "h" : "v";
        // "h" = horizontal only → lock react-rnd to x-axis
        // "v" = vertical only   → lock react-rnd to y-axis
        setDragAxisState(dragAxisRef.current === "h" ? "x" : "y");
      }
    }

    if (dragAxisRef.current === "h") dy = 0;
    if (dragAxisRef.current === "v") dx = 0;

    // Update ALL selected elements (including the leader) so the group selection
    // overlay stays visually in sync during drag.  React-rnd also has position
    // controlled by element.x/y — since it already moved there visually, setting
    // the prop to the same value causes no stutter.
    if (!ids.includes(id) || ids.length <= 1) {
      // Single-element drag: just keep leader in sync for group overlay
      setElements((prev) => prev.map((el) =>
        el.id === id ? { ...el, x: newX, y: newY } : el
      ));
      return;
    }

    setElements((prev) =>
      prev.map((el) => {
        if (!ids.includes(el.id)) return el;
        if (el.locked) return el; // locked elements never move
        if (el.id === id) return { ...el, x: newX, y: newY }; // leader: sync state to rnd position
        const s = multiDragStartPositions.current.get(el.id);
        if (!s) return el;
        return { ...el, x: s.x + dx, y: s.y + dy };
      })
    );
  }, []);

  // ── Group resize (multi-select) ──
  type ResizePatch = { x: number; y: number; w: number; h: number };
  const handleGroupResizeUpdate = useCallback(
    (updates: Array<{ id: string; patch: ResizePatch }>) => {
      setElements((prev) =>
        prev.map((el) => {
          const u = updates.find((u) => u.id === el.id);
          return u ? { ...el, ...u.patch } : el;
        })
      );
    },
    []
  );

  const handleGroupResizeCommit = useCallback(
    (updates: Array<{ id: string; patch: ResizePatch }>) => {
      updateElements((prev) =>
        prev.map((el) => {
          const u = updates.find((u) => u.id === el.id);
          if (!u) return el;
          return {
            ...el,
            x: snap(u.patch.x),
            y: snap(u.patch.y),
            w: Math.max(40, Math.round(u.patch.w)),
            h: Math.max(24, Math.round(u.patch.h)),
          };
        })
      );
    },
    [updateElements, snap]
  );

  const handleElemResize = useCallback(
    (id: string, x: number, y: number, w: number, h: number) => {
      updateElements((prev) =>
        prev.map((el) => {
          if (el.id !== id) return el;
          const newW = Math.max(40, Math.round(w));
          const newH = Math.max(24, Math.round(h));
          const base = { ...el, x: snap(x), y: snap(y), w: newW, h: newH };
          // Text: font size auto-scales with box height
          if (el.type === "text") {
            const autoFontSize = Math.max(8, Math.round(newH * 0.42));
            return { ...base, fontSize: autoFontSize } as typeof el;
          }
          return base;
        })
      );
    },
    [updateElements, snap]
  );

  const handleElemChange = useCallback(
    (updated: CanvasElement) => {
      updateElements((prev) => prev.map((el) => (el.id === updated.id ? updated : el)));
    },
    [updateElements]
  );

  // ── Toolbar update handler ──
  const handleUpdateMany = useCallback(
    (updates: Array<{ id: string; patch: Record<string, unknown> }>) => {
      updateElements((prev) =>
        prev.map((el) => {
          const upd = updates.find((u) => u.id === el.id);
          if (!upd) return el;
          return { ...el, ...upd.patch };
        })
      );
    },
    [updateElements]
  );

  // ── Pencil stroke handlers ──

  /** Stroke distance check for eraser */
  const distPointToSegment = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return Math.hypot(px - ax, py - ay);
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  };

  /**
   * Commit a finished stroke as a first-class canvas element.
   * Goes through the normal updateElements pipeline → undo/redo + auto-save for free.
   */
  const handleStrokeAdd = useCallback((stroke: Stroke) => {
    const el = strokeToElement(stroke, ++nextZRef.current);
    updateElements((prev) => [...prev, el]);
  }, [updateElements]);

  /**
   * Eraser: partially erase any StrokeElement whose path passes within `radius` of (cx, cy).
   * Splits intersected strokes into sub-strokes around the erased region.
   * Non-stroke elements are never affected by the pencil eraser.
   * History is NOT pushed here — call handleEraseEnd on pencil lift to commit one entry.
   */
  const handleEraseAt = useCallback((cx: number, cy: number, radius: number) => {
    setElements((prev) => {
      let changed = false;
      const next: CanvasElement[] = [];
      for (const el of prev) {
        if (el.type !== "stroke") { next.push(el); continue; }
        const { points } = el.stroke;
        // Quick intersection check before running the full split
        const intersects = points.some((p, i) => {
          if (Math.hypot(p.x - cx, p.y - cy) <= radius) return true;
          if (i > 0) {
            return distPointToSegment(cx, cy, points[i - 1].x, points[i - 1].y, p.x, p.y) <= radius;
          }
          return false;
        });
        if (!intersects) { next.push(el); continue; }
        changed = true;
        const subStrokes = eraseStroke(el.stroke, cx, cy, radius);
        for (const sub of subStrokes) {
          next.push(strokeToElement(sub, ++nextZRef.current));
        }
      }
      if (!changed) return prev;
      scheduleSave({ canvasData: next });
      setSaved(false);
      return next;
    });
  // distPointToSegment is stable (declared in same scope)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheduleSave]);

  /** Push one history entry after an erasing gesture ends (called on pencil lift). */
  const handleEraseEnd = useCallback(() => {
    pushHistory(elementsRef.current);
  }, [pushHistory]);

  /** Pencil undo = regular canvas undo (strokes are canvas elements). */
  const handlePencilUndo = useCallback(() => undo(), [undo]);

  /** Clear all drawn strokes from the canvas. */
  const handlePencilClear = useCallback(() => {
    updateElements((prev) => prev.filter((el) => el.type !== "stroke"));
  }, [updateElements]);

  // Stable ref so native touch handler (empty dep array) always calls latest undo
  const pencilUndoRef = useRef(undo);
  useEffect(() => { pencilUndoRef.current = undo; }, [undo]);

  // ── Export PNG ──
  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      await exportMoodboardAsPng(elementsRef.current, background, title, {
        transparent: exportTransparent,
      });
    } finally {
      setExporting(false);
    }
  }, [background, title, exportTransparent]);

  // ── Add element helpers ──
  const getViewportCenter = useCallback((): { x: number; y: number } => {
    const viewport = viewportRef.current;
    if (!viewport) return { x: 400, y: 300 };
    const { width, height } = viewport.getBoundingClientRect();
    return {
      x: snap((width / 2 - panRef.current.x) / zoomRef.current),
      y: snap((height / 2 - panRef.current.y) / zoomRef.current),
    };
  }, [snap]);

  const addImage = useCallback(
    (item: {
      inspirationId: string;
      storageKey: string;
      thumbnailKey?: string;
      title: string;
      width?: number | null;
      height?: number | null;
      isAnimated?: boolean;
    }) => {
      const { x, y } = getViewportCenter();
      const ratio = item.width && item.height ? item.width / item.height : 16 / 9;
      const W = Math.min(480, Math.max(160, item.width ?? 320));
      const H = Math.round(W / ratio);
      const el: ImageElement = {
        id: makeId(),
        type: "image",
        x: snap(x - W / 2),
        y: snap(y - H / 2),
        w: W,
        h: H,
        zIndex: ++nextZRef.current,
        inspirationId: item.inspirationId,
        storageKey: item.storageKey,
        thumbnailKey: item.thumbnailKey,
        title: item.title,
        aspectRatio: ratio,
        isAnimated: item.isAnimated ?? false,
      };
      updateElements((prev) => [...prev, el]);
    },
    [getViewportCenter, updateElements, snap]
  );

  const addText = useCallback(() => {
    const { x, y } = getViewportCenter();
    const el: TextElement = {
      id: makeId(),
      type: "text",
      x: snap(x - 120),
      y: snap(y - 30),
      w: 240,
      h: 60,
      zIndex: ++nextZRef.current,
      content: "Texte libre",
      fontSize: 18,
      color: "#ffffff",
      bold: false,
      italic: false,
    };
    updateElements((prev) => [...prev, el]);
  }, [getViewportCenter, updateElements, snap]);

  const addColor = useCallback(() => {
    const { x, y } = getViewportCenter();
    const el: ColorElement = {
      id: makeId(),
      type: "color",
      x: snap(x - 80),
      y: snap(y - 50),
      w: 160,
      h: 100,
      zIndex: ++nextZRef.current,
      color: "#3b4bdb",
    };
    updateElements((prev) => [...prev, el]);
  }, [getViewportCenter, updateElements, snap]);

  const addSticky = useCallback(() => {
    const { x, y } = getViewportCenter();
    const el: StickyElement = {
      id: makeId(),
      type: "sticky",
      x: snap(x - 100),
      y: snap(y - 80),
      w: 200,
      h: 160,
      zIndex: ++nextZRef.current,
      content: "Note…",
      backgroundColor: "#fef08a",
      textColor: "#1c1917",
    };
    updateElements((prev) => [...prev, el]);
  }, [getViewportCenter, updateElements, snap]);

  // ── Drop position conversion ──
  const screenToCanvas = useCallback(
    (clientX: number, clientY: number) => {
      const viewport = viewportRef.current;
      if (!viewport) return { x: 80, y: 80 };
      const rect = viewport.getBoundingClientRect();
      return {
        x: snap((clientX - rect.left - panRef.current.x) / zoomRef.current),
        y: snap((clientY - rect.top - panRef.current.y) / zoomRef.current),
      };
    },
    [snap]
  );

  // ── Upload file → library + canvas ──
  const uploadFile = useCallback(
    async (file: File, canvasX: number, canvasY: number, offsetIdx = 0) => {
      // Detect real dimensions before upload
      let naturalRatio = 16 / 9;
      let naturalW = 0;
      let naturalH = 0;
      try {
        const url = URL.createObjectURL(file);
        await new Promise<void>((resolve) => {
          const img = new window.Image();
          img.onload = () => {
            naturalW = img.naturalWidth;
            naturalH = img.naturalHeight;
            if (naturalW && naturalH) naturalRatio = naturalW / naturalH;
            URL.revokeObjectURL(url);
            resolve();
          };
          img.onerror = () => { URL.revokeObjectURL(url); resolve(); };
          img.src = url;
        });
      } catch { /* ignore */ }

      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/upload/image", { method: "POST", body: fd });
      if (!res.ok) return;
      const data = (await res.json()) as {
        inspirationId: string;
        image: { storageKey: string; thumbnailKey?: string };
      };
      const title = file.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ");
      const W = Math.min(480, Math.max(160, naturalW || 400));
      const H = Math.round(W / naturalRatio);
      const el: ImageElement = {
        id: makeId(),
        type: "image",
        x: snap(canvasX + offsetIdx * 24),
        y: snap(canvasY + offsetIdx * 24),
        w: W,
        h: H,
        zIndex: ++nextZRef.current,
        inspirationId: data.inspirationId,
        storageKey: data.image.storageKey,
        thumbnailKey: data.image.thumbnailKey,
        title,
        aspectRatio: naturalRatio,
      };
      updateElements((prev) => [...prev, el]);
      if (aiOnImport.current) {
        fetch(`/api/inspirations/${data.inspirationId}/analyze`, {
          method: "POST",
        }).catch(() => {});
      }
    },
    [updateElements, snap]
  );

  // ── Paste Ctrl+V ──
  useEffect(() => {
    const handler = async (e: ClipboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.isContentEditable || target.tagName === "INPUT") return;
      const files = Array.from(e.clipboardData?.items ?? [])
        .filter((it) => it.type.startsWith("image/"))
        .map((it) => it.getAsFile())
        .filter((f): f is File => f !== null);
      if (files.length === 0) return;
      e.preventDefault();
      setUploading(true);
      const { x, y } = getViewportCenter();
      try {
        await Promise.all(files.map((f, i) => uploadFile(f, x - 160, y - 110, i)));
      } finally {
        setUploading(false);
      }
    };
    window.addEventListener("paste", handler);
    return () => window.removeEventListener("paste", handler);
  }, [uploadFile, getViewportCenter]);

  // ── Library touch-drag add (long-press from LibraryPanel → drop on canvas) ──
  const handleLibraryTouchAdd = useCallback(
    (item: {
      inspirationId: string;
      storageKey: string;
      thumbnailKey?: string;
      title: string;
      width?: number | null;
      height?: number | null;
      isAnimated?: boolean;
    }, clientX: number, clientY: number) => {
      const { x, y } = screenToCanvas(clientX, clientY);
      const ratio = item.width && item.height ? item.width / item.height : 16 / 9;
      const W = Math.min(480, Math.max(160, item.width ?? 400));
      const H = Math.round(W / ratio);
      const el: ImageElement = {
        id:            makeId(),
        type:          "image",
        x:             snap(x - W / 2),
        y:             snap(y - H / 2),
        w:             W,
        h:             H,
        zIndex:        ++nextZRef.current,
        inspirationId: item.inspirationId,
        storageKey:    item.storageKey,
        thumbnailKey:  item.thumbnailKey,
        title:         item.title,
        aspectRatio:   ratio,
        isAnimated:    item.isAnimated ?? false,
      };
      updateElements((prev) => [...prev, el]);
    },
    [screenToCanvas, updateElements, snap]
  );

  // ── Drop handlers ──
  const handleLibraryDrop = useCallback(
    (e: React.DragEvent): boolean => {
      const raw = e.dataTransfer.getData("application/moodboard-item");
      if (!raw) return false;
      const item = JSON.parse(raw) as {
        inspirationId: string;
        storageKey: string;
        thumbnailKey?: string;
        title: string;
        width?: number | null;
        height?: number | null;
        isAnimated?: boolean;
      };
      const ratio = item.width && item.height ? item.width / item.height : 16 / 9;
      const W = Math.min(480, Math.max(160, item.width ?? 400));
      const H = Math.round(W / ratio);
      const { x, y } = screenToCanvas(e.clientX, e.clientY);
      const el: ImageElement = {
        id: makeId(),
        type: "image",
        x: snap(x - W / 2),
        y: snap(y - H / 2),
        w: W,
        h: H,
        zIndex: ++nextZRef.current,
        inspirationId: item.inspirationId,
        storageKey: item.storageKey,
        thumbnailKey: item.thumbnailKey,
        title: item.title,
        aspectRatio: ratio,
        isAnimated: item.isAnimated ?? false,
      };
      updateElements((prev) => [...prev, el]);
      return true;
    },
    [screenToCanvas, updateElements, snap]
  );

  const handleFileDrop = useCallback(
    async (e: React.DragEvent) => {
      const files = Array.from(e.dataTransfer.files).filter((f) =>
        f.type.startsWith("image/")
      );
      if (files.length === 0) return;
      setUploading(true);
      const { x, y } = screenToCanvas(e.clientX, e.clientY);
      try {
        await Promise.all(files.map((f, i) => uploadFile(f, x - 160, y - 110, i)));
      } finally {
        setUploading(false);
      }
    },
    [screenToCanvas, uploadFile]
  );

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const types = Array.from(e.dataTransfer.types);
      const isExternal = types.includes("Files") || types.includes("application/moodboard-item");
      if (!isExternal) return;
      if (handleLibraryDrop(e)) return;
      await handleFileDrop(e);
    },
    [handleLibraryDrop, handleFileDrop]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    // Only react to real external drops (files or library items)
    // — NOT to native drag events fired by <img> elements inside the canvas
    const types = Array.from(e.dataTransfer.types);
    const isExternal = types.includes("Files") || types.includes("application/moodboard-item");
    if (!isExternal) {
      e.dataTransfer.dropEffect = "none";
      return;
    }
    e.dataTransfer.dropEffect = "copy";
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false);
  }, []);

  // ── Metadata changes ──
  const handleTitleChange = (v: string) => {
    setTitle(v);
    scheduleSave({ title: v });
    setSaved(false);
  };

  const handleBackgroundChange = (v: string) => {
    setBackground(v);
    scheduleSave({ background: v });
    setSaved(false);
  };

  // ── Toolbar position (viewport-relative coords, clamped to viewport bounds) ──
  // Reads from refs only — stable callback, no re-render needed.
  const getToolbarPosition = useCallback((): { x: number; y: number } | null => {
    const ids = selectedIdsRef.current;
    if (ids.length === 0) return null;
    const selected = elementsRef.current.filter((el) => ids.includes(el.id));
    if (selected.length === 0) return null;
    const minX = Math.min(...selected.map((el) => el.x));
    const minY = Math.min(...selected.map((el) => el.y));
    const maxX = Math.max(...selected.map((el) => el.x + el.w));
    const rawX = ((minX + maxX) / 2) * zoomRef.current + panRef.current.x;
    const rawY = minY * zoomRef.current + panRef.current.y;
    const vpW = viewportRef.current?.getBoundingClientRect().width ?? 0;
    const margin = 160;
    const clampedX = vpW > 0 ? Math.min(Math.max(rawX, margin), vpW - margin) : rawX;
    return { x: clampedX, y: rawY };
  }, []); // stable — reads from refs only

  // ── Imperative view transform ────────────────────────────────────────────────
  // Applied on every pan/zoom frame without touching React state.
  const applyViewTransform = useCallback((px: number, py: number, z: number) => {
    // 1. Canvas wrapper
    if (canvasWrapperRef.current) {
      canvasWrapperRef.current.style.transform = `translate(${px}px, ${py}px) scale(${z})`;
    }
    // 2. Grid background (backgroundSize + backgroundPosition only; other props stay in JSX)
    const gridSize = GRID_PX * z;
    const vp = viewportRef.current;
    if (vp) {
      vp.style.backgroundSize     = `${gridSize}px ${gridSize}px`;
      vp.style.backgroundPosition = `${px % gridSize}px ${py % gridSize}px`;
    }
    // 3. PencilLayer canvas transform
    pencilLayerRef.current?.notifyPanZoom({ x: px, y: py }, z);
    // 4. Visibility map — only setState when a value actually flips
    if (vp) {
      const vpW = vp.clientWidth;
      const vpH = vp.clientHeight;
      const PAD = 120;
      const newMap: Record<string, boolean> = {};
      let changed = false;
      for (const el of elementsRef.current) {
        if (el.type !== "image") { newMap[el.id] = true; continue; }
        const sx  = px + el.x * z;
        const sy  = py + el.y * z;
        const vis = sx + el.w * z > -PAD && sx < vpW + PAD && sy + el.h * z > -PAD && sy < vpH + PAD;
        newMap[el.id] = vis;
        if (visMapRef.current[el.id] !== vis) changed = true;
      }
      if (changed) { visMapRef.current = newMap; setVisMap({ ...newMap }); }
    }
  }, [getToolbarPosition]);

  // Keep the ref in sync so zoomStepFnRef can always call the latest version.
  applyViewTransformRef.current = applyViewTransform;

  // ── Initial transform on mount ──
  useEffect(() => {
    applyViewTransform(panRef.current.x, panRef.current.y, zoomRef.current);
  }, [applyViewTransform]);

  // ── Dot grid background ──
  const gridStyle: React.CSSProperties = {
    backgroundColor: background,
    backgroundImage: `radial-gradient(circle, rgba(128,128,148,0.22) 1px, transparent 1px)`,
    // Default canvas cursor: custom crosshair SVG (hides OS cursor on empty canvas).
    // Canvas elements override this with their own cursor (react-rnd sets cursor:move).
    cursor: cursor === "default" ? CURSOR_CROSSHAIR_CSS : cursor,
  };

  return (
    <div className="h-screen flex flex-col bg-[var(--bg-base)] overflow-hidden">

      {/* ── Top bar ── */}
      <div className="flex-shrink-0 h-11 border-b border-[var(--border-subtle)] flex items-center gap-2 px-4 select-none overflow-x-auto scrollbar-none" style={{ touchAction: "pan-x" }}>
        <button
          onClick={() => router.push("/moodboards")}
          className="text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors flex-shrink-0"
        >
          ← Planches
        </button>

        <span className="text-[var(--border-default)] text-xs flex-shrink-0">|</span>

        <input
          value={title}
          onChange={(e) => handleTitleChange(e.target.value)}
          className="flex-1 min-w-0 bg-transparent text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
          placeholder="Sans titre"
        />

        <span className="text-[10px] text-[var(--text-tertiary)] flex-shrink-0">
          {uploading ? "Upload…" : saving ? "Sauvegarde…" : saved ? "Sauvegardé" : "…"}
        </span>

        <div className="w-px h-4 bg-[var(--border-subtle)]" />

        {/* Background color */}
        <label className="relative cursor-pointer flex-shrink-0" title="Couleur de fond">
          <span
            className="block w-5 h-5 rounded border border-[var(--border-default)]"
            style={{ backgroundColor: background }}
          />
          <input
            type="color"
            value={background}
            onChange={(e) => handleBackgroundChange(e.target.value)}
            className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
          />
        </label>

        <div className="w-px h-4 bg-[var(--border-subtle)]" />

        {/* Add elements */}
        <button
          onClick={addText}
          className="text-xs text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors px-1.5 py-1 rounded hover:bg-[var(--bg-surface)] flex-shrink-0"
          title="Texte (T)"
        >
          T
        </button>
        <button
          onClick={addColor}
          className="text-xs text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors px-1.5 py-1 rounded hover:bg-[var(--bg-surface)] flex-shrink-0"
          title="Bloc couleur"
        >
          ■
        </button>
        <button
          onClick={addSticky}
          className="text-xs text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors px-1.5 py-1 rounded hover:bg-[var(--bg-surface)] flex-shrink-0"
          title="Note autocollante"
        >
          🗒
        </button>
        <button
          onClick={() => setShowLibrary((v) => !v)}
          className={`text-xs transition-colors px-1.5 py-1 rounded flex-shrink-0 ${
            showLibrary
              ? "bg-[var(--bg-surface)] text-[var(--text-primary)]"
              : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)]"
          }`}
          title="Bibliothèque d'images"
        >
          ◻ Biblio
        </button>

        <div className="w-px h-4 bg-[var(--border-subtle)]" />

        {/* Export group — split button: [↓ PNG | ◫ transparent toggle] */}
        <div className="flex items-center flex-shrink-0 rounded-md border border-[var(--border-subtle)] overflow-hidden select-none">
          {/* Download button */}
          <button
            onClick={handleExport}
            disabled={exporting}
            className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title="Exporter en PNG haute résolution"
          >
            {exporting ? (
              <span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
            ) : (
              /* Arrow-down-to-tray icon */
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M5.5 1v6M2.5 5l3 3 3-3"/>
                <path d="M1 9.5h9"/>
              </svg>
            )}
            PNG
          </button>

          {/* Divider */}
          <div className="w-px self-stretch bg-[var(--border-subtle)]" />

          {/* Transparency toggle */}
          <button
            onClick={() => setExportTransparent((v) => !v)}
            title={exportTransparent ? "Fond transparent — cliquer pour opaque" : "Fond opaque — cliquer pour transparent"}
            className={`px-2 py-1 transition-colors ${
              exportTransparent
                ? "text-[var(--accent,#a78bfa)] bg-[var(--accent,#a78bfa)]/10 hover:bg-[var(--accent,#a78bfa)]/20"
                : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-surface)]"
            }`}
          >
            {/* Checkerboard — universal symbol for transparency */}
            <svg width="11" height="11" viewBox="0 0 10 10" aria-hidden>
              <rect x="0" y="0" width="5" height="5" fill="currentColor" opacity="0.75"/>
              <rect x="5" y="5" width="5" height="5" fill="currentColor" opacity="0.75"/>
              <rect x="5" y="0" width="5" height="5" fill="currentColor" opacity="0.2"/>
              <rect x="0" y="5" width="5" height="5" fill="currentColor" opacity="0.2"/>
            </svg>
          </button>
        </div>

        <button
          onClick={() => setShowShare((v) => !v)}
          className={`text-xs transition-colors px-2 py-1 rounded border flex-shrink-0 ${
            showShare
              ? "bg-[var(--bg-elevated)] border-[var(--border-default)] text-[var(--text-primary)]"
              : "border-[var(--border-subtle)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:border-[var(--border-default)]"
          }`}
        >
          Partager
        </button>

        {/* Apple Pencil drawing mode toggle — touch/iPad only */}
        {isTouchDevice && (
          <button
            onClick={() => { setDrawingMode((v) => !v); }}
            title={drawingMode ? "Quitter le mode dessin" : "Mode dessin Apple Pencil"}
            className={`flex-shrink-0 transition-colors px-2 py-1 rounded border text-xs ${
              drawingMode
                ? "bg-[var(--accent,#a78bfa)]/15 border-[var(--accent,#a78bfa)]/50 text-[var(--accent,#a78bfa)]"
                : "border-[var(--border-subtle)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:border-[var(--border-default)]"
            }`}
          >
            ✒
          </button>
        )}
      </div>

      {/* ── Body ── */}
      <div className="flex-1 flex overflow-hidden">

        {/* Library panel */}
        {showLibrary && (
          <div className="flex-shrink-0 w-64 border-r border-[var(--border-subtle)] overflow-y-auto bg-[var(--bg-base)]">
            <LibraryPanel
              onAdd={addImage}
              onTouchAdd={isTouchDevice ? handleLibraryTouchAdd : undefined}
            />
          </div>
        )}

        {/* Viewport — infinite canvas */}
        <div
          ref={viewportRef}
          className="flex-1 relative overflow-hidden"
          style={{ ...gridStyle, touchAction: "none" }}
          onMouseDown={handleViewportMouseDown}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onDragLeave={handleDragLeave}
        >
          {/* Canvas world (transformed imperatively via canvasWrapperRef) */}
          <div
            ref={canvasWrapperRef}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              transformOrigin: "0 0",
              width: 0,
              height: 0,
              touchAction: "none",
            }}
          >
            {/* Alt+drag ghost copies — non-interactive overlays at original positions.
                Rendered BEFORE the live elements so they sit below them in z-order. */}
            {altDragGhosts?.map((el) => (
              <div
                key={`ghost-${el.id}`}
                style={{
                  position: "absolute",
                  left: el.x,
                  top: el.y,
                  width: el.w,
                  height: el.h,
                  zIndex: el.type === "sticky" ? el.zIndex + 100000 : el.zIndex,
                  opacity: 0.5,
                  pointerEvents: "none",
                  borderRadius: 8,
                  overflow: "hidden",
                  outline: "1.5px dashed rgba(255,255,255,0.6)",
                  outlineOffset: "0px",
                }}
              >
                <ElementContent element={el} selected={false} onChange={() => {}} zoom={rndScale} isVisible />
              </div>
            ))}

            {elements.map((el) => (
              <CanvasItem
                key={el.id}
                element={el}
                selected={selectedIds.includes(el.id)}
                isMultiSelected={selectedIds.length > 1 && selectedIds.includes(el.id)}
                zoom={rndScale}
                isVisible={visMap[el.id] ?? true}
                snapEnabled={snapEnabled}
                shiftHeld={shiftHeld}
                spaceHeld={spaceHeld}
                dragAxis={el.id === draggingId ? dragAxisState : "both"}
                forceDragDisabled={isTouchDevice && !selectedIds.includes(el.id)}
                isTouchDevice={isTouchDevice}
                onSelect={(shift) => handleSelect(el.id, shift)}
                onContextMenu={(cx, cy) => {
                  const vp = viewportRef.current;
                  if (!vp) return;
                  const r = vp.getBoundingClientRect();
                  setContextMenu({ x: cx - r.left, y: cy - r.top });
                }}
                onChange={handleElemChange}
                onDragStart={() => handleElemDragStart(el.id)}
                onDragMove={(x, y) => handleElemDragMove(el.id, x, y)}
                onDragStop={(x, y) => handleElemDragStop(el.id, x, y)}
                onResize={(x, y, w, h) => handleElemResize(el.id, x, y, w, h)}
              />
            ))}
          </div>

          {/* Rubber band selection rect */}
          {rubberBand &&
            Math.abs(rubberBand.ex - rubberBand.sx) > 3 &&
            Math.abs(rubberBand.ey - rubberBand.sy) > 3 && (
              <div
                className="absolute pointer-events-none border border-[var(--accent,#a78bfa)] bg-[var(--accent,#a78bfa)]/10 z-50"
                style={{
                  left: Math.min(rubberBand.sx, rubberBand.ex),
                  top: Math.min(rubberBand.sy, rubberBand.ey),
                  width: Math.abs(rubberBand.ex - rubberBand.sx),
                  height: Math.abs(rubberBand.ey - rubberBand.sy),
                }}
              />
            )}

          {/* Apple Pencil drawing layer — always mounted so canvas state persists */}
          <PencilLayer
            ref={pencilLayerRef}
            active={drawingMode}
            tool={pencilTool}
            color={pencilColor}
            width={pencilSize}
            strokeElements={elements.filter((el) => el.type === "stroke") as StrokeElement[]}
            onStrokeAdd={handleStrokeAdd}
            onEraseAt={handleEraseAt}
            onEraseEnd={handleEraseEnd}
            onToggleEraser={handleToggleEraser}
            viewportRef={viewportRef}
          />

          {/* Pencil floating toolbar — only shown in drawing mode */}
          {drawingMode && (
            <PencilToolbar
              tool={pencilTool}
              color={pencilColor}
              size={pencilSize}
              canUndo={elements.some((el) => el.type === "stroke")}
              canClear={elements.some((el) => el.type === "stroke")}
              onToolChange={setPencilTool}
              onColorChange={setPencilColor}
              onSizeChange={setPencilSize}
              onUndo={handlePencilUndo}
              onClear={handlePencilClear}
              onClose={() => setDrawingMode(false)}
            />
          )}

          {/* Context menu */}
          {contextMenu && (() => {
            const selEls = elements.filter((el) => selectedIds.includes(el.id));
            const hasGroup = selEls.some((el) => el.groupId);
            const canGroup = selectedIds.length > 1;
            const anyLocked = selEls.some((el) => el.locked);
            const allLocked = selEls.length > 0 && selEls.every((el) => el.locked);
            const toggleLock = () => {
              updateElements((prev) =>
                prev.map((el) =>
                  selectedIds.includes(el.id) ? { ...el, locked: !allLocked } : el
                )
              );
              setContextMenu(null);
            };
            return (
              <div
                data-role="context-menu"
                className="absolute z-[300] min-w-[172px] bg-[var(--bg-elevated)] border border-[var(--border-default)] rounded-lg shadow-2xl py-1 text-xs"
                style={{ left: contextMenu.x, top: contextMenu.y }}
                onMouseDown={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
              >
                {canGroup && (
                  <button
                    onClick={handleGroup}
                    className="w-full flex items-center justify-between px-3 py-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)] transition-colors"
                  >
                    <span>Grouper la sélection</span>
                    <kbd className="text-[10px] text-[var(--text-tertiary)] ml-3">Ctrl+G</kbd>
                  </button>
                )}
                {hasGroup && (
                  <button
                    onClick={handleUngroup}
                    className="w-full flex items-center justify-between px-3 py-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)] transition-colors"
                  >
                    <span>Dégrouper</span>
                    <kbd className="text-[10px] text-[var(--text-tertiary)] ml-3">Ctrl+⇧+G</kbd>
                  </button>
                )}
                {(canGroup || hasGroup) && (
                  <div className="my-1 border-t border-[var(--border-subtle)]" />
                )}
                <button
                  onClick={toggleLock}
                  className="w-full flex items-center justify-between px-3 py-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)] transition-colors"
                >
                  <span>{anyLocked ? "Déverrouiller" : "Verrouiller"}</span>
                  <kbd className="text-[10px] text-[var(--text-tertiary)] ml-3">Ctrl+L</kbd>
                </button>
                <div className="my-1 border-t border-[var(--border-subtle)]" />
                <button
                  onClick={() => { deleteSelected(); setContextMenu(null); }}
                  className="w-full flex items-center justify-between px-3 py-1.5 text-red-400 hover:bg-red-500/10 hover:text-red-300 transition-colors"
                >
                  <span>Supprimer</span>
                  <kbd className="text-[10px] ml-3">⌦</kbd>
                </button>
              </div>
            );
          })()}

          {/* Group resize overlay — also shown for single elements on touch
              (react-rnd handles use mouse events which are unreliable on iPad) */}
          {selectedIds.length > 0 && (selectedIds.length > 1 || isTouchDevice) && (
            <GroupResizeOverlay
              selectedElements={elements.filter((el) => selectedIds.includes(el.id))}
              pan={panRef.current}
              zoom={rndScale}
              isTouchDevice={isTouchDevice}
              onUpdate={handleGroupResizeUpdate}
              onCommit={handleGroupResizeCommit}
            />
          )}

          {/* Contextual toolbar — positioned via getToolbarPosition() which reads from refs */}
          {selectedIds.length > 0 && (() => {
            const pos = getToolbarPosition();
            if (!pos) return null;
            return (
              <ContextualToolbar
                elements={elements}
                selectedIds={selectedIds}
                onUpdateMany={handleUpdateMany}
                onDeleteSelected={deleteSelected}
                posX={pos.x}
                posY={pos.y}
                isTouchDevice={isTouchDevice}
              />
            );
          })()}

          {/* Keyboard shortcuts panel — hidden on touch (no physical keyboard) */}
          {!isTouchDevice && <KeyboardShortcutsPanel />}

          {/* Zoom controls (bottom-right) — buttons are 40px on touch for easy tapping */}
          <div
            className="absolute right-4 z-50 flex items-center gap-1 bg-[var(--bg-elevated)]/90 backdrop-blur border border-[var(--border-default)] rounded-lg px-2 py-1 shadow select-none"
            style={{ bottom: "max(1rem, env(safe-area-inset-bottom) + 0.5rem)" }}
          >
            <button
              onClick={() => {
                const vp = viewportRef.current;
                if (!vp) return;
                const r = vp.getBoundingClientRect();
                applyZoom(zoomRef.current * 0.8, r.width / 2, r.height / 2);
              }}
              className={`${isTouchDevice ? "w-10 h-10 text-lg" : "w-5 h-5 text-sm"} text-[var(--text-secondary)] hover:text-[var(--text-primary)] flex items-center justify-center transition-colors`}
              title="Zoom arrière"
            >
              −
            </button>
            <button
              onClick={() => {
                const vp = viewportRef.current;
                if (!vp) return;
                applyZoom(1, vp.getBoundingClientRect().width / 2, vp.getBoundingClientRect().height / 2);
              }}
              className="text-[11px] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] w-10 text-center transition-colors"
              title="Zoom 100 %"
            >
              {Math.round(displayZoom * 100)}%
            </button>
            <button
              onClick={() => {
                const vp = viewportRef.current;
                if (!vp) return;
                const r = vp.getBoundingClientRect();
                applyZoom(zoomRef.current * 1.25, r.width / 2, r.height / 2);
              }}
              className={`${isTouchDevice ? "w-10 h-10 text-lg" : "w-5 h-5 text-sm"} text-[var(--text-secondary)] hover:text-[var(--text-primary)] flex items-center justify-center transition-colors`}
              title="Zoom avant"
            >
              +
            </button>
            <button
              onClick={() => zoomToFit()}
              className={`text-[10px] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] px-1 transition-colors ${isTouchDevice ? "hidden" : ""}`}
              title="Ajuster à tout"
            >
              Ajuster
            </button>
            <div className="w-px h-3 bg-[var(--border-subtle)]" />
            <button
              onClick={() => setSnapEnabled((v) => !v)}
              className={`${isTouchDevice ? "w-10 h-10 text-base" : "text-[10px] px-1"} rounded transition-colors ${
                snapEnabled
                  ? "text-[var(--accent,#a78bfa)]"
                  : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
              }`}
              title="Grille magnétique 8px"
            >
              ⊞
            </button>
            {/* Zoom-to-fit on touch */}
            {isTouchDevice && (
              <>
                <div className="w-px h-3 bg-[var(--border-subtle)]" />
                <button
                  onClick={() => zoomToFit()}
                  className="w-10 h-10 text-base text-[var(--text-tertiary)] hover:text-[var(--text-primary)] flex items-center justify-center transition-colors"
                  title="Ajuster à tout (F)"
                >
                  ⊡
                </button>
              </>
            )}
          </div>

          {/* Grab cursor hint — desktop only */}
          {cursor === "grab" && !isTouchDevice && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-50 pointer-events-none text-[11px] text-[var(--text-tertiary)] bg-[var(--bg-elevated)]/80 px-2 py-1 rounded">
              Espace + glisser pour déplacer
            </div>
          )}

          {/* Drop overlay */}
          {dragOver && (
            <div className="pointer-events-none absolute inset-0 z-[60] flex items-center justify-center border-2 border-dashed border-[var(--accent,#a78bfa)] m-2 rounded-xl">
              <div className="bg-[var(--bg-elevated)]/90 backdrop-blur rounded-xl px-8 py-5 text-sm text-[var(--text-secondary)]">
                Déposer ici
              </div>
            </div>
          )}

          {/* Upload spinner */}
          {uploading && (
            <div className="pointer-events-none absolute top-3 right-3 z-[70] flex items-center gap-2 bg-[var(--bg-elevated)] border border-[var(--border-default)] rounded-lg px-3 py-2 shadow-lg">
              <div className="w-3 h-3 border-2 border-[var(--accent,#a78bfa)] border-t-transparent rounded-full animate-spin" />
              <span className="text-xs text-[var(--text-secondary)]">Upload en cours…</span>
            </div>
          )}
        </div>

        {/* Share panel */}
        {showShare && (
          <div className="flex-shrink-0 w-72 border-l border-[var(--border-subtle)] overflow-y-auto bg-[var(--bg-base)]">
            <SharePanel
              moodboardId={initialData.id}
              shareToken={shareToken}
              shareExpiry={shareExpiry}
              onUpdate={(token, expiry) => {
                setShareToken(token);
                setShareExpiry(expiry);
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Canvas Item (react-rnd wrapper) ──────────────────────────────────────────

interface CanvasItemProps {
  element: CanvasElement;
  selected: boolean;
  isMultiSelected: boolean;
  zoom: number;
  snapEnabled: boolean;
  shiftHeld: boolean;
  spaceHeld: boolean;
  /** Axis constraint for react-rnd — "x", "y", or "both" (default). Applied to the
   *  leader element during Shift+drag so the constraint is visible in real-time. */
  dragAxis: "both" | "x" | "y";
  /** On touch devices, drag is disabled for unselected elements (tap first to select). */
  forceDragDisabled?: boolean;
  /** On touch devices react-rnd resize handles are replaced by GroupResizeOverlay. */
  isTouchDevice?: boolean;
  /** False when the element is outside the visible viewport — image content is skipped. */
  isVisible?: boolean;
  onSelect: (shift: boolean) => void;
  onContextMenu: (clientX: number, clientY: number) => void;
  onChange: (el: CanvasElement) => void;
  onDragStart: () => void;
  onDragMove: (x: number, y: number) => void;
  onDragStop: (x: number, y: number) => void;
  onResize: (x: number, y: number, w: number, h: number) => void;
}

const LockIcon = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" aria-hidden>
    <rect x="2" y="4.5" width="6" height="5" rx="1" />
    <path d="M3 4.5V3a2 2 0 0 1 4 0v1.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
  </svg>
);

function CanvasItem({
  element,
  selected,
  isMultiSelected,
  zoom,
  snapEnabled,
  shiftHeld,
  spaceHeld,
  dragAxis,
  forceDragDisabled,
  isTouchDevice,
  isVisible = true,
  onSelect,
  onContextMenu,
  onChange,
  onDragStart,
  onDragMove,
  onDragStop,
  onResize,
}: CanvasItemProps) {
  // Use inline style for outline — more reliable than Tailwind classes
  // and guarantees "none" on non-selected elements regardless of browser defaults
  const outlineStyle: React.CSSProperties = selected
    ? {
        outline: `2px solid ${isMultiSelected ? "rgba(255,255,255,0.45)" : "rgba(255,255,255,0.9)"}`,
        outlineOffset: "0px",
      }
    : { outline: "none" };

  // Snap grid in screen pixels: SNAP_PX canvas units × zoom = screen pixels
  const gridPx = Math.max(1, SNAP_PX * zoom);
  const dragGrid: [number, number] = snapEnabled ? [gridPx, gridPx] : [1, 1];
  const resizeGrid: [number, number] = snapEnabled ? [gridPx, gridPx] : [1, 1];

  // Aspect ratio lock: images lock by default, Shift unlocks
  let lockAspectRatio: boolean | number = false;
  if (element.type === "image" && !shiftHeld) {
    lockAspectRatio = (element as ImageElement).aspectRatio ?? (element.w / element.h);
  }

  return (
    <Rnd
      position={{ x: element.x, y: element.y }}
      size={{ width: element.w, height: element.h }}
      style={{
        // Sticky notes always render above images/colors/text.
        // The offset is purely visual — stored zIndex is unchanged.
        zIndex: element.type === "sticky" ? element.zIndex + 100000 : element.zIndex,
        opacity: element.opacity ?? 1,
        userSelect: "none",
        // Locked elements: indicate non-interactivity with a not-allowed cursor.
        cursor: element.locked ? "not-allowed" : undefined,
        ...outlineStyle,
      }}
      scale={zoom}
      dragGrid={dragGrid}
      resizeGrid={resizeGrid}
      lockAspectRatio={lockAspectRatio}
      onMouseDown={(e: MouseEvent) => {
        // Only handle left-click here.
        // Middle-click (button=1) must bubble up to the viewport so pan can start.
        // Right-click (button=2) bubbles to viewport but that handler only runs
        // rubber-band for button=0, so nothing bad happens.
        if (e.button !== 0) return;
        // Space + click → pan mode: let the event bubble to the viewport pan handler.
        // Without this check, the element would capture the click and start a drag
        // instead of letting the canvas pan.
        if (spaceHeld) return;
        e.stopPropagation();
        onSelect(e.shiftKey);
      }}
      onContextMenu={(e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        // Selection is already handled by onMouseDown (fired first).
        // Don't call onSelect here — it would trigger a second drag-start
        // position snapshot and potentially snap elements on right-click.
        onContextMenu(e.clientX, e.clientY);
      }}
      onDragStart={() => onDragStart()}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onDrag={(_e: any, d: any) => onDragMove(d.x, d.y)}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onDragStop={(_e: any, d: any) => onDragStop(d.x, d.y)}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onResizeStop={(_e: any, _dir: any, ref: any, _delta: any, pos: any) => {
        onResize(pos.x, pos.y, ref.offsetWidth, ref.offsetHeight);
      }}
      dragAxis={dragAxis}
      enableResizing={selected && !element.locked && !isTouchDevice}
      disableDragging={!!element.locked || !!forceDragDisabled}
      className="canvas-item group"
    >
      <ElementContent element={element} selected={selected} onChange={onChange} zoom={zoom} isVisible={isVisible} />
      {/* Lock indicator — fades in on hover (or when selected) to signal the layer is locked.
          Stays hidden otherwise so it doesn't clutter the canvas at a glance. */}
      {element.locked && (
        <div
          className={`absolute top-1 right-1 pointer-events-none text-white/80 transition-opacity duration-150 ${
            selected ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          }`}
          style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.7))" }}
        >
          <LockIcon />
        </div>
      )}
    </Rnd>
  );
}

// ── Keyboard shortcuts panel ─────────────────────────────────────────────────

type ShortcutGroup = {
  label: string;
  rows: [string, string][]; // [kbd, description]
};

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    label: "Vue",
    rows: [
      ["Espace + glisser", "Déplacer la vue"],
      ["Ctrl + scroll", "Zoom"],
      ["F", "Ajuster à la sélection"],
      ["Shift + 1", "Zoom 100 %"],
    ],
  },
  {
    label: "Sélection",
    rows: [
      ["Clic", "Sélectionner"],
      ["Shift + clic", "Ajouter à la sélection"],
      ["Ctrl + A", "Tout sélectionner"],
      ["Glisser (vide)", "Rectangle de sélection"],
    ],
  },
  {
    label: "Déplacer",
    rows: [
      ["↑ ↓ ← →", "Déplacer 1 px"],
      ["Shift + ↑↓←→", "Déplacer 10 px"],
      ["Shift + glisser", "Contraindre axe H / V"],
      ["Alt + glisser", "Dupliquer en déplaçant"],
    ],
  },
  {
    label: "Éditer",
    rows: [
      ["Ctrl + Z", "Annuler"],
      ["Ctrl + Y", "Rétablir"],
      ["Ctrl + C / V", "Copier / Coller"],
      ["Ctrl + D", "Dupliquer"],
      ["Suppr", "Supprimer"],
      ["Échap", "Désélectionner"],
    ],
  },
  {
    label: "Organiser",
    rows: [
      ["Ctrl + G", "Grouper"],
      ["Ctrl + Shift + G", "Dégrouper"],
      ["Ctrl + L", "Verrouiller / déverrouiller"],
    ],
  },
];

function KeyboardShortcutsPanel() {
  const [open, setOpen] = useState(false);

  return (
    <div
      className="absolute right-4 z-50 flex flex-col items-end gap-2"
      style={{ bottom: "max(3.5rem, env(safe-area-inset-bottom) + 3rem)" }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Panel */}
      {open && (
        <div className="bg-[var(--bg-elevated)]/95 backdrop-blur border border-[var(--border-default)] rounded-xl shadow-2xl overflow-hidden w-72">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--border-subtle)]">
            <span className="text-[11px] font-medium text-[var(--text-secondary)] tracking-wide uppercase">
              Raccourcis clavier
            </span>
            <button
              onClick={() => setOpen(false)}
              className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors text-xs"
            >
              ✕
            </button>
          </div>

          {/* Shortcut groups */}
          <div className="overflow-y-auto max-h-[70vh] py-1">
            {SHORTCUT_GROUPS.map((group, gi) => (
              <div key={gi}>
                {/* Category label */}
                <p className="px-4 pt-3 pb-1 text-[9px] uppercase tracking-widest text-[var(--text-tertiary)] font-semibold">
                  {group.label}
                </p>
                {group.rows.map(([kbd, desc], ri) => (
                  <div
                    key={ri}
                    className="flex items-center justify-between px-4 py-1 gap-3 hover:bg-[var(--bg-overlay)]/40 transition-colors"
                  >
                    <span className="text-[11px] text-[var(--text-secondary)] flex-1 min-w-0">
                      {desc}
                    </span>
                    <kbd className="flex-shrink-0 text-[10px] text-[var(--text-tertiary)] bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded px-1.5 py-0.5 font-mono whitespace-nowrap">
                      {kbd}
                    </kbd>
                  </div>
                ))}
              </div>
            ))}
          </div>

          {/* Footer */}
          <div className="border-t border-[var(--border-subtle)] px-4 py-2 text-center">
            <span className="text-[10px] text-[var(--text-tertiary)]">
              Shift maintenu · Snap désactivé sur les images
            </span>
          </div>
        </div>
      )}

      {/* Toggle button */}
      <button
        onClick={() => setOpen((v) => !v)}
        title="Raccourcis clavier"
        className={`w-7 h-7 rounded-full border shadow transition-all flex items-center justify-center text-[12px] font-semibold ${
          open
            ? "bg-[var(--bg-elevated)] border-[var(--border-strong)] text-[var(--text-primary)]"
            : "bg-[var(--bg-elevated)]/80 backdrop-blur border-[var(--border-default)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:border-[var(--border-strong)]"
        }`}
      >
        ?
      </button>
    </div>
  );
}

// ── Element content renderer ─────────────────────────────────────────────────

function ElementContent({
  element,
  selected,
  onChange,
  zoom = 1,
  isVisible = true,
}: {
  element: CanvasElement;
  selected: boolean;
  onChange: (el: CanvasElement) => void;
  zoom?: number;
  isVisible?: boolean;
}) {
  const br = 8; // border radius (design constant)

  if (element.type === "image") {
    const el = element as ImageElement;
    const fit = el.objectFit ?? "cover";

    // Off-screen: render an empty placeholder so the Rnd wrapper stays intact
    // but the browser never requests or decodes the image.
    if (!isVisible) {
      return <div className="w-full h-full" style={{ borderRadius: br }} />;
    }

    // LOD: use the 600 px WebP thumbnail when the element is small on screen,
    // switch to the full original once it needs more pixels.
    // Threshold: screen px (CSS) = el.w * zoom. Thumbnail is max 600 px wide.
    const screenPx = el.w * zoom;
    const url =
      el.thumbnailKey && screenPx <= 600
        ? getThumbnailUrl(el.thumbnailKey)
        : getImageUrl(el.storageKey);

    return (
      // pointer-events:none on the visual layer — the Rnd wrapper handles all
      // mouse events. This prevents the browser from showing its native image
      // hover/selection highlight on non-selected elements.
      <div
        className="w-full h-full overflow-hidden relative pointer-events-none"
        style={{ borderRadius: br }}
      >
        <img
          src={url}
          alt={el.title}
          draggable={false}
          className={`absolute inset-0 w-full h-full ${fit === "contain" ? "object-contain" : "object-cover"}`}
        />
      </div>
    );
  }

  if (element.type === "text") {
    const el = element as TextElement;
    return (
      <div className="w-full h-full flex items-start p-1.5" style={{ borderRadius: br }}>
        <div
          contentEditable={selected}
          suppressContentEditableWarning
          onMouseDown={(e) => { if (selected) e.stopPropagation(); }}
          onBlur={(e) =>
            onChange({ ...el, content: e.currentTarget.textContent ?? "" })
          }
          className="outline-none w-full break-words"
          style={{
            fontSize: el.fontSize,
            color: el.color,
            fontWeight: el.bold ? "bold" : "normal",
            fontStyle: el.italic ? "italic" : "normal",
            lineHeight: 1.4,
            userSelect: selected ? "text" : "none",
          }}
        >
          {el.content}
        </div>
      </div>
    );
  }

  if (element.type === "color") {
    const el = element as ColorElement;
    return (
      <div
        className="w-full h-full"
        style={{ backgroundColor: el.color, borderRadius: br }}
      />
    );
  }

  if (element.type === "sticky") {
    const el = element as StickyElement;
    return (
      <div
        className="w-full h-full flex flex-col p-3 shadow-md"
        style={{
          backgroundColor: el.backgroundColor,
          borderRadius: br,
          // Subtle top-right fold effect
          boxShadow: "2px 3px 8px rgba(0,0,0,0.2)",
        }}
      >
        <div
          contentEditable={selected}
          suppressContentEditableWarning
          onMouseDown={(e) => { if (selected) e.stopPropagation(); }}
          onBlur={(e) =>
            onChange({ ...el, content: e.currentTarget.textContent ?? "" })
          }
          className="outline-none flex-1 break-words text-sm leading-relaxed"
          style={{
            color: el.textColor,
            userSelect: selected ? "text" : "none",
          }}
        >
          {el.content}
        </div>
      </div>
    );
  }

  if (element.type === "stroke") {
    // The visual is rendered by the PencilLayer canvas overlay.
    // This transparent div is the hit area for selection / drag / resize via react-rnd.
    return <div className="w-full h-full" />;
  }

  return null;
}

// ── Group/Selection Resize Overlay ──────────────────────────────────────────
// Renders a dashed bounding box with 8 resize handles around any selection.
// On desktop: shown for multi-selection only (react-rnd handles single elements).
// On touch: shown for single AND multi-selection (react-rnd handles don't work well).
// Handles are in viewport coords; drag deltas are converted to canvas units.

type ResizePatch = { x: number; y: number; w: number; h: number };

interface GroupResizeOverlayProps {
  selectedElements: CanvasElement[];
  pan: { x: number; y: number };
  zoom: number;
  isTouchDevice: boolean;
  onUpdate: (updates: Array<{ id: string; patch: ResizePatch }>) => void;
  onCommit: (updates: Array<{ id: string; patch: ResizePatch }>) => void;
}

function GroupResizeOverlay({
  selectedElements,
  pan,
  zoom,
  isTouchDevice,
  onUpdate,
  onCommit,
}: GroupResizeOverlayProps) {
  if (selectedElements.length < 1) return null;

  const gx  = Math.min(...selectedElements.map((el) => el.x));
  const gy  = Math.min(...selectedElements.map((el) => el.y));
  const gx2 = Math.max(...selectedElements.map((el) => el.x + el.w));
  const gy2 = Math.max(...selectedElements.map((el) => el.y + el.h));
  const gw  = gx2 - gx;
  const gh  = gy2 - gy;

  // Viewport coords
  const vx = gx * zoom + pan.x;
  const vy = gy * zoom + pan.y;
  const vw = gw * zoom;
  const vh = gh * zoom;

  const HANDLE = isTouchDevice ? 20 : 7;

  const handles: Array<{ dir: string; cx: number; cy: number; cursor: string }> = [
    { dir: "nw", cx: 0,    cy: 0,    cursor: "nw-resize" },
    { dir: "n",  cx: vw/2, cy: 0,    cursor: "n-resize"  },
    { dir: "ne", cx: vw,   cy: 0,    cursor: "ne-resize" },
    { dir: "e",  cx: vw,   cy: vh/2, cursor: "e-resize"  },
    { dir: "se", cx: vw,   cy: vh,   cursor: "se-resize" },
    { dir: "s",  cx: vw/2, cy: vh,   cursor: "s-resize"  },
    { dir: "sw", cx: 0,    cy: vh,   cursor: "sw-resize" },
    { dir: "w",  cx: 0,    cy: vh/2, cursor: "w-resize"  },
  ];

  // Shared resize logic — called by both mouse and touch handlers
  const startResize = (dir: string, startMX: number, startMY: number, isTouch: boolean) => {
    // Capture bounding box at drag-start time
    const origGx = gx, origGy = gy, origGw = gw, origGh = gh;
    const capturedZoom = zoom;

    const relData = selectedElements.map((el) => ({
      id: el.id,
      relX: origGw > 0 ? (el.x - origGx) / origGw : 0,
      relY: origGh > 0 ? (el.y - origGy) / origGh : 0,
      relW: origGw > 0 ? el.w / origGw : 1,
      relH: origGh > 0 ? el.h / origGh : 1,
    }));

    const AR = origGw / Math.max(1, origGh);

    // free = false → maintain aspect ratio; free = true → Shift held (mouse only)
    const compute = (clientX: number, clientY: number, free: boolean) => {
      const dx = (clientX - startMX) / capturedZoom;
      const dy = (clientY - startMY) / capturedZoom;

      let ngx  = origGx,          ngy  = origGy;
      let ngx2 = origGx + origGw, ngy2 = origGy + origGh;

      if (dir === "nw" || dir === "w" || dir === "sw") ngx  = origGx + dx;
      if (dir === "ne" || dir === "e" || dir === "se") ngx2 = origGx + origGw + dx;
      if (dir === "nw" || dir === "n" || dir === "ne") ngy  = origGy + dy;
      if (dir === "sw" || dir === "s" || dir === "se") ngy2 = origGy + origGh + dy;

      let ngw = Math.max(80, ngx2 - ngx);
      let ngh = Math.max(40, ngy2 - ngy);

      if (!free) {
        if (dir === "n" || dir === "s") {
          ngw = Math.max(80, ngh * AR);
          ngx = origGx + origGw / 2 - ngw / 2;
        } else if (dir === "e" || dir === "w") {
          ngh = Math.max(40, ngw / AR);
          ngy = origGy + origGh / 2 - ngh / 2;
        } else {
          ngh = Math.max(40, ngw / AR);
          if (dir === "nw" || dir === "ne") ngy = (origGy + origGh) - ngh;
          if (dir === "nw" || dir === "sw") ngx = (origGx + origGw) - ngw;
        }
      }

      return relData.map(({ id, relX, relY, relW, relH }) => ({
        id,
        patch: {
          x: ngx + relX * ngw,
          y: ngy + relY * ngh,
          w: Math.max(20, relW * ngw),
          h: Math.max(10, relH * ngh),
        },
      }));
    };

    if (isTouch) {
      const onMove = (ev: TouchEvent) => {
        ev.preventDefault();
        if (ev.touches.length > 0)
          onUpdate(compute(ev.touches[0].clientX, ev.touches[0].clientY, false));
      };
      const onEnd = (ev: TouchEvent) => {
        document.removeEventListener("touchmove",  onMove);
        document.removeEventListener("touchend",   onEnd);
        document.removeEventListener("touchcancel", onEnd);
        const t = ev.changedTouches[0];
        if (t) onCommit(compute(t.clientX, t.clientY, false));
      };
      document.addEventListener("touchmove",  onMove,  { passive: false });
      document.addEventListener("touchend",   onEnd);
      document.addEventListener("touchcancel", onEnd);
    } else {
      const onMove = (ev: MouseEvent) => onUpdate(compute(ev.clientX, ev.clientY, ev.shiftKey));
      const onUp   = (ev: MouseEvent) => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup",   onUp);
        onCommit(compute(ev.clientX, ev.clientY, ev.shiftKey));
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup",   onUp);
    }
  };

  const onHandleMouseDown = (dir: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    startResize(dir, e.clientX, e.clientY, false);
  };

  const onHandleTouchStart = (dir: string, e: React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const t = e.touches[0];
    if (t) startResize(dir, t.clientX, t.clientY, true);
  };

  return (
    <div
      className="absolute pointer-events-none"
      style={{ left: vx, top: vy, width: vw, height: vh, zIndex: 99998,
               border: "1px dashed rgba(255,255,255,0.35)" }}
    >
      {handles.map(({ dir, cx, cy, cursor }) => (
        <div
          key={dir}
          data-role="resize-handle"
          className="absolute pointer-events-auto"
          style={{
            left: cx - HANDLE / 2,
            top:  cy - HANDLE / 2,
            width: HANDLE,
            height: HANDLE,
            background: "white",
            border: "1px solid rgba(0,0,0,0.35)",
            borderRadius: 1,
            cursor,
            touchAction: "none",
          }}
          onMouseDown={(e) => onHandleMouseDown(dir, e)}
          onTouchStart={(e) => onHandleTouchStart(dir, e)}
        />
      ))}
    </div>
  );
}
