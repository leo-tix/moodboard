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

interface Category {
  id: string;
  name: string;
  icon?: string | null;
}

interface Tag {
  name: string;
  slug: string;
  count: number;
}

interface Props {
  onAdd: (item: AddPayload) => void;
  onTouchAdd?: (item: AddPayload, clientX: number, clientY: number) => void;
}

const COL_COUNT = 2;

// Mêmes presets que FilterPanel (/search), pour une UX cohérente entre les
// deux points d'entrée de recherche couleur du site.
const COLOR_PRESETS = [
  "#E8E0D4", "#1a1a1a", "#4a3728", "#8B4513", "#D2691E",
  "#2F4F4F", "#1C3A5E", "#4169E1", "#9370DB", "#C71585",
  "#DC143C", "#FF6347", "#FFA500", "#FFD700", "#90EE90",
];

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
  const [items,        setItems]        = useState<LibraryItem[]>([]);
  const [search,       setSearch]       = useState("");
  const [debouncedQ,   setDebouncedQ]   = useState("");
  const [loading,      setLoading]      = useState(true);
  const [categories,   setCategories]   = useState<Category[]>([]);
  const [activeCat,    setActiveCat]    = useState<string>("");

  // Filtres avancés — parité avec /search (FilterPanel) : tags, année,
  // couleur dominante. Repliés par défaut pour ne pas noyer le panneau
  // (sidebar de 256px pendant l'édition du canvas), dépliés seulement s'ils
  // sont utilisés ou explicitement ouverts.
  const [filtersOpen,  setFiltersOpen]  = useState(false);
  const [popularTags,  setPopularTags]  = useState<Tag[]>([]);
  const [activeTags,   setActiveTags]   = useState<string[]>([]);
  const [yearFrom,     setYearFrom]     = useState("");
  const [yearTo,       setYearTo]       = useState("");
  const [activeColor,  setActiveColor]  = useState("");

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
  const searchTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelDrag = useCallback(() => {
    if (longPressRef.current) { clearTimeout(longPressRef.current); longPressRef.current = null; }
    if (dragRef.current?.cleanup) dragRef.current.cleanup();
    dragRef.current = null;
    setDragGhost(null);
  }, []);

  useEffect(() => cancelDrag, [cancelDrag]);

  // ── Fetch categories + popular tags ───────────────────────────────────────
  useEffect(() => {
    fetch("/api/categories")
      .then((r) => r.json())
      .then((data: Category[]) => setCategories(data))
      .catch(() => {});
    fetch("/api/tags/popular")
      .then((r) => r.json())
      .then((data: Tag[]) => setPopularTags(data))
      .catch(() => {});
  }, []);

  // ── Debounce search input ─────────────────────────────────────────────────
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setDebouncedQ(search.trim()), 300);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [search]);

  // ── Fetch library (with filters) ─────────────────────────────────────────
  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ limit: "200" });
    if (debouncedQ)     params.set("q", debouncedQ);
    if (activeCat)      params.set("categoryId", activeCat);
    if (activeTags.length) params.set("tags", activeTags.join(","));
    if (yearFrom)       params.set("yearFrom", yearFrom);
    if (yearTo)         params.set("yearTo", yearTo);
    if (activeColor)    params.set("color", activeColor);

    fetch(`/api/library/strip?${params}`)
      .then((r) => r.json())
      .then((data) => {
        const raw: Array<{
          id: string; title: string; storageKey: string | null;
          thumbnailKey: string | null; width: number | null;
          height: number | null; isAnimated?: boolean;
        }> = data.items ?? [];
        setItems(
          raw.filter((i): i is LibraryItem => !!i.storageKey && !!i.thumbnailKey)
        );
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [debouncedQ, activeCat, activeTags, yearFrom, yearTo, activeColor]);

  const toggleTag = useCallback((slug: string) => {
    setActiveTags((prev) => (prev.includes(slug) ? prev.filter((t) => t !== slug) : [...prev, slug]));
  }, []);

  const hasAdvancedFilters = activeTags.length > 0 || !!yearFrom || !!yearTo || !!activeColor;

  const clearAdvancedFilters = () => {
    setActiveTags([]);
    setYearFrom("");
    setYearTo("");
    setActiveColor("");
  };

  const columns = useMemo(() => buildMasonryColumns(items), [items]);

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
      <div className="flex-shrink-0 px-3 py-2.5 border-b border-[var(--border-subtle)] space-y-2">
        <p className="text-xs font-medium text-[var(--text-secondary)]">Bibliothèque</p>

        {/* Search */}
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher…"
          className="w-full text-xs bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded px-2 py-1.5 text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none focus:border-[var(--border-default)]"
        />

        {/* Category pills */}
        {categories.length > 0 && (
          <div className="flex gap-1 flex-wrap">
            <button
              onClick={() => setActiveCat("")}
              className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors whitespace-nowrap ${
                !activeCat
                  ? "bg-[var(--text-primary)] text-[var(--bg-base)] border-[var(--text-primary)]"
                  : "border-[var(--border-default)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
              }`}
            >
              Tout
            </button>
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setActiveCat(activeCat === cat.id ? "" : cat.id)}
                className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors whitespace-nowrap ${
                  activeCat === cat.id
                    ? "bg-[var(--text-primary)] text-[var(--bg-base)] border-[var(--text-primary)]"
                    : "border-[var(--border-default)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                }`}
              >
                {cat.icon ? `${cat.icon} ` : ""}{cat.name}
              </button>
            ))}
          </div>
        )}

        {/* Toggle filtres avancés — tags/année/couleur, parité avec /search */}
        <div className="flex items-center justify-between">
          <button
            onClick={() => setFiltersOpen((v) => !v)}
            className={`text-[10px] transition-colors ${
              hasAdvancedFilters ? "text-[var(--text-primary)]" : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
            }`}
          >
            {filtersOpen ? "▾" : "▸"} Filtres{hasAdvancedFilters ? ` (${activeTags.length + (yearFrom || yearTo ? 1 : 0) + (activeColor ? 1 : 0)})` : ""}
          </button>
          {hasAdvancedFilters && (
            <button
              onClick={clearAdvancedFilters}
              className="text-[10px] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors"
            >
              Effacer
            </button>
          )}
        </div>

        {filtersOpen && (
          <div className="space-y-2.5 pt-0.5">
            {/* Couleur dominante */}
            <div>
              <p className="text-[9px] text-[var(--text-tertiary)] uppercase tracking-widest mb-1.5">Couleur</p>
              <div className="flex flex-wrap gap-1">
                {COLOR_PRESETS.map((c) => (
                  <button
                    key={c}
                    title={c}
                    onClick={() => setActiveColor(activeColor === c.replace("#", "") ? "" : c.replace("#", ""))}
                    className={`w-4 h-4 rounded-sm border transition-transform hover:scale-110 ${
                      activeColor === c.replace("#", "") ? "border-[var(--text-primary)] scale-110" : "border-transparent"
                    }`}
                    style={{ backgroundColor: c }}
                  />
                ))}
                <input
                  type="color"
                  value={activeColor ? `#${activeColor}` : "#888888"}
                  onChange={(e) => setActiveColor(e.target.value.replace("#", ""))}
                  className="w-4 h-4 rounded-sm cursor-pointer border border-[var(--border-subtle)] bg-transparent p-0"
                  title="Couleur personnalisée"
                />
              </div>
            </div>

            {/* Période */}
            <div>
              <p className="text-[9px] text-[var(--text-tertiary)] uppercase tracking-widest mb-1.5">Période</p>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  placeholder="1990"
                  value={yearFrom}
                  onChange={(e) => setYearFrom(e.target.value)}
                  className="w-full text-[10px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded px-1.5 py-1 text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none focus:border-[var(--border-default)]"
                />
                <span className="text-[var(--text-tertiary)] text-[10px] flex-shrink-0">—</span>
                <input
                  type="number"
                  placeholder="2024"
                  value={yearTo}
                  onChange={(e) => setYearTo(e.target.value)}
                  className="w-full text-[10px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded px-1.5 py-1 text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none focus:border-[var(--border-default)]"
                />
              </div>
            </div>

            {/* Tags */}
            {popularTags.length > 0 && (
              <div>
                <p className="text-[9px] text-[var(--text-tertiary)] uppercase tracking-widest mb-1.5">Tags</p>
                <div className="flex flex-wrap gap-1">
                  {popularTags.map((tag) => {
                    const isActive = activeTags.includes(tag.slug);
                    return (
                      <button
                        key={tag.slug}
                        onClick={() => toggleTag(tag.slug)}
                        className={`text-[9px] px-1.5 py-0.5 rounded-full border transition-colors whitespace-nowrap ${
                          isActive
                            ? "bg-[var(--text-primary)] text-[var(--bg-base)] border-[var(--text-primary)]"
                            : "border-[var(--border-subtle)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                        }`}
                      >
                        {tag.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Result count */}
        {!loading && (debouncedQ || activeCat || hasAdvancedFilters) && (
          <p className="text-[10px] text-[var(--text-tertiary)]">
            {items.length} résultat{items.length !== 1 ? "s" : ""}
          </p>
        )}
      </div>

      {/* Scrollable masonry */}
      <div className="flex-1 overflow-y-auto p-2">
        {loading ? (
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
        ) : items.length === 0 ? (
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
                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-1.5 py-1 opacity-0 group-hover:opacity-100 pointer-coarse:opacity-100 transition-opacity">
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
