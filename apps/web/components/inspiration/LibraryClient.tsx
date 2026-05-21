"use client";

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { InspirationGrid, type InspirationGridItem } from "./InspirationGrid";
import { BatchEditBar } from "./BatchEditBar";
import { Lightbox, type LightboxItem } from "@/components/library/Lightbox";

const PAGE_SIZE = 48;

type SortKey = "newest" | "oldest" | "year_desc" | "year_asc" | "title_asc";

const SORT_LABELS: Record<SortKey, string> = {
  newest: "Ajoutées récemment",
  oldest: "Plus anciennes",
  year_desc: "Année ↓",
  year_asc: "Année ↑",
  title_asc: "Titre A→Z",
};

interface LibraryClientProps {
  inspirations: InspirationGridItem[];
}

// ─── Generic dropdown ─────────────────────────────────────────────────────────

function Dropdown<T extends string>({
  value,
  options,
  labels,
  onChange,
  placeholder,
}: {
  value: T | null;
  options: T[];
  labels?: Partial<Record<T, string>>;
  onChange: (v: T | null) => void;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const active = value !== null;
  const displayLabel = value ? (labels?.[value] ?? value) : placeholder;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border transition-all whitespace-nowrap ${
          active
            ? "bg-[var(--text-primary)] text-[var(--bg-base)] border-[var(--text-primary)]"
            : "bg-transparent text-[var(--text-secondary)] border-[var(--border-default)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
        }`}
      >
        {displayLabel}
        <svg
          className={`w-3 h-3 opacity-60 transition-transform ${open ? "rotate-180" : ""}`}
          viewBox="0 0 12 12"
          fill="none"
        >
          <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ duration: 0.12 }}
            className="absolute top-full mt-1.5 right-0 z-50 min-w-[9rem] bg-[var(--bg-elevated)] border border-[var(--border-default)] rounded-lg shadow-xl py-1 overflow-hidden"
          >
            {value !== null && (
              <button
                onClick={() => { onChange(null); setOpen(false); }}
                className="w-full text-left px-3 py-1.5 text-xs text-[var(--text-tertiary)] hover:bg-[var(--bg-surface)] transition-colors"
              >
                Tout afficher
              </button>
            )}
            {options.map((opt) => (
              <button
                key={opt}
                onClick={() => { onChange(opt === value ? null : opt); setOpen(false); }}
                className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
                  opt === value
                    ? "text-[var(--text-primary)] bg-[var(--bg-surface)]"
                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)]"
                }`}
              >
                {labels?.[opt] ?? opt}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Sort dropdown (never null) ───────────────────────────────────────────────

function SortDropdown({
  value,
  onChange,
}: {
  value: SortKey;
  onChange: (v: SortKey) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border border-[var(--border-default)] text-[var(--text-tertiary)] hover:border-[var(--border-strong)] hover:text-[var(--text-secondary)] transition-all whitespace-nowrap"
      >
        {SORT_LABELS[value]}
        <svg
          className={`w-3 h-3 opacity-50 transition-transform ${open ? "rotate-180" : ""}`}
          viewBox="0 0 12 12"
          fill="none"
        >
          <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ duration: 0.12 }}
            className="absolute top-full mt-1.5 right-0 z-50 min-w-[11rem] bg-[var(--bg-elevated)] border border-[var(--border-default)] rounded-lg shadow-xl py-1 overflow-hidden"
          >
            {(Object.keys(SORT_LABELS) as SortKey[]).map((opt) => (
              <button
                key={opt}
                onClick={() => { onChange(opt); setOpen(false); }}
                className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
                  opt === value
                    ? "text-[var(--text-primary)] bg-[var(--bg-surface)]"
                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)]"
                }`}
              >
                {SORT_LABELS[opt]}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function LibraryClient({ inspirations }: LibraryClientProps) {
  // ── Filter state ──
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [activeYear, setActiveYear] = useState<string | null>(null);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortKey>("newest");

  // ── Select mode ──
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // ── Lightbox ──
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  // ── Infinite scroll ──
  const [displayCount, setDisplayCount] = useState(PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setSelectMode(false);
  }, []);

  // ── Derived filter options ──
  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const ins of inspirations) {
      for (const c of ins.categories) {
        const name = c.category.name;
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name]) => name);
  }, [inspirations]);

  const years = useMemo(() => {
    const set = new Set<string>();
    for (const ins of inspirations) {
      if (ins.year) set.add(String(ins.year));
    }
    return [...set].sort((a, b) => Number(b) - Number(a));
  }, [inspirations]);

  const topTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const ins of inspirations) {
      for (const t of ins.tags) {
        const name = t.tag.name;
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([name]) => name);
  }, [inspirations]);

  // ── Filtered + sorted results ──
  const filtered = useMemo(() => {
    let result = inspirations;

    if (activeCategory) {
      result = result.filter((ins) =>
        ins.categories.some((c) => c.category.name === activeCategory)
      );
    }
    if (activeYear) {
      result = result.filter((ins) => ins.year !== null && String(ins.year) === activeYear);
    }
    if (activeTag) {
      result = result.filter((ins) => ins.tags.some((t) => t.tag.name === activeTag));
    }

    // Server already returns newest-first; "oldest" just reverses that.
    if (sortBy === "oldest") return [...result].reverse();

    return [...result].sort((a, b) => {
      switch (sortBy) {
        case "year_desc":
          return (b.year ?? 0) - (a.year ?? 0);
        case "year_asc":
          return (a.year ?? 0) - (b.year ?? 0);
        case "title_asc":
          return a.title.localeCompare(b.title);
        default: // newest — preserve server order
          return 0;
      }
    });
  }, [inspirations, activeCategory, activeYear, activeTag, sortBy]);

  const hasActiveFilter = activeCategory !== null || activeYear !== null || activeTag !== null;
  const resetFilters = () => {
    setActiveCategory(null);
    setActiveYear(null);
    setActiveTag(null);
  };

  // Reset display count when filters change
  useEffect(() => { setDisplayCount(PAGE_SIZE); }, [activeCategory, activeYear, activeTag, sortBy]);

  // Infinite scroll via IntersectionObserver
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setDisplayCount((c) => c + PAGE_SIZE);
        }
      },
      { rootMargin: "200px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // ── Lightbox helpers ──
  const lightboxItems = useMemo((): LightboxItem[] =>
    filtered.map((item) => ({
      id: item.id,
      title: item.title,
      storageKey: item.images[0]?.storageKey ?? null,
      year: item.year,
      category: item.categories[0]?.category.name ?? null,
    })),
  [filtered]);

  const openLightbox = useCallback((id: string) => {
    const idx = filtered.findIndex((item) => item.id === id);
    if (idx !== -1) setLightboxIndex(idx);
  }, [filtered]);

  const displayed = filtered.slice(0, displayCount);

  return (
    <>
      {/* ── Top bar ── */}
      <div className="sticky top-0 z-30 -mx-6 px-6 py-3 bg-[var(--bg-base)]/90 backdrop-blur-md border-b border-[var(--border-subtle)] mb-6">
        <div className="flex items-center gap-3">

          {/* Category pills — scrollable */}
          <div className="flex items-center gap-1.5 flex-1 min-w-0 overflow-x-auto scrollbar-none">
            {/* "Tout" pill */}
            <button
              onClick={resetFilters}
              className={`flex-shrink-0 text-xs px-3 py-1.5 rounded-full border transition-all whitespace-nowrap ${
                !hasActiveFilter
                  ? "bg-[var(--text-primary)] text-[var(--bg-base)] border-[var(--text-primary)]"
                  : "bg-transparent text-[var(--text-secondary)] border-[var(--border-default)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
              }`}
            >
              Tout
            </button>

            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveCategory(activeCategory === cat ? null : cat)}
                className={`flex-shrink-0 text-xs px-3 py-1.5 rounded-full border transition-all whitespace-nowrap ${
                  activeCategory === cat
                    ? "bg-[var(--text-primary)] text-[var(--bg-base)] border-[var(--text-primary)]"
                    : "bg-transparent text-[var(--text-secondary)] border-[var(--border-default)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Right-side controls */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {years.length > 0 && (
              <Dropdown
                value={activeYear}
                options={years}
                onChange={setActiveYear}
                placeholder="Année"
              />
            )}

            {topTags.length > 0 && (
              <Dropdown
                value={activeTag}
                options={topTags}
                onChange={setActiveTag}
                placeholder="Style"
              />
            )}

            <SortDropdown value={sortBy} onChange={setSortBy} />

            {/* Divider */}
            <div className="w-px h-4 bg-[var(--border-subtle)]" />

            {/* Select mode */}
            {selectMode ? (
              <div className="flex items-center gap-2">
                {filtered.length > 0 && (
                  <button
                    onClick={() => {
                      const allIds = new Set(filtered.map((i) => i.id));
                      setSelectedIds((prev) => (prev.size === allIds.size ? new Set() : allIds));
                    }}
                    className="text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors whitespace-nowrap"
                  >
                    {selectedIds.size === filtered.length ? "Tout désélect." : "Tout sélect."}
                  </button>
                )}
                <button
                  onClick={clearSelection}
                  className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] px-3 py-1.5 rounded-full border border-[var(--border-default)] hover:border-[var(--border-strong)] transition-colors"
                >
                  Annuler
                </button>
              </div>
            ) : (
              <button
                onClick={() => { setSelectMode(true); setSelectedIds(new Set()); }}
                className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] px-3 py-1.5 rounded-full border border-[var(--border-default)] hover:border-[var(--border-strong)] transition-colors"
              >
                Sélectionner
              </button>
            )}
          </div>
        </div>

        {/* Count + active filter summary */}
        {(hasActiveFilter || selectMode) && (
          <div className="flex items-center gap-3 mt-2">
            <p className="text-[10px] text-[var(--text-tertiary)]">
              {filtered.length} image{filtered.length !== 1 ? "s" : ""}
              {selectMode && selectedIds.size > 0 && (
                <span className="ml-2 text-[var(--text-secondary)]">
                  · {selectedIds.size} sélectionnée{selectedIds.size > 1 ? "s" : ""}
                </span>
              )}
            </p>
            {hasActiveFilter && (
              <button
                onClick={resetFilters}
                className="text-[10px] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors underline underline-offset-2"
              >
                Réinitialiser les filtres
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Grid ── */}
      <InspirationGrid
        inspirations={displayed}
        columns={4}
        selectable={selectMode}
        selectedIds={selectedIds}
        onSelect={toggleSelect}
        onOpen={!selectMode ? openLightbox : undefined}
        emptyMessage={
          hasActiveFilter
            ? "Aucune image ne correspond à ces filtres."
            : undefined
        }
      />

      {/* ── Infinite scroll sentinel ── */}
      {displayCount < filtered.length && (
        <div ref={sentinelRef} className="flex items-center justify-center py-8">
          <span className="text-[11px] text-[var(--text-tertiary)]">
            {displayed.length} / {filtered.length}
          </span>
        </div>
      )}

      {/* ── Batch bar ── */}
      <AnimatePresence>
        {selectedIds.size > 0 && (
          <BatchEditBar
            selectedIds={Array.from(selectedIds)}
            onClear={clearSelection}
            onSaved={() => {
              clearSelection();
              window.location.reload();
            }}
          />
        )}
      </AnimatePresence>

      {/* ── Lightbox ── */}
      {lightboxIndex !== null && (
        <Lightbox
          items={lightboxItems}
          currentIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onNavigate={setLightboxIndex}
        />
      )}
    </>
  );
}
