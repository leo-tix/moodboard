"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { getThumbnailUrl } from "@/lib/storage/urls";

// Note: IntersectionObserver-based lazy loading is unreliable on iOS Safari
// when the root is a custom element — the observer may never fire if the
// container's clientHeight is 0 during the first render cycle.
// Strategy: load all thumbnails eagerly (200 × ~5KB ≈ 1 MB) with a CSS fade-in.
// The browser natively prioritises in-viewport images; off-screen images download
// after the visible ones without any custom JS needed.

interface LibraryItem {
  id: string;
  title: string;
  storageKey: string | null;
  thumbnailKey: string | null;
  width: number | null;
  height: number | null;
  isAnimated?: boolean;
}

type AddPayload = {
  inspirationId: string;
  storageKey: string;
  title: string;
  width?: number | null;
  height?: number | null;
  isAnimated?: boolean;
};

interface Props {
  onAdd: (item: AddPayload) => void;
  /** Touch drag-and-drop: called when user long-presses + drags an image to the canvas. */
  onTouchAdd?: (item: AddPayload, clientX: number, clientY: number) => void;
}

// ── Main component ────────────────────────────────────────────────────────────

export function LibraryPanel({ onAdd, onTouchAdd }: Props) {
  const [items,   setItems]   = useState<LibraryItem[]>([]);
  const [search,  setSearch]  = useState("");
  const [loading, setLoading] = useState(true);

  // ── Drag ghost (touch long-press drag) ────────────────────────────────────
  const [dragGhost, setDragGhost] = useState<{
    item: LibraryItem;
    x: number;
    y: number;
  } | null>(null);

  type DragState = {
    item: LibraryItem;
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
    isActive: boolean;
    cleanup: (() => void) | null;
  };
  const dragRef         = useRef<DragState | null>(null);
  const longPressRef    = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelDrag = useCallback(() => {
    if (longPressRef.current) { clearTimeout(longPressRef.current); longPressRef.current = null; }
    if (dragRef.current?.cleanup) dragRef.current.cleanup();
    dragRef.current = null;
    setDragGhost(null);
  }, []);

  // Cleanup on unmount
  useEffect(() => cancelDrag, [cancelDrag]);

  // ── Fetch library ─────────────────────────────────────────────────────────
  useEffect(() => {
    fetch("/api/library/strip?limit=200")
      .then((r) => r.json())
      .then((data) => setItems(data.items ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const filtered = search.trim()
    ? items.filter((i) => i.title.toLowerCase().includes(search.toLowerCase()))
    : items;

  // ── Touch long-press drag handlers ────────────────────────────────────────
  const handleItemTouchStart = useCallback((item: LibraryItem, e: React.TouchEvent) => {
    if (!onTouchAdd || !item.storageKey || !item.thumbnailKey) return;
    const t = e.touches[0];
    dragRef.current = {
      item,
      startX:   t.clientX,
      startY:   t.clientY,
      currentX: t.clientX,
      currentY: t.clientY,
      isActive: false,
      cleanup:  null,
    };

    longPressRef.current = setTimeout(() => {
      const state = dragRef.current;
      if (!state) return;
      state.isActive = true;
      if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(10);
      setDragGhost({ item: state.item, x: state.currentX, y: state.currentY });

      const onMove = (ev: TouchEvent) => {
        ev.preventDefault();
        const touch = ev.touches[0];
        if (!touch || !dragRef.current) return;
        dragRef.current.currentX = touch.clientX;
        dragRef.current.currentY = touch.clientY;
        setDragGhost((prev) => prev ? { ...prev, x: touch.clientX, y: touch.clientY } : null);
      };

      const onEnd = (ev: TouchEvent) => {
        const s = dragRef.current;
        if (s?.isActive && s.item.storageKey) {
          const touch = ev.changedTouches[0];
          if (touch) {
            onTouchAdd({
              inspirationId: s.item.id,
              storageKey:    s.item.storageKey,
              title:         s.item.title,
              width:         s.item.width,
              height:        s.item.height,
              isAnimated:    s.item.isAnimated ?? false,
            }, touch.clientX, touch.clientY);
          }
        }
        cleanup();
      };

      const cleanup = () => {
        document.removeEventListener("touchmove",   onMove);
        document.removeEventListener("touchend",    onEnd);
        document.removeEventListener("touchcancel", cleanup);
        dragRef.current = null;
        setDragGhost(null);
      };

      if (dragRef.current) dragRef.current.cleanup = cleanup;
      document.addEventListener("touchmove",   onMove,   { passive: false });
      document.addEventListener("touchend",    onEnd,    { passive: false });
      document.addEventListener("touchcancel", cleanup);
    }, 400);
  }, [onTouchAdd]);

  const handleItemTouchMove = useCallback((e: React.TouchEvent) => {
    const state = dragRef.current;
    if (!state || state.isActive) return; // document handler takes over once active
    const t = e.touches[0];
    const dx = t.clientX - state.startX;
    const dy = t.clientY - state.startY;
    if (Math.sqrt(dx * dx + dy * dy) > 10) {
      // Finger moved before long-press fired → cancel (natural scroll)
      if (longPressRef.current) { clearTimeout(longPressRef.current); longPressRef.current = null; }
      dragRef.current = null;
    }
  }, []);

  const handleItemTouchEnd = useCallback(() => {
    // Long-press never fired → just cancel the timer
    if (!dragRef.current?.isActive) cancelDrag();
    // If active, the document handler already handles it
  }, [cancelDrag]);

  return (
    <div className="flex flex-col h-full">

      {/* Header */}
      <div className="flex-shrink-0 px-3 py-2.5 border-b border-[var(--border-subtle)]">
        <p className="text-xs font-medium text-[var(--text-secondary)] mb-2">Bibliothèque</p>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher…"
          className="w-full text-xs bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded px-2 py-1.5 text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none focus:border-[var(--border-default)]"
        />
      </div>

      {/* Scrollable grid */}
      <div className="flex-1 overflow-y-auto p-2">
        {loading ? (
          <div className="grid grid-cols-2 gap-1.5">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="aspect-video rounded bg-[var(--bg-surface)] animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-xs text-[var(--text-tertiary)] text-center py-8">Aucun résultat</p>
        ) : (
          <div className="grid grid-cols-2 gap-1.5">
            {filtered.map((item) => (
              <button
                key={item.id}
                draggable={!!item.storageKey}
                onDragStart={(e) => {
                  if (!item.storageKey) return;
                  e.dataTransfer.effectAllowed = "copy";
                  e.dataTransfer.setData(
                    "application/moodboard-item",
                    JSON.stringify({
                      inspirationId: item.id,
                      storageKey:    item.storageKey,
                      title:         item.title,
                      width:         item.width,
                      height:        item.height,
                      isAnimated:    item.isAnimated ?? false,
                    })
                  );
                }}
                onClick={() =>
                  item.storageKey &&
                  onAdd({
                    inspirationId: item.id,
                    storageKey:    item.storageKey,
                    title:         item.title,
                    width:         item.width,
                    height:        item.height,
                    isAnimated:    item.isAnimated ?? false,
                  })
                }
                onTouchStart={(e) => handleItemTouchStart(item, e)}
                onTouchMove={handleItemTouchMove}
                onTouchEnd={handleItemTouchEnd}
                onTouchCancel={cancelDrag}
                className="relative aspect-video bg-[var(--bg-surface)] hover:ring-2 hover:ring-[var(--accent,#a78bfa)] transition-all group cursor-grab active:cursor-grabbing"
                style={{
                  // Explicit border-radius + translateZ(0) fixes Chrome on iPad where
                  // border-radius + overflow:hidden on a <button> is sometimes ignored.
                  borderRadius: 8,
                  overflow: "hidden",
                  // Force GPU compositing layer so border-radius clip is honoured
                  transform: "translateZ(0)",
                }}
                title={`${item.title} — glisser ou cliquer pour ajouter`}
              >
                {item.thumbnailKey ? (
                  <img
                    src={getThumbnailUrl(item.thumbnailKey)}
                    alt={item.title}
                    className="absolute inset-0 w-full h-full object-cover"
                    onLoad={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = "1"; }}
                    style={{ opacity: 0, transition: "opacity 0.2s" }}
                  />
                ) : (
                  <div className="absolute inset-0 bg-[var(--bg-elevated)]" />
                )}
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-1.5 py-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <p className="text-[9px] text-white truncate">{item.title}</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Touch drag ghost — follows the finger globally while dragging */}
      {dragGhost && dragGhost.item.thumbnailKey && (
        <div
          className="fixed pointer-events-none"
          style={{
            left:         dragGhost.x - 48,
            top:          dragGhost.y - 40,
            width:        96,
            height:       80,
            zIndex:       9999,
            borderRadius: 8,
            overflow:     "hidden",
            opacity:      0.88,
            boxShadow:    "0 8px 24px rgba(0,0,0,0.45)",
            transform:    "translateZ(0)",
          }}
        >
          <img
            src={getThumbnailUrl(dragGhost.item.thumbnailKey)}
            alt=""
            className="w-full h-full object-cover"
          />
        </div>
      )}
    </div>
  );
}
