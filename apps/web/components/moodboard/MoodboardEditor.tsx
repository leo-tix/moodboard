"use client";

import {
  useState,
  useCallback,
  useRef,
  useEffect,
  useMemo,
} from "react";
import { Rnd } from "react-rnd";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { getImageUrl } from "@/lib/storage/urls";
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
import { AI_IMPORT_KEY } from "@/components/settings/GeneralSettings";

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

// ── Main Component ───────────────────────────────────────────────────────────

export function MoodboardEditor({ initialData }: Props) {
  const router = useRouter();

  // ── Canvas state ──
  const [elements, setElements] = useState<CanvasElement[]>(initialData.canvasData);
  const [pan, setPan] = useState({ x: 80, y: 60 });
  const [zoom, setZoom] = useState(1);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [shiftHeld, setShiftHeld] = useState(false);

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

  // ── Status ──
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [cursor, setCursor] = useState("default");

  // ── Refs (avoid stale closures in event handlers) ──
  const viewportRef = useRef<HTMLDivElement>(null);
  const panRef = useRef(pan);
  const zoomRef = useRef(zoom);
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

  // ── History ──
  const historyRef = useRef<CanvasElement[][]>([
    JSON.parse(JSON.stringify(initialData.canvasData)),
  ]);
  const historyIdxRef = useRef(0);

  // Sync refs
  useEffect(() => { panRef.current = pan; }, [pan]);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { selectedIdsRef.current = selectedIds; }, [selectedIds]);
  useEffect(() => { elementsRef.current = elements; }, [elements]);
  useEffect(() => { snapEnabledRef.current = snapEnabled; }, [snapEnabled]);

  useEffect(() => {
    aiOnImport.current = localStorage.getItem(AI_IMPORT_KEY) === "true";
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

  // ── Delete selected ──
  const deleteSelected = useCallback(() => {
    const ids = selectedIdsRef.current;
    if (ids.length === 0) return;
    updateElements((prev) => prev.filter((el) => !ids.includes(el.id)));
    setSelectedIds([]);
  }, [updateElements]);

  // ── Select element ──
  const handleSelect = useCallback((id: string, shift: boolean) => {
    setSelectedIds((prev) => {
      if (shift) {
        // Toggle element in/out of multi-selection
        return prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id];
      }
      // If element is already part of multi-selection, keep the group
      // so dragging doesn't deselect others (click on empty space to reset)
      if (prev.includes(id) && prev.length > 1) return prev;
      return [id];
    });
    // Bring to front (no history push, minor visual change)
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
  }, [scheduleSave]);

  // ── Zoom helpers ──
  const applyZoom = useCallback((newZoom: number, pivotX: number, pivotY: number) => {
    const cz = zoomRef.current;
    const cp = panRef.current;
    const clampedZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, newZoom));
    const canvasX = (pivotX - cp.x) / cz;
    const canvasY = (pivotY - cp.y) / cz;
    const newPan = {
      x: pivotX - canvasX * clampedZoom,
      y: pivotY - canvasY * clampedZoom,
    };
    setZoom(clampedZoom);
    setPan(newPan);
    zoomRef.current = clampedZoom;
    panRef.current = newPan;
  }, []);

  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 80, y: 60 });
    zoomRef.current = 1;
    panRef.current = { x: 80, y: 60 };
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
        // Zoom
        const factor = e.deltaY > 0 ? 0.92 : 1.08;
        applyZoom(zoomRef.current * factor, px, py);
      } else {
        // Pan
        const np = {
          x: panRef.current.x - e.deltaX,
          y: panRef.current.y - e.deltaY,
        };
        setPan(np);
        panRef.current = np;
      }
    };

    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", onWheel);
  }, [applyZoom]);

  // ── Keyboard shortcuts ──
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const inInput = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;

      if (e.key === "Shift") { setShiftHeld(true); }

      if (e.code === "Space" && !inInput) {
        e.preventDefault();
        isSpaceDown.current = true;
        if (!isPanningRef.current) setCursor("grab");
        return;
      }

      if (inInput) return;

      if (e.ctrlKey || e.metaKey) {
        if (e.key === "z" && !e.shiftKey) { e.preventDefault(); undo(); return; }
        if (e.key === "z" && e.shiftKey) { e.preventDefault(); redo(); return; }
        if (e.key === "y") { e.preventDefault(); redo(); return; }
        if (e.key === "a") {
          e.preventDefault();
          setSelectedIds(elementsRef.current.map((el) => el.id));
          return;
        }
      }

      if (e.key === "Delete" || e.key === "Backspace") {
        deleteSelected();
      }
      if (e.key === "Escape") setSelectedIds([]);
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        isSpaceDown.current = false;
        if (!isPanningRef.current) setCursor("default");
      }
      if (e.key === "Shift") setShiftHeld(false);
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [undo, redo, deleteSelected]);

  // ── Viewport mouse handlers (pan + rubber band) ──
  const handleViewportMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
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
      return;
    }

    if (e.button === 0) {
      // Rubber band
      if (!e.shiftKey) setSelectedIds([]);
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

  // ── Element drag (multi-select support) ──
  const handleElemDragStart = useCallback((id: string) => {
    const dragged = elementsRef.current.find((el) => el.id === id);
    if (!dragged) return;
    draggedElementStartPos.current = { x: dragged.x, y: dragged.y };
    const ids = selectedIdsRef.current;
    if (ids.includes(id)) {
      const map = new Map<string, { x: number; y: number }>();
      elementsRef.current.forEach((el) => {
        if (ids.includes(el.id)) map.set(el.id, { x: el.x, y: el.y });
      });
      multiDragStartPositions.current = map;
    }
  }, []);

  const handleElemDragStop = useCallback(
    (id: string, newX: number, newY: number) => {
      const ids = selectedIdsRef.current;
      if (ids.includes(id) && ids.length > 1) {
        // Multi-drag: apply delta to all selected
        const dx = newX - draggedElementStartPos.current.x;
        const dy = newY - draggedElementStartPos.current.y;
        updateElements((prev) =>
          prev.map((el) => {
            if (!ids.includes(el.id)) return el;
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
    if (!ids.includes(id) || ids.length <= 1) return;
    const dx = newX - draggedElementStartPos.current.x;
    const dy = newY - draggedElementStartPos.current.y;
    setElements((prev) =>
      prev.map((el) => {
        if (el.id === id) return el; // leader: react-rnd handles its visual position
        if (!ids.includes(el.id)) return el;
        const s = multiDragStartPositions.current.get(el.id);
        if (!s) return el;
        return { ...el, x: s.x + dx, y: s.y + dy };
      })
    );
  }, []);

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
        image: { storageKey: string };
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

  // ── Drop handlers ──
  const handleLibraryDrop = useCallback(
    (e: React.DragEvent): boolean => {
      const raw = e.dataTransfer.getData("application/moodboard-item");
      if (!raw) return false;
      const item = JSON.parse(raw) as {
        inspirationId: string;
        storageKey: string;
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

  // ── Toolbar position (viewport-relative coords) ──
  const toolbarPos = useMemo(() => {
    if (selectedIds.length === 0) return null;
    const selected = elements.filter((el) => selectedIds.includes(el.id));
    if (selected.length === 0) return null;
    const minX = Math.min(...selected.map((el) => el.x));
    const minY = Math.min(...selected.map((el) => el.y));
    const maxX = Math.max(...selected.map((el) => el.x + el.w));
    return {
      x: ((minX + maxX) / 2) * zoom + pan.x,
      y: minY * zoom + pan.y,
    };
  }, [selectedIds, elements, zoom, pan]);

  // ── Dot grid background ──
  const gridSize = GRID_PX * zoom;
  const gridStyle: React.CSSProperties = {
    backgroundColor: background,
    backgroundImage: `radial-gradient(circle, rgba(128,128,148,0.22) 1px, transparent 1px)`,
    backgroundSize: `${gridSize}px ${gridSize}px`,
    backgroundPosition: `${pan.x % gridSize}px ${pan.y % gridSize}px`,
    cursor,
  };

  return (
    <div className="h-screen flex flex-col bg-[var(--bg-base)] overflow-hidden">

      {/* ── Top bar ── */}
      <div className="flex-shrink-0 h-11 border-b border-[var(--border-subtle)] flex items-center gap-2 px-4 select-none">
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
      </div>

      {/* ── Body ── */}
      <div className="flex-1 flex overflow-hidden">

        {/* Library panel */}
        {showLibrary && (
          <div className="flex-shrink-0 w-64 border-r border-[var(--border-subtle)] overflow-y-auto bg-[var(--bg-base)]">
            <LibraryPanel onAdd={addImage} />
          </div>
        )}

        {/* Viewport — infinite canvas */}
        <div
          ref={viewportRef}
          className="flex-1 relative overflow-hidden"
          style={gridStyle}
          onMouseDown={handleViewportMouseDown}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onDragLeave={handleDragLeave}
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
            {elements.map((el) => (
              <CanvasItem
                key={el.id}
                element={el}
                selected={selectedIds.includes(el.id)}
                isMultiSelected={selectedIds.length > 1 && selectedIds.includes(el.id)}
                zoom={zoom}
                snapEnabled={snapEnabled}
                shiftHeld={shiftHeld}
                onSelect={(shift) => handleSelect(el.id, shift)}
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

          {/* Contextual toolbar */}
          {toolbarPos && (
            <ContextualToolbar
              elements={elements}
              selectedIds={selectedIds}
              onUpdateMany={handleUpdateMany}
              onDeleteSelected={deleteSelected}
              posX={toolbarPos.x}
              posY={toolbarPos.y}
            />
          )}

          {/* Zoom controls (bottom-right) */}
          <div className="absolute bottom-4 right-4 z-50 flex items-center gap-1 bg-[var(--bg-elevated)]/90 backdrop-blur border border-[var(--border-default)] rounded-lg px-2 py-1 shadow select-none">
            <button
              onClick={() => {
                const vp = viewportRef.current;
                if (!vp) return;
                const r = vp.getBoundingClientRect();
                applyZoom(zoomRef.current * 0.8, r.width / 2, r.height / 2);
              }}
              className="w-5 h-5 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] flex items-center justify-center"
              title="Zoom arrière (Ctrl -)"
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
                applyZoom(zoomRef.current * 1.25, r.width / 2, r.height / 2);
              }}
              className="w-5 h-5 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] flex items-center justify-center"
              title="Zoom avant (Ctrl +)"
            >
              +
            </button>
            <button
              onClick={resetView}
              className="text-[10px] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] px-1 transition-colors"
              title="Vue par défaut"
            >
              Réinitialiser
            </button>
            <div className="w-px h-3 bg-[var(--border-subtle)]" />
            <button
              onClick={() => setSnapEnabled((v) => !v)}
              className={`text-[10px] px-1 rounded transition-colors ${
                snapEnabled
                  ? "text-[var(--accent,#a78bfa)]"
                  : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
              }`}
              title="Grille magnétique 8px"
            >
              ⊞
            </button>
          </div>

          {/* Grab cursor hint */}
          {cursor === "grab" && (
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
  onSelect: (shift: boolean) => void;
  onChange: (el: CanvasElement) => void;
  onDragStart: () => void;
  onDragMove: (x: number, y: number) => void;
  onDragStop: (x: number, y: number) => void;
  onResize: (x: number, y: number, w: number, h: number) => void;
}

function CanvasItem({
  element,
  selected,
  isMultiSelected,
  zoom,
  snapEnabled,
  shiftHeld,
  onSelect,
  onChange,
  onDragStart,
  onDragMove,
  onDragStop,
  onResize,
}: CanvasItemProps) {
  const selectionStyle = selected
    ? isMultiSelected
      ? "outline outline-2 outline-offset-0 outline-[var(--accent,#a78bfa)]/60"
      : "outline outline-2 outline-offset-0 outline-[var(--accent,#a78bfa)]"
    : "";

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
      style={{ zIndex: element.zIndex, opacity: element.opacity ?? 1 }}
      scale={zoom}
      dragGrid={dragGrid}
      resizeGrid={resizeGrid}
      lockAspectRatio={lockAspectRatio}
      onMouseDown={(e: MouseEvent) => {
        e.stopPropagation();
        onSelect(e.shiftKey);
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
      enableResizing={selected}
      disableDragging={false}
      className={`group ${selectionStyle}`}
    >
      <ElementContent element={element} selected={selected} onChange={onChange} />
    </Rnd>
  );
}

// ── Element content renderer ─────────────────────────────────────────────────

function ElementContent({
  element,
  selected,
  onChange,
}: {
  element: CanvasElement;
  selected: boolean;
  onChange: (el: CanvasElement) => void;
}) {
  const br = 8; // border radius (design constant)

  if (element.type === "image") {
    const el = element as ImageElement;
    const fit = el.objectFit ?? "cover";
    const url = getImageUrl(el.storageKey);
    return (
      <div
        className="w-full h-full overflow-hidden relative"
        style={{ borderRadius: br }}
      >
        {el.isAnimated ? (
          <img
            src={url}
            alt={el.title}
            draggable={false}
            className={`absolute inset-0 w-full h-full ${fit === "contain" ? "object-contain" : "object-cover"}`}
          />
        ) : (
          <Image
            src={url}
            alt={el.title}
            fill
            className={fit === "contain" ? "object-contain" : "object-cover"}
            sizes="600px"
            draggable={false}
          />
        )}
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

  return null;
}
