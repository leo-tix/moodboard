"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { getThumbnailUrl } from "@/lib/storage/urls";

interface LibraryItem {
  id: string;
  title: string;
  storageKey: string;
  thumbnailKey: string;
  width: number | null;
  height: number | null;
  isAnimated?: boolean;
}

type AddPayload = {
  inspirationId: string;
  storageKey: string;
  thumbnailKey?: string;
  title: string;
  width?: number | null;
  height?: number | null;
  isAnimated?: boolean;
};

interface Props {
  onAdd: (item: AddPayload) => void;
  onTouchAdd?: (item: AddPayload, clientX: number, clientY: number) => void;
}

const COL_COUNT = 2;

// Shortest-column-first masonry using real aspect ratios.
// Each column is an ordered array; the algorithm fills the shortest column next.
function buildMasonryColumns(items: LibraryItem[]): LibraryItem[][] {
  const cols: LibraryItem[][] = Array.from({ length: COL_COUNT }, () => []);
  const heights = new Array<number>(COL_COUNT).fill(0);
  for (const item of items) {
    const ar = item.height && item.width ? item.height / item.width : 9 / 16;
    const shortest = heights.indexOf(Math.min(...heights));
    cols[shortest].push(item);
    heights[shortest] += ar;
  }
  return cols;
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
  const dragRef      = useRef<DragState | null>(null);
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelDrag = useCallback(() => {
    if (longPressRef.current) { clearTimeout(longPressRef.current); longPressRef.current = null; }
    if (dragRef.current?.cleanup) dragRef.current.cleanup();
    dragRef.current = null;
    setDragGhost(null);
  }, []);

  useEffect(() => cancelDrag, [cancelDrag]);

  // ── Fetch library ─────────────────────────────────────────────────────────
  useEffect(() => {
    fetch("/api/library/strip?limit=200")
      .then((r) => r.json())
      .then((data) => {
        const raw: Array<{
          id: string; title: string; storageKey: string | null;
          thumbnailKey: string | null; width: number | null;
          height: number | null; isAnimated?: boolean;
        }> = data.items ?? [];
        // Keep only items that have both keys — others can't be displayed or added
        setItems(
          raw.filter((i): i is LibraryItem => !!i.storageKey && !!i.thumbnailKey)
        );
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? items.filter((i) => i.title.toLowerCase().includes(q)) : items;
  }, [items, search]);

  const columns = useMemo(() => buildMasonryColumns(filtered), [filtered]);

  // ── Touch long-press drag handlers ────────────────────────────────────────
  const handleItemTouchStart = useCallback((item: LibraryItem, e: React.TouchEvent) => {
    if (!onTouchAdd) return;
    const t = e.touches[0];
    dragRef.current = {
      item,
      startX: t.clientX, startY: t.clientY,
      currentX: t.clientX, currentY: t.clientY,
      isActive: false, cleanup: null,
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
        if (s?.isActive) {
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
    if (!state || state.isActive) return;
    const t = e.touches[0];
    const dx = t.clientX - state.startX;
    const dy = t.clientY - state.startY;
    if (Math.sqrt(dx * dx + dy * dy) > 10) {
      if (longPressRef.current) { clearTimeout(longPressRef.current); longPressRef.current = null; }
      dragRef.current = null;
    }
  }, []);

  const handleItemTouchEnd = useCallback(() => {
    if (!dragRef.current?.isActive) cancelDrag();
  }, [cancelDrag]);

  // ── Shared button props factory ───────────────────────────────────────────
  const itemPayload = (item: LibraryItem): AddPayload => ({
    inspirationId: item.id,
    storageKey:    item.storageKey,
    thumbnailKey:  item.thumbnailKey,
    title:         item.title,
    width:         item.width,
    height:        item.height,
    isAnimated:    item.isAnimated ?? false,
  });

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

      {/* Scrollable masonry */}
      <div className="flex-1 overflow-y-auto p-2">
        {loading ? (
          // Skeleton: two columns with staggered heights to mimic masonry
          <div className="flex gap-1.5">
            {[
              [9/16, 4/3, 1, 9/16, 3/4],
              [1, 9/16, 3/4, 4/3, 9/16],
            ].map((ratios, ci) => (
              <div key={ci} className="flex-1 flex flex-col gap-1.5">
                {ratios.map((ar, i) => (
                  <div
                    key={i}
                    className="w-full rounded bg-[var(--bg-surface)] animate-pulse"
                    style={{ aspectRatio: `${1}/${ar}` }}
                  />
                ))}
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-xs text-[var(--text-tertiary)] text-center py-8">Aucun résultat</p>
        ) : (
          <div className="flex gap-1.5">
            {columns.map((col, ci) => (
              <div key={ci} className="flex-1 flex flex-col gap-1.5">
                {col.map((item) => {
                  const ar = item.height && item.width
                    ? item.height / item.width
                    : 9 / 16;
                  return (
                    <button
                      key={item.id}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = "copy";
                        e.dataTransfer.setData(
                          "application/moodboard-item",
                          JSON.stringify(itemPayload(item))
                        );
                      }}
                      onClick={() => onAdd(itemPayload(item))}
                      onTouchStart={(e) => handleItemTouchStart(item, e)}
                      onTouchMove={handleItemTouchMove}
                      onTouchEnd={handleItemTouchEnd}
                      onTouchCancel={cancelDrag}
                      className="relative w-full bg-[var(--bg-surface)] hover:ring-2 hover:ring-[var(--accent,#a78bfa)] transition-all group cursor-grab active:cursor-grabbing"
                      style={{
                        aspectRatio: `1 / ${ar}`,
                        borderRadius: 8,
                        overflow: "hidden",
                        transform: "translateZ(0)",
                      }}
                      title={`${item.title} — glisser ou cliquer pour ajouter`}
                    >
                      <img
                        src={getThumbnailUrl(item.thumbnailKey)}
                        alt={item.title}
                        className="absolute inset-0 w-full h-full object-cover"
                      />
                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-1.5 py-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <p className="text-[9px] text-white truncate">{item.title}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Touch drag ghost */}
      {dragGhost && (
        <div
          className="fixed pointer-events-none"
          style={{
            left:      dragGhost.x - 48,
            top:       dragGhost.y - 40,
            width:     96,
            height:    80,
            zIndex:    9999,
            borderRadius: 8,
            overflow:  "hidden",
            opacity:   0.88,
            boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
            transform: "translateZ(0)",
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
