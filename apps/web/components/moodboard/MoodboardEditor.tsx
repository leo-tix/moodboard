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
  ShapeElement,
  LinearElement,
  LinearPoint,
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
const SNAP_PX = 8;    // minimum shape size reference (snap disabled)
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

  // ── Shape / Vector tool system ───────────────────────────────────────────────
  type ActiveTool = "select" | "rectangle" | "ellipse" | "diamond" | "line" | "arrow" | "text";
  const [activeTool, setActiveTool] = useState<ActiveTool>("select");
  const activeToolRef = useRef<ActiveTool>("select");
  useEffect(() => { activeToolRef.current = activeTool; }, [activeTool]);

  // Tool property defaults — persisted across placements (like Excalidraw)
  const [toolFillColor,   setToolFillColor]   = useState("transparent");
  const [toolStrokeColor, setToolStrokeColor] = useState("#ffffff");
  const [toolStrokeWidth, setToolStrokeWidth] = useState(2);
  const [toolStrokeStyle, setToolStrokeStyle] = useState<"solid"|"dashed"|"dotted">("solid");
  const [toolArrowStart,  setToolArrowStart]  = useState<"none"|"arrow">("none");
  const [toolArrowEnd,    setToolArrowEnd]    = useState<"none"|"arrow">("arrow");
  const [toolFontSize,    setToolFontSize]    = useState(40);
  const [toolTextColor,   setToolTextColor]   = useState("#ffffff");
  const [toolTextAlign,   setToolTextAlign]   = useState<"left"|"center"|"right">("left");
  // Ref mirror so document-level handlers always see the latest values
  const toolPropsRef = useRef({
    fillColor: "transparent", strokeColor: "#ffffff", strokeWidth: 2,
    strokeStyle: "solid" as "solid"|"dashed"|"dotted",
    arrowStart: "none" as "none"|"arrow", arrowEnd: "arrow" as "none"|"arrow",
    fontSize: 40, textColor: "#ffffff", textAlign: "left" as "left"|"center"|"right",
  });
  useEffect(() => {
    toolPropsRef.current = {
      fillColor: toolFillColor, strokeColor: toolStrokeColor,
      strokeWidth: toolStrokeWidth, strokeStyle: toolStrokeStyle,
      arrowStart: toolArrowStart, arrowEnd: toolArrowEnd,
      fontSize: toolFontSize, textColor: toolTextColor, textAlign: toolTextAlign,
    };
  }, [toolFillColor, toolStrokeColor, toolStrokeWidth, toolStrokeStyle,
      toolArrowStart, toolArrowEnd, toolFontSize, toolTextColor, toolTextAlign]);

  // ── Drawing preview states ───────────────────────────────────────────────────
  const [shapeDrawing, setShapeDrawing] = useState<{
    startX: number; startY: number; endX: number; endY: number; shiftLock: boolean;
  } | null>(null);
  const shapeDrawingRef = useRef<typeof shapeDrawing>(null);

  const [linearInProgress, setLinearInProgress] = useState<{
    points: LinearPoint[]; cursor: LinearPoint;
  } | null>(null);
  const linearInProgressRef = useRef<typeof linearInProgress>(null);
  const linearLastClickRef  = useRef(0);
  // Linear point being dragged in the edit overlay (live preview only)
  const [linearDragPreview, setLinearDragPreview] = useState<LinearElement | null>(null);

  // ── Text editing (Excalidraw-style floating textarea) ────────────────────────
  const [textEditingId, setTextEditingId] = useState<string | null>(null);
  const textEditingIdRef = useRef<string | null>(null);
  const textareaRef      = useRef<HTMLTextAreaElement | null>(null);
  /** Hidden div used to measure text width during editing (same font as the textarea). */
  const measureSpanRef   = useRef<HTMLDivElement | null>(null);
  /** Persistent hidden div for measuring text height at a given width during resize. */
  const textMeasureDivRef = useRef<HTMLDivElement | null>(null);
  /** Captures initial dimensions + fontSize at resize start for proportional font scaling. */
  const resizeStartRef   = useRef<{ id: string; w: number; h: number; fontSize: number } | null>(null);

  // ── Refs (avoid stale closures in event handlers) ──
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasWrapperRef = useRef<HTMLDivElement>(null);
  const overlayLayerRef  = useRef<HTMLDivElement>(null);
  const pencilLayerRef   = useRef<PencilLayerHandle | null>(null);
  const visMapRef        = useRef<Record<string, boolean>>({});
  const [visMap, setVisMap] = useState<Record<string, boolean>>({});
  const panRef = useRef({ x: 80, y: 60 });
  const zoomRef = useRef(1);
  const selectedIdsRef = useRef(selectedIds);
  const elementsRef = useRef(elements);

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

  useEffect(() => {
    aiOnImport.current = localStorage.getItem(AI_IMPORT_KEY) === "true";
  }, []);

  // Detect touch device after mount (no SSR mismatch)
  useEffect(() => {
    setIsTouchDevice(navigator.maxTouchPoints > 1);
  }, []);

  // ── Snap helper (snap disabled — always returns value as-is) ──
  const snap = useCallback((v: number) => v, []);

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

  // Stable ref wrappers for tool callbacks used inside the [] touch useEffect.
  // Pattern: ref is created once, updated every render so the closure always gets
  // the latest function without the effect needing to re-register listeners.
  const commitShapeRef  = useRef<(sx: number, sy: number, ex: number, ey: number) => void>(() => {});
  const commitLinearRef = useRef<(pts: LinearPoint[]) => void>(() => {});
  const placeTextAtRef  = useRef<(cx: number, cy: number) => void>(() => {});
  /** Tracks the canvas-coord start of a touch-drag shape draw. */
  const touchShapeStartRef = useRef<{ x: number; y: number } | null>(null);

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
        // Cancel any in-progress shape draw (second finger interrupted)
        if (touchShapeStartRef.current) {
          touchShapeStartRef.current = null;
          shapeDrawingRef.current = null;
          setShapeDrawing(null);
        }
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
          // ── Empty canvas — route by active tool ──
          touchStartedOnElementRef.current = false;
          e.preventDefault(); // always prevent scroll/zoom and synthetic mouse events

          const tool = activeToolRef.current;

          // ── Text tool: record position, commit placement in onTouchEnd ──
          if (tool === "text") {
            longPressPosRef.current = { clientX: touch.clientX, clientY: touch.clientY };
            // No pan, no rubber band — just wait for lift
            return;
          }

          // ── Shape tools: init touch-draw (move updates preview, lift commits) ──
          if (tool === "rectangle" || tool === "ellipse" || tool === "diamond") {
            const sx = (viewX - panRef.current.x) / zoomRef.current;
            const sy = (viewY - panRef.current.y) / zoomRef.current;
            touchShapeStartRef.current = { x: sx, y: sy };
            const initState = { startX: sx, startY: sy, endX: sx, endY: sy, shiftLock: false };
            shapeDrawingRef.current = initState;
            setShapeDrawing(initState);
            return;
          }

          // ── Linear tools: tap-to-add-points, double-tap to commit (handled in onTouchEnd) ──
          if (tool === "line" || tool === "arrow") {
            longPressPosRef.current = { clientX: touch.clientX, clientY: touch.clientY };
            return;
          }

          // ── Default (select tool): pan + long-press rubber band ──
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

        // ── Shape drawing: live preview update ──
        if (touchShapeStartRef.current) {
          e.preventDefault();
          const rect = viewport.getBoundingClientRect();
          const vx = touch.clientX - rect.left;
          const vy = touch.clientY - rect.top;
          const cx = (vx - panRef.current.x) / zoomRef.current;
          const cy = (vy - panRef.current.y) / zoomRef.current;
          const prev = shapeDrawingRef.current;
          if (prev) {
            const s = { ...prev, endX: cx, endY: cy };
            shapeDrawingRef.current = s;
            setShapeDrawing(s);
          }
          return;
        }

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

      // ── Shape tool: commit on finger lift ──
      if (touchShapeStartRef.current) {
        const sd = shapeDrawingRef.current;
        if (sd) {
          const minSz = 8 / zoomRef.current;
          if (Math.abs(sd.endX - sd.startX) > minSz || Math.abs(sd.endY - sd.startY) > minSz) {
            commitShapeRef.current(sd.startX, sd.startY, sd.endX, sd.endY);
          } else {
            // Tap with no drag → place default-sized shape centered on tap
            commitShapeRef.current(sd.startX - 80, sd.startY - 50, sd.startX + 80, sd.startY + 50);
          }
        }
        touchShapeStartRef.current = null;
        shapeDrawingRef.current = null;
        setShapeDrawing(null);
        clearLongPress();
        touchPanRef.current = null;
        touchDidPanRef.current = false;
        touchStartedOnElementRef.current = false;
        return;
      }

      // ── Text tool: place on tap (position from changedTouches) ──
      if (activeToolRef.current === "text" && !touchDidPanRef.current && e.changedTouches.length > 0) {
        const t = e.changedTouches[0];
        const r = viewport.getBoundingClientRect();
        const vx = t.clientX - r.left;
        const vy = t.clientY - r.top;
        const cx = (vx - panRef.current.x) / zoomRef.current;
        const cy = (vy - panRef.current.y) / zoomRef.current;
        placeTextAtRef.current(cx, cy);
        clearLongPress();
        touchPanRef.current = null;
        touchDidPanRef.current = false;
        touchStartedOnElementRef.current = false;
        return;
      }

      // ── Linear tool: tap to add point / double-tap to commit ──
      if ((activeToolRef.current === "line" || activeToolRef.current === "arrow")
          && !touchDidPanRef.current && e.changedTouches.length > 0) {
        const t = e.changedTouches[0];
        const r = viewport.getBoundingClientRect();
        const vx = t.clientX - r.left;
        const vy = t.clientY - r.top;
        const cx = (vx - panRef.current.x) / zoomRef.current;
        const cy = (vy - panRef.current.y) / zoomRef.current;
        const now = Date.now();
        const isDbl = now - linearLastClickRef.current < 500 && linearInProgressRef.current !== null;
        linearLastClickRef.current = now;
        if (isDbl && linearInProgressRef.current) {
          // Double-tap: commit, finalise at tap position
          const pts = linearInProgressRef.current.points;
          const finalPts = pts.length >= 3 ? pts.slice(0, -1) : [...pts];
          if (finalPts.length > 0) finalPts[finalPts.length - 1] = { x: cx, y: cy };
          commitLinearRef.current(finalPts);
        } else if (!linearInProgressRef.current) {
          // First tap: create initial point
          const state = { points: [{ x: cx, y: cy }], cursor: { x: cx, y: cy } };
          linearInProgressRef.current = state;
          setLinearInProgress(state);
        } else {
          // Subsequent tap: add waypoint
          const prev = linearInProgressRef.current;
          const newPts = [...prev.points, { x: cx, y: cy }];
          const state = { points: newPts, cursor: { x: cx, y: cy } };
          linearInProgressRef.current = state;
          setLinearInProgress({ ...state });
        }
        clearLongPress();
        touchPanRef.current = null;
        touchDidPanRef.current = false;
        touchStartedOnElementRef.current = false;
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
        // Commit any active text editing (safety net for stuck state)
        if (textEditingIdRef.current) {
          commitTextEdit();
          return;
        }
        // Cancel in-progress drawing first
        if (linearInProgressRef.current) {
          linearInProgressRef.current = null;
          setLinearInProgress(null);
          setActiveTool("select");
          activeToolRef.current = "select";
          return;
        }
        if (shapeDrawingRef.current) {
          shapeDrawingRef.current = null;
          setShapeDrawing(null);
          setActiveTool("select");
          activeToolRef.current = "select";
          return;
        }
        if (activeToolRef.current !== "select") {
          setActiveTool("select");
          activeToolRef.current = "select";
          return;
        }
        setSelectedIds([]);
        selectedIdsRef.current = [];
        setContextMenu(null);
        return;
      }

      // ── Tool shortcuts (only when not editing text) ──
      if (inInput) return;

      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        const toolMap: Record<string, typeof activeToolRef.current> = {
          v: "select", r: "rectangle", e: "ellipse",
          l: "line", a: "arrow", t: "text",
        };
        const mapped = toolMap[e.key.toLowerCase()];
        if (mapped) {
          e.preventDefault();
          // Cancel any in-progress drawing
          linearInProgressRef.current = null; setLinearInProgress(null);
          shapeDrawingRef.current = null; setShapeDrawing(null);
          setActiveTool(mapped);
          activeToolRef.current = mapped;
          return;
        }
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

  // NOTE: textarea focus is handled via ref callback (see JSX below) — no useEffect needed.

  // ── Viewport mouse handlers (pan + rubber band) ──
  const handleViewportMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    // Ignore synthetic mouse events that originate from Apple Pencil in drawing mode
    if (drawingModeRef.current) return;
    // If a text element is being edited, commit it and swallow the click.
    // The user clicked away from the textarea — just finish the edit; don't
    // start a new action (even if the text tool is still active).
    // commitTextEdit() synchronously sets activeToolRef.current = "select", so
    // the rest of the handler (pan / rubber-band / placeTextAt) is skipped.
    if (textEditingIdRef.current) {
      // preventDefault: same reason as the text-tool placement case below —
      // prevents the browser from moving focus to body after the handler, which
      // would trigger a second onBlur → commitTextEdit call.
      e.preventDefault();
      commitTextEdit();
      return;
    }

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
      setContextMenu(null);
      const tool = activeToolRef.current;
      const viewport = e.currentTarget as HTMLDivElement;
      const rect = viewport.getBoundingClientRect();

      // ── Text tool: click to place ──
      if (tool === "text") {
        // preventDefault stops the browser's post-mousedown native focus management
        // (which would move focus to document.body, immediately blurring the textarea
        // we are about to create and triggering an unwanted commitTextEdit call).
        e.preventDefault();
        const pos = screenToCanvasRaw(e.clientX, e.clientY);
        placeTextAt(pos.x, pos.y);
        return;
      }

      // ── Shape tools: drag to draw ──
      if (tool === "rectangle" || tool === "ellipse" || tool === "diamond") {
        e.preventDefault();
        const start = screenToCanvasRaw(e.clientX, e.clientY);
        const initState = { startX: start.x, startY: start.y, endX: start.x, endY: start.y, shiftLock: false };
        shapeDrawingRef.current = initState;
        setShapeDrawing(initState);

        const onMove = (ev: MouseEvent) => {
          const cur = screenToCanvasRaw(ev.clientX, ev.clientY);
          let endX = cur.x;
          let endY = cur.y;
          let shiftLock = false;
          if (ev.shiftKey) {
            // Shift = constrain to square
            const dx = Math.abs(endX - start.x);
            const dy = Math.abs(endY - start.y);
            const side = Math.max(dx, dy);
            endX = start.x + Math.sign(endX - start.x) * side;
            endY = start.y + Math.sign(endY - start.y) * side;
            shiftLock = true;
          }
          const s = { startX: start.x, startY: start.y, endX, endY, shiftLock };
          shapeDrawingRef.current = s;
          setShapeDrawing(s);
        };
        const onUp = (ev: MouseEvent) => {
          const cur = screenToCanvasRaw(ev.clientX, ev.clientY);
          let endX = cur.x;
          let endY = cur.y;
          if (ev.shiftKey) {
            const dx = Math.abs(endX - start.x);
            const dy = Math.abs(endY - start.y);
            const side = Math.max(dx, dy);
            endX = start.x + Math.sign(endX - start.x) * side;
            endY = start.y + Math.sign(endY - start.y) * side;
          }
          const minSz = 8 / zoomRef.current;
          if (Math.abs(endX - start.x) > minSz || Math.abs(endY - start.y) > minSz) {
            commitShape(start.x, start.y, endX, endY);
          } else {
            // Small click = place default-sized shape centered on click
            commitShape(start.x - 80, start.y - 50, start.x + 80, start.y + 50);
          }
          document.removeEventListener("mousemove", onMove);
          document.removeEventListener("mouseup", onUp);
        };
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
        return;
      }

      // ── Linear tools: click to add points, double-click to commit ──
      if (tool === "line" || tool === "arrow") {
        e.preventDefault();
        const pos = screenToCanvasRaw(e.clientX, e.clientY);
        const now = Date.now();
        // Double-click = second click within 500ms AND at least 2 points already placed.
        // Requiring ≥ 2 points prevents silently cancelling a fresh line when the user
        // clicks twice quickly to start (which was treated as double-click + commitLinear
        // with 1 point → silent failure → line disappeared).
        const isDbl = now - linearLastClickRef.current < 500
          && linearInProgressRef.current !== null
          && linearInProgressRef.current.points.length >= 2;
        linearLastClickRef.current = now;

        if (isDbl && linearInProgressRef.current) {
          // Double-click: commit — finalise at the exact click position
          const pts = linearInProgressRef.current.points;
          // Remove the last auto-waypoint added by the previous single click if ≥ 3 pts
          const finalPts = pts.length >= 3 ? pts.slice(0, -1) : [...pts];
          finalPts[finalPts.length - 1] = pos;
          commitLinear(finalPts);
          return;
        }

        if (!linearInProgressRef.current) {
          // First point
          const state = { points: [{ ...pos }], cursor: { ...pos } };
          linearInProgressRef.current = state;
          setLinearInProgress(state);

          const onMove = (ev: MouseEvent) => {
            const cur = screenToCanvasRaw(ev.clientX, ev.clientY);
            if (!linearInProgressRef.current) return;
            const pts = [...linearInProgressRef.current.points, cur];
            // Replace the "ghost" last point with cursor
            const state = { points: linearInProgressRef.current.points, cursor: cur };
            linearInProgressRef.current = state;
            setLinearInProgress({ ...state });
          };
          const onEsc = (ev: KeyboardEvent) => {
            if (ev.key === "Escape") {
              linearInProgressRef.current = null;
              setLinearInProgress(null);
              setActiveTool("select");
              activeToolRef.current = "select";
              document.removeEventListener("mousemove", onMove);
              document.removeEventListener("keydown", onEsc);
            }
          };
          document.addEventListener("mousemove", onMove);
          document.addEventListener("keydown", onEsc);
        } else {
          // Add waypoint at clicked position
          const prev = linearInProgressRef.current;
          const newPts = [...prev.points, { ...pos }];
          const state = { points: newPts, cursor: { ...pos } };
          linearInProgressRef.current = state;
          setLinearInProgress({ ...state });
        }
        return;
      }

      // ── Select tool: rubber band ──
      if (!e.shiftKey) setSelectedIds([]);
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
            .filter((el) => el.x < x2 && el.x + el.w > x1 && el.y < y2 && el.y + el.h > y1)
            .map((el) => el.id);
          const nextIds = e.shiftKey ? [...new Set([...selectedIdsRef.current, ...ids])] : ids;
          selectedIdsRef.current = nextIds;
          setSelectedIds(nextIds);
        }
        setRubberBand(null);
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
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

      // For multi-element drag: snap the leader's delta and apply it uniformly to all
      // followers so relative positions within the group are perfectly preserved.
      // (Snapping each element independently would round differently → group drifts.)
      const ldr = multiDragStartPositions.current.get(id);
      const sdx = (ids.length > 1 && ldr) ? snap(ldr.x + dx) - ldr.x : dx;
      const sdy = (ids.length > 1 && ldr) ? snap(ldr.y + dy) - ldr.y : dy;

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
            if (ids.length > 1) return { ...el, x: s.x + sdx, y: s.y + sdy };
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
            return { ...el, x: s.x + sdx, y: s.y + sdy };
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
  type ResizePatch = { x: number; y: number; w: number; h: number; fontSize?: number };

  /**
   * Measure the pixel height a TextElement's content would take at a given width.
   * Uses a persistent hidden div (textMeasureDivRef) so there is no DOM allocation
   * per call — safe to call on every resize rAF tick.
   */
  const measureTextHeight = useCallback(
    (content: string, fontSize: number, bold: boolean, italic: boolean, width: number): number => {
      const div = textMeasureDivRef.current;
      if (!div) return Math.max(10, Math.ceil(fontSize * 1.4));
      div.style.width      = width + "px";
      div.style.fontSize   = fontSize + "px";
      div.style.fontWeight = bold   ? "bold"   : "normal";
      div.style.fontStyle  = italic ? "italic" : "normal";
      div.textContent = content || " ";
      return Math.max(10, div.offsetHeight);
    },
    []
  );

  const handleGroupResizeUpdate = useCallback(
    (updates: Array<{ id: string; patch: ResizePatch }>) => {
      setElements((prev) =>
        prev.map((el) => {
          const u = updates.find((u) => u.id === el.id);
          if (!u) return el;
          if (el.type === "text" && u.patch.fontSize !== undefined) {
            const textEl = el as TextElement;
            const newW = Math.max(20, Math.round(u.patch.w));
            const newFontSize = u.patch.fontSize;
            const newH = measureTextHeight(textEl.content, newFontSize, textEl.bold, textEl.italic, newW);
            return { ...el, x: u.patch.x, y: u.patch.y, w: newW, h: newH, fontSize: newFontSize };
          }
          return { ...el, ...u.patch };
        })
      );
    },
    [measureTextHeight]
  );

  const handleGroupResizeCommit = useCallback(
    (updates: Array<{ id: string; patch: ResizePatch }>) => {
      // Snap the group's top-left corner and apply the same delta to every element
      // so relative positions within the group are preserved (independent per-element
      // snapping would round differently and shift elements relative to each other).
      const minX = Math.min(...updates.map((u) => u.patch.x));
      const minY = Math.min(...updates.map((u) => u.patch.y));
      const snapDX = snap(minX) - minX;
      const snapDY = snap(minY) - minY;
      updateElements((prev) =>
        prev.map((el) => {
          const u = updates.find((u) => u.id === el.id);
          if (!u) return el;
          const newW = Math.max(20, Math.round(u.patch.w));
          const sx = u.patch.x + snapDX;
          const sy = u.patch.y + snapDY;
          if (el.type === "text" && u.patch.fontSize !== undefined) {
            const textEl = el as TextElement;
            const newFontSize = u.patch.fontSize;
            const newH = measureTextHeight(textEl.content, newFontSize, textEl.bold, textEl.italic, newW);
            return { ...el, x: sx, y: sy, w: newW, h: newH, fontSize: newFontSize };
          }
          return {
            ...el,
            x: sx,
            y: sy,
            // Match the same minimums used in the live preview (GroupResizeOverlay.compute)
            // so the committed state is identical to what the user saw during the drag.
            w: newW,
            h: Math.max(10, Math.round(u.patch.h)),
          };
        })
      );
    },
    [updateElements, snap, measureTextHeight]
  );

  const handleElemResize = useCallback(
    (id: string, x: number, y: number, w: number, h: number) => {
      updateElements((prev) =>
        prev.map((el) => {
          if (el.id !== id) return el;
          const newW = Math.max(40, Math.round(w));
          const base = { ...el, x: snap(x), y: snap(y), w: newW };
          // Text: aspect-ratio resize → scale font; free resize (Shift) → keep font fixed.
          // Height always derived from text reflow at the new (width, fontSize).
          if (el.type === "text") {
            const textEl = el as TextElement;
            let newFontSize = textEl.fontSize;
            if (!shiftHeldRef.current) {
              const start = resizeStartRef.current;
              if (start && start.id === id && start.w > 0) {
                newFontSize = Math.max(8, Math.round(start.fontSize * newW / start.w));
              }
            }
            resizeStartRef.current = null;
            const newH = measureTextHeight(textEl.content, newFontSize, textEl.bold, textEl.italic, newW);
            return { ...base, h: newH, fontSize: newFontSize } as typeof el;
          }
          const newH = Math.max(24, Math.round(h));
          return { ...base, h: newH };
        })
      );
    },
    [updateElements, snap, measureTextHeight]
  );

  const handleElemChange = useCallback(
    (updated: CanvasElement) => {
      updateElements((prev) => prev.map((el) => (el.id === updated.id ? updated : el)));
    },
    [updateElements]
  );

  /** Live resize — no history push, no save schedule (called every rAF during drag) */
  const handleElemResizeLive = useCallback(
    (id: string, x: number, y: number, w: number, h: number) => {
      setElements((prev) =>
        prev.map((el) => {
          if (el.id !== id) return el;
          const newW = Math.max(20, Math.round(w));
          if (el.type === "text") {
            const textEl = el as TextElement;
            // Aspect-ratio resize (no Shift) → scale font proportionally to width.
            // Free resize (Shift held)        → keep font fixed, only reflow height.
            let newFontSize = textEl.fontSize;
            if (!shiftHeldRef.current) {
              const start = resizeStartRef.current;
              if (start && start.id === id && start.w > 0) {
                newFontSize = Math.max(8, Math.round(start.fontSize * newW / start.w));
              }
            }
            const newH = measureTextHeight(textEl.content, newFontSize, textEl.bold, textEl.italic, newW);
            return { ...el, x, y, w: newW, h: newH, fontSize: newFontSize } as typeof el;
          }
          return { ...el, x, y, w: newW, h: Math.max(10, Math.round(h)) };
        })
      );
    },
    [measureTextHeight]
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

  // ── Shape commit helper ──
  const commitShape = useCallback(
    (startX: number, startY: number, rawEndX: number, rawEndY: number) => {
      const shapeType = activeToolRef.current as "rectangle" | "ellipse" | "diamond";
      const x = snap(Math.min(startX, rawEndX));
      const y = snap(Math.min(startY, rawEndY));
      const w = snap(Math.max(SNAP_PX * 2, Math.abs(rawEndX - startX)));
      const h = snap(Math.max(SNAP_PX,     Math.abs(rawEndY - startY)));
      const tp = toolPropsRef.current;
      const el: ShapeElement = {
        id: makeId(), type: "shape", shape: shapeType,
        x, y, w, h,
        zIndex: ++nextZRef.current,
        fillColor: tp.fillColor, strokeColor: tp.strokeColor,
        strokeWidth: tp.strokeWidth, strokeStyle: tp.strokeStyle,
      };
      updateElements((prev) => [...prev, el]);
      const nextIds = [el.id];
      selectedIdsRef.current = nextIds;
      setSelectedIds(nextIds);
      setShapeDrawing(null);
      shapeDrawingRef.current = null;
      setActiveTool("select");
      activeToolRef.current = "select";
    },
    [snap, updateElements]
  );
  useEffect(() => { commitShapeRef.current = commitShape; }, [commitShape]);

  // ── Linear commit helper ──
  const commitLinear = useCallback(
    (absPoints: LinearPoint[]) => {
      if (absPoints.length < 2) {
        setLinearInProgress(null);
        linearInProgressRef.current = null;
        setActiveTool("select");
        activeToolRef.current = "select";
        return;
      }
      const minX = Math.min(...absPoints.map((p) => p.x));
      const minY = Math.min(...absPoints.map((p) => p.y));
      const maxX = Math.max(...absPoints.map((p) => p.x));
      const maxY = Math.max(...absPoints.map((p) => p.y));
      const tp = toolPropsRef.current;
      const sub = activeToolRef.current === "arrow" ? "arrow" : "line";
      const el: LinearElement = {
        id: makeId(), type: "linear", subtype: sub,
        x: snap(minX), y: snap(minY),
        w: Math.max(4, snap(maxX - minX)),
        h: Math.max(4, snap(maxY - minY)),
        zIndex: ++nextZRef.current,
        points: absPoints.map((p) => ({ x: p.x - minX, y: p.y - minY })),
        strokeColor: tp.strokeColor, strokeWidth: tp.strokeWidth, strokeStyle: tp.strokeStyle,
        startArrowhead: sub === "arrow" ? tp.arrowStart : "none",
        endArrowhead:   sub === "arrow" ? tp.arrowEnd   : "none",
      };
      updateElements((prev) => [...prev, el]);
      const nextIds = [el.id];
      selectedIdsRef.current = nextIds;
      setSelectedIds(nextIds);
      setLinearInProgress(null);
      linearInProgressRef.current = null;
      setActiveTool("select");
      activeToolRef.current = "select";
    },
    [snap, updateElements]
  );
  useEffect(() => { commitLinearRef.current = commitLinear; }, [commitLinear]);

  // ── Text tool placement ──
  const placeTextAt = useCallback(
    (canvasX: number, canvasY: number) => {
      const tp = toolPropsRef.current;
      const lineH = Math.round(tp.fontSize * 1.4);
      const el: TextElement = {
        id: makeId(), type: "text",
        x: snap(canvasX), y: snap(canvasY),
        w: tp.fontSize + 8, // starts narrow; auto-sized immediately via ref callback
        h: lineH,
        zIndex: ++nextZRef.current,
        content: "",
        fontSize: tp.fontSize,
        color: tp.textColor,
        bold: false, italic: false,
        textAlign: tp.textAlign,
      };
      updateElements((prev) => [...prev, el]);
      const nextIds = [el.id];
      selectedIdsRef.current = nextIds;
      setSelectedIds(nextIds);
      // Keep the text tool active while the user is typing — the tool switches to
      // "select" in commitTextEdit (on blur / Escape / click-away), not here.
      // Enter textarea edit mode immediately (Excalidraw-style)
      setTextEditingId(el.id);
      textEditingIdRef.current = el.id;
    },
    [snap, updateElements]
  );
  useEffect(() => { placeTextAtRef.current = placeTextAt; }, [placeTextAt]);

  // ── Commit text edit (called on blur / Escape) ──
  const commitTextEdit = useCallback(() => {
    const id = textEditingIdRef.current;
    if (!id) return;
    // Clear edit state synchronously so viewport handler won't re-enter
    setTextEditingId(null);
    textEditingIdRef.current = null;
    // Switch back to select tool (text tool was kept active during editing)
    setActiveTool("select");
    activeToolRef.current = "select";

    const ta = textareaRef.current;
    const content = ta?.value ?? "";
    // Use offsetWidth/offsetHeight — these reflect the auto-sized dimensions set
    // by onInput, which is exactly the bounding box we want to store.
    const newW = ta ? Math.max(10, ta.offsetWidth)  : undefined;
    const newH = ta ? Math.max(10, ta.offsetHeight) : undefined;

    if (!content.trim()) {
      // Empty text → delete the placeholder element
      updateElements((prev) => prev.filter((el) => el.id !== id));
      setSelectedIds((prev) => prev.filter((i) => i !== id));
      selectedIdsRef.current = selectedIdsRef.current.filter((i) => i !== id);
    } else {
      updateElements((prev) =>
        prev.map((el) => {
          if (el.id !== id || el.type !== "text") return el;
          return {
            ...(el as TextElement),
            content,
            ...(newW !== undefined ? { w: newW } : {}),
            ...(newH !== undefined ? { h: newH } : {}),
          };
        })
      );
    }
  }, [updateElements]);

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

  /** Raw version (no snapping) — used for live drawing preview */
  const screenToCanvasRaw = useCallback(
    (clientX: number, clientY: number) => {
      const viewport = viewportRef.current;
      if (!viewport) return { x: 80, y: 80 };
      const rect = viewport.getBoundingClientRect();
      return {
        x: (clientX - rect.left - panRef.current.x) / zoomRef.current,
        y: (clientY - rect.top - panRef.current.y) / zoomRef.current,
      };
    },
    []
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

  // ── Imperative view transform ────────────────────────────────────────────────
  // Applied on every pan/zoom frame without touching React state.
  const applyViewTransform = useCallback((px: number, py: number, z: number) => {
    // 1. Canvas wrapper
    if (canvasWrapperRef.current) {
      canvasWrapperRef.current.style.transform = `translate(${px}px, ${py}px) scale(${z})`;
    }
    // Overlay layer — same transform as canvas so handles/toolbar track it automatically
    if (overlayLayerRef.current) {
      overlayLayerRef.current.style.transform = `translate(${px}px, ${py}px) scale(${z})`;
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
  }, []);

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
          {/* Persistent hidden div for measuring text height at a given width during resize.
              position:fixed removes it from document flow and avoids the canvas transform. */}
          <div
            ref={textMeasureDivRef}
            aria-hidden
            style={{
              position: "fixed", top: -99999, left: -99999,
              visibility: "hidden", pointerEvents: "none",
              whiteSpace: "pre-wrap", wordBreak: "break-word",
              lineHeight: 1.4, padding: "2px 4px", boxSizing: "border-box",
              fontFamily: "inherit",
            }}
          />

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

            {elements.map((el) => {
              // When a linear element's point is being dragged, pass the preview element
              // so both the line SVG and the bounding box update live (not just the handles).
              const displayEl = (linearDragPreview && el.id === linearDragPreview.id)
                ? linearDragPreview
                : el;
              return (
              <CanvasItem
                key={el.id}
                element={displayEl}
                selected={selectedIds.includes(el.id)}
                isMultiSelected={selectedIds.length > 1 && selectedIds.includes(el.id)}
                zoom={rndScale}
                isVisible={visMap[el.id] ?? true}
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
                onResizeLive={(x, y, w, h) => handleElemResizeLive(el.id, x, y, w, h)}
                isEditing={el.type === "text" && el.id === textEditingId}
                onDoubleClick={() => {
                  if (el.type === "text" && !el.locked) {
                    setTextEditingId(el.id);
                    textEditingIdRef.current = el.id;
                  }
                }}
                onResizeStart={() => {
                  if (el.type === "text") {
                    resizeStartRef.current = { id: el.id, w: el.w, h: el.h, fontSize: (el as TextElement).fontSize };
                  } else {
                    resizeStartRef.current = null;
                  }
                }}
              />
              );
            })}

            {/* ── Shape drawing live preview (canvas-space coords) ── */}
            {shapeDrawing && (() => {
              const x = Math.min(shapeDrawing.startX, shapeDrawing.endX);
              const y = Math.min(shapeDrawing.startY, shapeDrawing.endY);
              const w = Math.max(1, Math.abs(shapeDrawing.endX - shapeDrawing.startX));
              const h = Math.max(1, Math.abs(shapeDrawing.endY - shapeDrawing.startY));
              const sw = toolStrokeWidth;
              const fill = toolFillColor === "transparent" ? "none" : toolFillColor;
              const dash =
                toolStrokeStyle === "dashed" ? `${sw * 4},${sw * 2}` :
                toolStrokeStyle === "dotted" ? `${sw},${sw * 2}` : undefined;
              return (
                <div style={{ position: "absolute", left: x, top: y, width: w, height: h, pointerEvents: "none", zIndex: 99999 }}>
                  <svg width="100%" height="100%" style={{ overflow: "visible", display: "block" }}>
                    {activeTool === "rectangle" && (
                      <rect x={sw/2} y={sw/2} width={`calc(100% - ${sw}px)`} height={`calc(100% - ${sw}px)`}
                        fill={fill} stroke={toolStrokeColor} strokeWidth={sw}
                        strokeDasharray={dash} strokeOpacity={0.75} />
                    )}
                    {activeTool === "ellipse" && (
                      <ellipse cx="50%" cy="50%"
                        rx={`calc(50% - ${sw/2}px)`} ry={`calc(50% - ${sw/2}px)`}
                        fill={fill} stroke={toolStrokeColor} strokeWidth={sw}
                        strokeDasharray={dash} strokeOpacity={0.75} />
                    )}
                    {activeTool === "diamond" && (() => {
                      const cx = w / 2, cy = h / 2;
                      const pts = `${cx},${sw/2} ${w - sw/2},${cy} ${cx},${h - sw/2} ${sw/2},${cy}`;
                      return <polygon points={pts} fill={fill} stroke={toolStrokeColor}
                        strokeWidth={sw} strokeDasharray={dash} strokeOpacity={0.75} />;
                    })()}
                  </svg>
                </div>
              );
            })()}

            {/* ── Text editing overlay (Excalidraw-style, canvas-space coords) ── */}
            {textEditingId && (() => {
              const editEl = elements.find((e) => e.id === textEditingId) as TextElement | undefined;
              if (!editEl || editEl.type !== "text") return null;
              // Helper: resize textarea to exactly fit its content (width + height).
              // Called on every input event and on initial mount.
              const autoSizeTextarea = (ta: HTMLTextAreaElement) => {
                const span = measureSpanRef.current;
                const minW = editEl.fontSize + 8; // padding 2×4px included via boxSizing
                if (span) {
                  // Put the full text content in the measurement div so we get the
                  // pixel width of the widest line (white-space:pre → no auto-wrap).
                  span.textContent = ta.value || "​"; // zero-width space keeps height
                  ta.style.width = Math.max(minW, span.offsetWidth) + "px";
                }
                // Height: collapse then expand to fit scrollHeight
                ta.style.height = "0px";
                ta.style.height = Math.max(editEl.fontSize * 1.4, ta.scrollHeight) + "px";
              };

              const sharedFontStyle: React.CSSProperties = {
                fontSize: editEl.fontSize,
                fontWeight: editEl.bold ? "bold" : "normal",
                fontStyle: editEl.italic ? "italic" : "normal",
                fontFamily: "inherit",
                lineHeight: 1.4,
                padding: "2px 4px",
                boxSizing: "border-box",
              };

              return (
                <>
                  {/* Hidden measurement div — same font as textarea, white-space:pre so it
                      expands to exactly the widest line's pixel width (no wrapping). */}
                  <div
                    ref={measureSpanRef}
                    aria-hidden
                    style={{
                      ...sharedFontStyle,
                      position: "absolute",
                      left: -99999,
                      top: -99999,
                      visibility: "hidden",
                      pointerEvents: "none",
                      whiteSpace: "pre",
                      display: "inline-block",
                    }}
                  />

                  <textarea
                    key={textEditingId}
                    ref={(el) => {
                      textareaRef.current = el;
                      if (el) {
                        // Auto-size immediately so the textarea never shows at wrong dimensions.
                        // (measureSpanRef is mounted first because it appears earlier in JSX.)
                        autoSizeTextarea(el);
                        // Reliable focus: ref callback fires synchronously after DOM insertion.
                        el.focus();
                        el.setSelectionRange(el.value.length, el.value.length);
                      }
                    }}
                    defaultValue={editEl.content}
                    style={{
                      ...sharedFontStyle,
                      position: "absolute",
                      left: editEl.x,
                      top: editEl.y,
                      // Width and height are set dynamically by autoSizeTextarea;
                      // editEl.w/h are just the initial fallback before the first paint.
                      width: editEl.w,
                      height: editEl.h,
                      color: editEl.color,
                      textAlign: editEl.textAlign ?? "left",
                      background: "transparent",
                      border: "2px solid rgba(99,102,241,0.75)",
                      outline: "none",
                      resize: "none",
                      overflow: "hidden",
                      caretColor: editEl.color,
                      // pre: text only wraps at explicit \n — no auto word-wrap.
                      // Width grows to fit the longest line.
                      whiteSpace: "pre",
                      zIndex: 999999,
                      pointerEvents: "all",
                    }}
                    onInput={(e) => autoSizeTextarea(e.currentTarget)}
                    onBlur={() => commitTextEdit()}
                    onKeyDown={(e) => {
                      e.stopPropagation(); // prevent global shortcuts while typing
                      if (e.key === "Escape") { e.preventDefault(); commitTextEdit(); }
                    }}
                    onMouseDown={(e) => e.stopPropagation()}
                  />
                </>
              );
            })()}

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

          {/* ── Linear creation live preview — viewport-space overlay ── */}
          {linearInProgress && (() => {
            const zoom = zoomRef.current;
            const pan  = panRef.current;
            const toVP = (p: { x: number; y: number }) => ({
              vx: p.x * zoom + pan.x,
              vy: p.y * zoom + pan.y,
            });
            const allVP = [...linearInProgress.points, linearInProgress.cursor].map(toVP);
            const pathD = allVP.map((p, i) => `${i === 0 ? "M" : "L"} ${p.vx} ${p.vy}`).join(" ");
            const sw = toolStrokeWidth * zoom;
            return (
              <svg
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  width: "100%",
                  height: "100%",
                  overflow: "visible",
                  pointerEvents: "none",
                  zIndex: 51,
                }}
              >
                <path
                  d={pathD}
                  fill="none"
                  stroke={toolStrokeColor}
                  strokeWidth={sw}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeOpacity={0.85}
                />
                {linearInProgress.points.map((p, i) => {
                  const vp = toVP(p);
                  return (
                    <circle
                      key={i}
                      cx={vp.vx}
                      cy={vp.vy}
                      r={Math.max(3, 4 * zoom)}
                      fill={toolStrokeColor}
                      stroke="white"
                      strokeWidth={1.5}
                    />
                  );
                })}
                {activeTool === "arrow" && allVP.length >= 2 && (() => {
                  const last = allVP[allVP.length - 1];
                  const prev = allVP[allVP.length - 2];
                  const angle = Math.atan2(last.vy - prev.vy, last.vx - prev.vx);
                  const aLen = Math.max(10, sw * 3);
                  return (
                    <g
                      stroke={toolStrokeColor}
                      strokeWidth={sw}
                      strokeLinecap="round"
                      fill="none"
                      strokeOpacity={0.85}
                    >
                      <line
                        x1={last.vx} y1={last.vy}
                        x2={last.vx - Math.cos(angle - 0.4) * aLen}
                        y2={last.vy - Math.sin(angle - 0.4) * aLen}
                      />
                      <line
                        x1={last.vx} y1={last.vy}
                        x2={last.vx - Math.cos(angle + 0.4) * aLen}
                        y2={last.vy - Math.sin(angle + 0.4) * aLen}
                      />
                    </g>
                  );
                })()}
              </svg>
            );
          })()}

          {/* ── Left tool toolbar (Excalidraw-style) ── */}
          {!drawingMode && (
            <div
              className="absolute left-3 z-50 flex flex-col gap-0"
              style={{ top: "50%", transform: "translateY(-50%)" }}
              onMouseDown={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
            >
              {/* Tool buttons */}
              <div className="flex flex-col items-center gap-0.5 bg-[var(--bg-elevated)]/95 backdrop-blur border border-[var(--border-default)] rounded-xl shadow-xl p-1.5">
                {(
                  [
                    { tool: "select",    icon: <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><path d="M2 1l10 6-5 1.5L5 13z"/></svg>,            title: "Sélection (V)" },
                    null, // sep
                    { tool: "rectangle", icon: <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="1" y="1" width="11" height="11" rx="1.5"/></svg>, title: "Rectangle (R)" },
                    { tool: "ellipse",   icon: <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.4"><ellipse cx="6.5" cy="6.5" rx="5.5" ry="5.5"/></svg>,   title: "Ellipse (E)"   },
                    null, // sep
                    { tool: "line",      icon: <svg width="13" height="13" viewBox="0 0 13 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><line x1="1.5" y1="11.5" x2="11.5" y2="1.5"/></svg>, title: "Ligne (L)" },
                    { tool: "arrow",     icon: <svg width="13" height="13" viewBox="0 0 13 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><line x1="1.5" y1="11.5" x2="11.5" y2="1.5"/><path d="M7 2l4.5-.5-.5 4.5" fill="none"/></svg>, title: "Flèche (A)" },
                    null, // sep
                    { tool: "text",      icon: <svg width="13" height="13" viewBox="0 0 13 13" fill="currentColor"><text x="1" y="11" fontSize="11" fontFamily="serif" fontWeight="bold">T</text></svg>,    title: "Texte (T)"   },
                  ] as Array<{ tool: string; icon: React.ReactNode; title: string } | null>
                ).map((item, i) => {
                  if (item === null) return <div key={i} className={`${isTouchDevice ? "w-9" : "w-6"} h-px bg-[var(--border-subtle)] my-0.5`} />;
                  const isActive = activeTool === item.tool;
                  return (
                    <button
                      key={item.tool}
                      title={item.title}
                      onClick={() => {
                        // Cancel any in-progress drawing
                        linearInProgressRef.current = null; setLinearInProgress(null);
                        shapeDrawingRef.current = null; setShapeDrawing(null);
                        setActiveTool(item.tool as Parameters<typeof setActiveTool>[0]);
                        activeToolRef.current = item.tool as typeof activeToolRef.current;
                      }}
                      className={`${isTouchDevice ? "w-11 h-11" : "w-8 h-8"} rounded-lg flex items-center justify-center transition-colors ${
                        isActive
                          ? "bg-[var(--accent,#a78bfa)]/20 text-[var(--accent,#a78bfa)]"
                          : "text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)]"
                      }`}
                    >
                      {item.icon}
                    </button>
                  );
                })}
              </div>

              {/* Tool properties panel — shown when a drawing tool is active */}
              {activeTool !== "select" && (
                <div className="mt-2 bg-[var(--bg-elevated)]/95 backdrop-blur border border-[var(--border-default)] rounded-xl shadow-xl p-2 flex flex-col gap-2 min-w-[120px]">
                  <p className="text-[9px] uppercase tracking-widest text-[var(--text-tertiary)] font-semibold">Style</p>

                  {/* Fill — shapes only */}
                  {(activeTool === "rectangle" || activeTool === "ellipse") && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-[var(--text-tertiary)] w-8">Fill</span>
                      <label className="relative cursor-pointer">
                        <div
                          className="w-5 h-5 rounded border border-[var(--border-default)]"
                          style={{ backgroundColor: toolFillColor === "transparent" ? "transparent" : toolFillColor,
                                   backgroundImage: toolFillColor === "transparent"
                                     ? "repeating-conic-gradient(#aaa 0% 25%, transparent 0% 50%)"
                                     : undefined,
                                   backgroundSize: "6px 6px" }}
                        />
                        <input type="color"
                          value={toolFillColor === "transparent" ? "#000000" : toolFillColor}
                          onChange={(e) => setToolFillColor(e.target.value)}
                          className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                        />
                      </label>
                      <button
                        title="Pas de remplissage"
                        onClick={() => setToolFillColor("transparent")}
                        className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
                          toolFillColor === "transparent"
                            ? "border-[var(--accent,#a78bfa)] text-[var(--accent,#a78bfa)]"
                            : "border-[var(--border-subtle)] text-[var(--text-tertiary)] hover:border-[var(--border-default)]"
                        }`}
                      >∅</button>
                    </div>
                  )}

                  {/* Stroke */}
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-[var(--text-tertiary)] w-8">Trait</span>
                    <label className="relative cursor-pointer">
                      <div className="w-5 h-5 rounded border border-[var(--border-default)]" style={{ backgroundColor: toolStrokeColor }} />
                      <input type="color" value={toolStrokeColor}
                        onChange={(e) => setToolStrokeColor(e.target.value)}
                        className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                      />
                    </label>
                    <input
                      type="number" value={toolStrokeWidth} min={1} max={40}
                      onChange={(e) => setToolStrokeWidth(Math.max(1, Number(e.target.value)))}
                      onMouseDown={(e) => e.stopPropagation()}
                      className="w-9 bg-transparent text-[10px] text-[var(--text-primary)] text-center outline-none border border-[var(--border-subtle)] rounded h-5"
                    />
                  </div>

                  {/* Stroke style */}
                  {activeTool !== "text" && (
                    <div className="flex items-center gap-1">
                      {(["solid", "dashed", "dotted"] as const).map((s) => (
                        <button key={s} title={s} onClick={() => setToolStrokeStyle(s)}
                          className={`flex-1 h-5 rounded text-[11px] transition-colors border ${
                            toolStrokeStyle === s
                              ? "border-[var(--accent,#a78bfa)] text-[var(--accent,#a78bfa)]"
                              : "border-[var(--border-subtle)] text-[var(--text-tertiary)] hover:border-[var(--border-default)]"
                          }`}
                        >
                          {s === "solid" ? "—" : s === "dashed" ? "╌" : "⋯"}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Arrow directions */}
                  {activeTool === "arrow" && (
                    <div className="flex items-center gap-1">
                      <button title="Pointe départ" onClick={() => setToolArrowStart(v => v === "none" ? "arrow" : "none")}
                        className={`flex-1 h-5 rounded text-[11px] border transition-colors ${
                          toolArrowStart !== "none"
                            ? "border-[var(--accent,#a78bfa)] text-[var(--accent,#a78bfa)]"
                            : "border-[var(--border-subtle)] text-[var(--text-tertiary)]"
                        }`}>←</button>
                      <button title="Pointe fin" onClick={() => setToolArrowEnd(v => v === "none" ? "arrow" : "none")}
                        className={`flex-1 h-5 rounded text-[11px] border transition-colors ${
                          toolArrowEnd !== "none"
                            ? "border-[var(--accent,#a78bfa)] text-[var(--accent,#a78bfa)]"
                            : "border-[var(--border-subtle)] text-[var(--text-tertiary)]"
                        }`}>→</button>
                    </div>
                  )}

                  {/* Text color, size, alignment */}
                  {activeTool === "text" && (
                    <>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-[var(--text-tertiary)] w-8">Coul.</span>
                        <label className="relative cursor-pointer">
                          <div className="w-5 h-5 rounded border border-[var(--border-default)]" style={{ backgroundColor: toolTextColor }} />
                          <input type="color" value={toolTextColor}
                            onChange={(e) => setToolTextColor(e.target.value)}
                            className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                          />
                        </label>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-[var(--text-tertiary)] w-8">Taille</span>
                        <input type="number" value={toolFontSize} min={6} max={300}
                          onChange={(e) => setToolFontSize(Math.max(6, Number(e.target.value)))}
                          onMouseDown={(e) => e.stopPropagation()}
                          className="w-14 bg-transparent text-[10px] text-[var(--text-primary)] text-center outline-none border border-[var(--border-subtle)] rounded h-5"
                        />
                      </div>
                      {/* Text alignment */}
                      <div className="flex items-center gap-0.5">
                        {(["left", "center", "right"] as const).map((a) => (
                          <button key={a} title={a === "left" ? "Gauche" : a === "center" ? "Centré" : "Droite"}
                            onClick={() => setToolTextAlign(a)}
                            className={`flex-1 h-5 rounded text-[10px] border transition-colors ${
                              toolTextAlign === a
                                ? "border-[var(--accent,#a78bfa)] text-[var(--accent,#a78bfa)]"
                                : "border-[var(--border-subtle)] text-[var(--text-tertiary)] hover:border-[var(--border-default)]"
                            }`}
                          >
                            {a === "left" ? "L" : a === "center" ? "C" : "R"}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
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

          {/* Overlay layer — same CSS transform as canvasWrapper.
              GroupResizeOverlay and ContextualToolbar live here so they track
              the canvas imperatively (zero lag during pan/zoom). */}
          <div
            ref={overlayLayerRef}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              transformOrigin: "0 0",
              width: 0,
              height: 0,
              zIndex: 99999,
              pointerEvents: "none",
            }}
          >
            {/* GroupResizeOverlay — canvas coordinates, handles inverse-scaled */}
            {selectedIds.length > 0 && (selectedIds.length > 1 || isTouchDevice) && (
              <GroupResizeOverlay
                selectedElements={elements.filter((el) => selectedIds.includes(el.id))}
                zoom={rndScale}
                isTouchDevice={isTouchDevice}
                onUpdate={handleGroupResizeUpdate}
                onCommit={handleGroupResizeCommit}
              />
            )}

            {/* LinearEditOverlay — point handles for single selected linear element */}
            {selectedIds.length === 1 && (() => {
              const el = elements.find((e) => e.id === selectedIds[0] && e.type === "linear");
              if (!el) return null;
              const lin = (linearDragPreview ?? el) as LinearElement;
              return (
                <LinearEditOverlay
                  element={lin}
                  zoom={rndScale}
                  onChange={(updated) => setLinearDragPreview(updated)}
                  onCommit={(updated) => {
                    setLinearDragPreview(null);
                    handleElemChange(updated);
                  }}
                />
              );
            })()}

            {/* ContextualToolbar — canvas coordinates, inverse-scaled so it stays at
                constant screen size regardless of zoom level */}
            {selectedIds.length > 0 && (() => {
              const selected = elements.filter((el) => selectedIds.includes(el.id));
              if (selected.length === 0) return null;
              const minX = Math.min(...selected.map((el) => el.x));
              const maxX = Math.max(...selected.map((el) => el.x + el.w));
              const minY = Math.min(...selected.map((el) => el.y));
              const canvasCenterX = (minX + maxX) / 2;
              // toolbarH in screen px (matches ContextualToolbar's internal constant)
              const toolbarH = isTouchDevice ? 52 : 36;
              // Wrapper placed toolbarH+8 screen-px above selection top (in canvas units)
              const wrapperTop = minY - (toolbarH + 8) / rndScale;
              return (
                <div
                  style={{
                    position: "absolute",
                    left: canvasCenterX,
                    top: wrapperTop,
                    // Counteract the parent's zoom so the toolbar always renders at its
                    // natural screen size, while still tracking the canvas position.
                    transform: `translateX(-50%) scale(${1 / rndScale})`,
                    transformOrigin: "center top",
                    pointerEvents: "all",
                  }}
                >
                  <ContextualToolbar
                    elements={elements}
                    selectedIds={selectedIds}
                    onUpdateMany={handleUpdateMany}
                    onDeleteSelected={deleteSelected}
                    posX={0}
                    posY={toolbarH + 4}
                    isTouchDevice={isTouchDevice}
                  />
                </div>
              );
            })()}
          </div>

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
  /** Fired during resize drag (no history) — used for live text font-size updates */
  onResizeLive?: (x: number, y: number, w: number, h: number) => void;
  /** True when this text element is currently being edited (hides static content) */
  isEditing?: boolean;
  /** Called on double-click — used to enter text edit mode */
  onDoubleClick?: () => void;
  /** Called when resize drag starts — used to capture initial state for proportional scaling */
  onResizeStart?: () => void;
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
  onResizeLive,
  isEditing = false,
  onDoubleClick,
  onResizeStart,
}: CanvasItemProps) {
  // Use inline style for outline — more reliable than Tailwind classes
  // and guarantees "none" on non-selected elements regardless of browser defaults
  const outlineStyle: React.CSSProperties = selected
    ? {
        outline: `2px solid ${isMultiSelected ? "rgba(255,255,255,0.45)" : "rgba(255,255,255,0.9)"}`,
        outlineOffset: "0px",
      }
    : { outline: "none" };

  const dragGrid: [number, number] = [1, 1];
  const resizeGrid: [number, number] = [1, 1];

  // Aspect ratio lock: images, strokes, and text lock by default, Shift unlocks.
  // For text the lock just keeps the resize "feeling" proportional — the actual
  // height is always recomputed from text reflow in handleElemResizeLive/Resize.
  let lockAspectRatio: boolean | number = false;
  if (!shiftHeld) {
    if (element.type === "image") {
      lockAspectRatio = (element as ImageElement).aspectRatio ?? (element.w / element.h);
    } else if (element.type === "stroke" || element.type === "text") {
      lockAspectRatio = element.w / element.h;
    }
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
      onResizeStart={() => { if (onResizeStart) onResizeStart(); }}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onResize={(_e: any, _dir: any, ref: any, _delta: any, pos: any) => {
        if (onResizeLive) onResizeLive(pos.x, pos.y, ref.offsetWidth, ref.offsetHeight);
      }}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onResizeStop={(_e: any, _dir: any, ref: any, _delta: any, pos: any) => {
        onResize(pos.x, pos.y, ref.offsetWidth, ref.offsetHeight);
      }}
      dragAxis={dragAxis}
      enableResizing={selected && !element.locked && !isTouchDevice && element.type !== "linear"}
      disableDragging={!!element.locked || !!forceDragDisabled}
      className="canvas-item group"
    >
      <ElementContent element={element} selected={selected} onChange={onChange} zoom={zoom} isVisible={isVisible} isEditing={isEditing} onDoubleClick={onDoubleClick} />
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
              Shift maintenu · Ratio libre sur les images
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
  isEditing = false,
  onDoubleClick,
}: {
  element: CanvasElement;
  selected: boolean;
  onChange: (el: CanvasElement) => void;
  zoom?: number;
  isVisible?: boolean;
  isEditing?: boolean;
  onDoubleClick?: () => void;
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
      <div
        className="w-full h-full"
        style={{
          borderRadius: br,
          padding: "2px 4px",
          boxSizing: "border-box",
          // Hide static content while the floating textarea overlay is active
          visibility: isEditing ? "hidden" : "visible",
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          if (onDoubleClick) onDoubleClick();
        }}
      >
        <div
          style={{
            fontSize: el.fontSize,
            color: el.color,
            fontWeight: el.bold ? "bold" : "normal",
            fontStyle: el.italic ? "italic" : "normal",
            lineHeight: 1.4,
            textAlign: el.textAlign ?? "left",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            userSelect: "none",
          }}
        >
          {el.content || " "}
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

  if (element.type === "shape") {
    const el = element as ShapeElement;
    const sw = el.strokeWidth;
    const half = sw / 2;
    const fill = el.fillColor === "transparent" ? "none" : el.fillColor;
    const dash =
      el.strokeStyle === "dashed" ? `${sw * 4},${sw * 2}` :
      el.strokeStyle === "dotted" ? `${sw},${sw * 2}` : undefined;

    return (
      <div className="w-full h-full pointer-events-none" style={{ overflow: "visible" }}>
        <svg width="100%" height="100%" style={{ overflow: "visible", display: "block" }}>
          {el.shape === "rectangle" && (
            <rect
              x={half} y={half}
              width={`calc(100% - ${sw}px)`} height={`calc(100% - ${sw}px)`}
              fill={fill} stroke={el.strokeColor} strokeWidth={sw}
              strokeDasharray={dash} rx={el.cornerRadius ?? 0}
            />
          )}
          {el.shape === "ellipse" && (
            <ellipse
              cx="50%" cy="50%"
              rx={`calc(50% - ${half}px)`} ry={`calc(50% - ${half}px)`}
              fill={fill} stroke={el.strokeColor} strokeWidth={sw}
              strokeDasharray={dash}
            />
          )}
          {el.shape === "diamond" && (() => {
            // Computed in a closure so we can reference element.w/h
            // The SVG is 100%×100% so we use percentage points
            return (
              <polygon
                points="50%,0 100%,50% 50%,100% 0,50%"
                fill={fill} stroke={el.strokeColor} strokeWidth={sw}
                strokeDasharray={dash}
                style={{ vectorEffect: "non-scaling-stroke" }}
              />
            );
          })()}
        </svg>
        {el.label && (
          <div
            className="absolute inset-0 flex items-center justify-center pointer-events-none"
            style={{
              fontSize: el.fontSize ?? 14,
              color: el.labelColor ?? "#ffffff",
              padding: "4px 8px",
              textAlign: "center",
              wordBreak: "break-word",
              userSelect: "none",
            }}
          >
            {el.label}
          </div>
        )}
      </div>
    );
  }

  if (element.type === "linear") {
    const el = element as LinearElement;
    const sw = el.strokeWidth;
    const dash =
      el.strokeStyle === "dashed" ? `${sw * 4},${sw * 2}` :
      el.strokeStyle === "dotted" ? `${sw},${sw * 2}` : undefined;
    const pts = el.points;
    if (pts.length < 2) return <div className="w-full h-full" />;

    const pathD = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
    const markerId = `arrow-end-${el.id}`;
    const markerStartId = `arrow-start-${el.id}`;

    // Arrow geometry: angled head
    const arrowW = sw * 3.5;
    const arrowH = sw * 3;

    return (
      <div className="w-full h-full pointer-events-none" style={{ overflow: "visible" }}>
        <svg
          width={el.w || 1}
          height={el.h || 1}
          style={{ overflow: "visible", position: "absolute", left: 0, top: 0 }}
        >
          <defs>
            {el.endArrowhead === "arrow" && (
              <marker
                id={markerId}
                markerWidth={arrowW} markerHeight={arrowH}
                refX={arrowW - 0.5} refY={arrowH / 2}
                orient="auto"
              >
                <path
                  d={`M0,0 L${arrowW},${arrowH/2} L0,${arrowH}`}
                  fill="none" stroke={el.strokeColor} strokeWidth={sw * 0.85}
                  strokeLinecap="round" strokeLinejoin="round"
                />
              </marker>
            )}
            {el.startArrowhead === "arrow" && (
              <marker
                id={markerStartId}
                markerWidth={arrowW} markerHeight={arrowH}
                refX={0.5} refY={arrowH / 2}
                orient="auto-start-reverse"
              >
                <path
                  d={`M${arrowW},0 L0,${arrowH/2} L${arrowW},${arrowH}`}
                  fill="none" stroke={el.strokeColor} strokeWidth={sw * 0.85}
                  strokeLinecap="round" strokeLinejoin="round"
                />
              </marker>
            )}
          </defs>
          <path
            d={pathD}
            fill="none"
            stroke={el.strokeColor}
            strokeWidth={sw}
            strokeDasharray={dash}
            strokeLinecap="round"
            strokeLinejoin="round"
            markerEnd={el.endArrowhead === "arrow" ? `url(#${markerId})` : undefined}
            markerStart={el.startArrowhead === "arrow" ? `url(#${markerStartId})` : undefined}
          />
        </svg>
      </div>
    );
  }

  return null;
}

// ── Linear element point-edit overlay ───────────────────────────────────────
// Shown when exactly one LinearElement is selected.
// Renders draggable handles at each point (canvas-coordinate space, inside overlayLayerRef).

interface LinearEditOverlayProps {
  element: LinearElement;
  zoom: number;
  onChange: (updated: LinearElement) => void;
  onCommit: (updated: LinearElement) => void;
}

function LinearEditOverlay({ element, zoom, onChange, onCommit }: LinearEditOverlayProps) {
  const HANDLE = 8 / zoom; // constant 8 screen-px

  const recompute = (newAbsPoints: Array<{ x: number; y: number }>): LinearElement => {
    const minX = Math.min(...newAbsPoints.map((p) => p.x));
    const minY = Math.min(...newAbsPoints.map((p) => p.y));
    const maxX = Math.max(...newAbsPoints.map((p) => p.x));
    const maxY = Math.max(...newAbsPoints.map((p) => p.y));
    return {
      ...element,
      x: minX, y: minY,
      w: Math.max(2, maxX - minX),
      h: Math.max(2, maxY - minY),
      points: newAbsPoints.map((p) => ({ x: p.x - minX, y: p.y - minY })),
    };
  };

  return (
    <>
      {element.points.map((pt, i) => {
        const absX = element.x + pt.x;
        const absY = element.y + pt.y;
        return (
          <div
            key={i}
            data-role="resize-handle"
            style={{
              position: "absolute",
              left: absX - HANDLE / 2,
              top:  absY - HANDLE / 2,
              width:  HANDLE,
              height: HANDLE,
              borderRadius: "50%",
              backgroundColor: "#1971c2",
              border: `${1.5 / zoom}px solid white`,
              cursor: "move",
              pointerEvents: "all",
              zIndex: 99997,
              boxSizing: "border-box",
            }}
            onMouseDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
              const startMX = e.clientX;
              const startMY = e.clientY;

              const onMove = (ev: MouseEvent) => {
                const dx = (ev.clientX - startMX) / zoom;
                const dy = (ev.clientY - startMY) / zoom;
                const absPoints = element.points.map((p, j) =>
                  j === i ? { x: element.x + p.x + dx, y: element.y + p.y + dy } : { x: element.x + p.x, y: element.y + p.y }
                );
                onChange(recompute(absPoints));
              };

              const onUp = (ev: MouseEvent) => {
                const dx = (ev.clientX - startMX) / zoom;
                const dy = (ev.clientY - startMY) / zoom;
                const absPoints = element.points.map((p, j) =>
                  j === i ? { x: element.x + p.x + dx, y: element.y + p.y + dy } : { x: element.x + p.x, y: element.y + p.y }
                );
                onCommit(recompute(absPoints));
                document.removeEventListener("mousemove", onMove);
                document.removeEventListener("mouseup", onUp);
              };

              document.addEventListener("mousemove", onMove);
              document.addEventListener("mouseup", onUp);
            }}
          />
        );
      })}
    </>
  );
}

// ── Group/Selection Resize Overlay ──────────────────────────────────────────
// Renders a dashed bounding box with 8 resize handles around any selection.
// On desktop: shown for multi-selection only (react-rnd handles single elements).
// On touch: shown for single AND multi-selection (react-rnd handles don't work well).
// Handles are in viewport coords; drag deltas are converted to canvas units.

type ResizePatch = { x: number; y: number; w: number; h: number; fontSize?: number };

interface GroupResizeOverlayProps {
  selectedElements: CanvasElement[];
  zoom: number;
  isTouchDevice: boolean;
  onUpdate: (updates: Array<{ id: string; patch: ResizePatch }>) => void;
  onCommit: (updates: Array<{ id: string; patch: ResizePatch }>) => void;
}

function GroupResizeOverlay({
  selectedElements,
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

  const HANDLE = (isTouchDevice ? 20 : 7) / zoom;

  const handles: Array<{ dir: string; cx: number; cy: number; cursor: string }> = [
    { dir: "nw", cx: 0,    cy: 0,    cursor: "nw-resize" },
    { dir: "n",  cx: gw/2, cy: 0,    cursor: "n-resize"  },
    { dir: "ne", cx: gw,   cy: 0,    cursor: "ne-resize" },
    { dir: "e",  cx: gw,   cy: gh/2, cursor: "e-resize"  },
    { dir: "se", cx: gw,   cy: gh,   cursor: "se-resize" },
    { dir: "s",  cx: gw/2, cy: gh,   cursor: "s-resize"  },
    { dir: "sw", cx: 0,    cy: gh,   cursor: "sw-resize" },
    { dir: "w",  cx: 0,    cy: gh/2, cursor: "w-resize"  },
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
      isText: el.type === "text",
      // Capture original fontSize so we can scale it proportionally during group resize.
      origFontSize: el.type === "text" ? (el as TextElement).fontSize : undefined,
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

      // Width scale factor for the whole group — used to scale text font sizes.
      const wScale = origGw > 0 ? ngw / origGw : 1;

      return relData.map(({ id, relX, relY, relW, relH, isText, origFontSize }) => {
        const patch: ResizePatch = {
          x: ngx + relX * ngw,
          y: ngy + relY * ngh,
          w: Math.max(20, relW * ngw),
          h: Math.max(10, relH * ngh),
        };
        // For text elements, scale font proportionally to group width change.
        // The parent handlers (handleGroupResizeUpdate/Commit) will then recompute
        // the actual height via measureTextHeight so lines reflow correctly.
        if (isText && origFontSize !== undefined) {
          patch.fontSize = Math.max(8, Math.round(origFontSize * wScale));
        }
        return { id, patch };
      });
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
      style={{ left: gx, top: gy, width: gw, height: gh, zIndex: 99998,
               border: `${1 / zoom}px dashed rgba(255,255,255,0.35)` }}
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
