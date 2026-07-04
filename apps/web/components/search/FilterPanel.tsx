"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useCallback } from "react";
import { cn } from "@/lib/utils";

interface Category {
  id: string;
  name: string;
  slug: string;
}

interface FilterPanelProps {
  categories: Category[];
  popularTags: { name: string; slug: string; count: number }[];
}

export function FilterPanel({ categories, popularTags }: FilterPanelProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const activeCategoryId = searchParams.get("categoryId") ?? "";
  const activeTags = (searchParams.get("tags") ?? "").split(",").filter(Boolean);
  const yearFrom = searchParams.get("yearFrom") ?? "";
  const yearTo = searchParams.get("yearTo") ?? "";
  const activeColor = searchParams.get("color") ?? "";

  const updateParam = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) params.set(key, value);
      else params.delete(key);
      params.delete("page");
      router.push(`${pathname}?${params.toString()}`);
    },
    [router, pathname, searchParams]
  );

  const toggleTag = useCallback(
    (slug: string) => {
      const current = (searchParams.get("tags") ?? "").split(",").filter(Boolean);
      const next = current.includes(slug)
        ? current.filter((t) => t !== slug)
        : [...current, slug];
      updateParam("tags", next.join(","));
    },
    [searchParams, updateParam]
  );

  const hasFilters = activeCategoryId || activeTags.length > 0 || yearFrom || yearTo || activeColor;

  const clearAll = () => {
    const params = new URLSearchParams(searchParams.toString());
    ["categoryId", "tags", "yearFrom", "yearTo", "color", "page"].forEach((k) => params.delete(k));
    router.push(`${pathname}?${params.toString()}`);
  };

  return (
    // Pleine largeur dans le bottom sheet mobile ; colonne fixe en sidebar desktop
    <aside className="w-full md:w-52 flex-shrink-0 space-y-6">
      {hasFilters && (
        <button
          onClick={clearAll}
          className="text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors"
        >
          ← Effacer les filtres
        </button>
      )}

      {/* Couleur dominante */}
      <section>
        <p className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-widest mb-3">
          Couleur
        </p>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={activeColor ? `#${activeColor}` : "#888888"}
              onChange={(e) => updateParam("color", e.target.value.replace("#", ""))}
              className="w-8 h-8 rounded cursor-pointer border border-[var(--border-subtle)] bg-transparent p-0.5"
            />
            <div className="flex-1">
              {activeColor ? (
                <div className="flex items-center gap-1.5">
                  <div className="w-4 h-4 rounded-sm flex-shrink-0" style={{ backgroundColor: `#${activeColor}` }} />
                  <span className="text-[10px] font-mono text-[var(--text-secondary)]">#{activeColor.toUpperCase()}</span>
                  <button
                    onClick={() => updateParam("color", "")}
                    className="ml-auto text-[10px] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors"
                  >
                    ×
                  </button>
                </div>
              ) : (
                <p className="text-[10px] text-[var(--text-tertiary)]">Choisir une couleur</p>
              )}
            </div>
          </div>
          {/* Quick palette presets — plus grands au tactile */}
          <div className="flex flex-wrap gap-1.5 md:gap-1">
            {[
              "#E8E0D4", "#1a1a1a", "#4a3728", "#8B4513", "#D2691E",
              "#2F4F4F", "#1C3A5E", "#4169E1", "#9370DB", "#C71585",
              "#DC143C", "#FF6347", "#FFA500", "#FFD700", "#90EE90",
            ].map((c) => (
              <button
                key={c}
                title={c}
                onClick={() => updateParam("color", c.replace("#", ""))}
                className={cn(
                  "w-8 h-8 md:w-5 md:h-5 rounded-md md:rounded-sm transition-transform hover:scale-110 border",
                  activeColor === c.replace("#", "")
                    ? "border-[var(--text-primary)] scale-110"
                    : "border-transparent"
                )}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>
      </section>

      {/* Catégories */}
      {categories.length > 0 && (
        <section>
          <p className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-widest mb-3">
            Catégorie
          </p>
          <ul className="space-y-0.5">
            <li>
              <button
                onClick={() => updateParam("categoryId", "")}
                className={cn(
                  "w-full text-left text-sm md:text-xs px-2.5 py-2.5 md:py-1.5 rounded transition-colors",
                  !activeCategoryId
                    ? "text-[var(--text-primary)] bg-[var(--bg-elevated)]"
                    : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                )}
              >
                Toutes
              </button>
            </li>
            {categories.map((cat) => (
              <li key={cat.id}>
                <button
                  onClick={() => updateParam("categoryId", activeCategoryId === cat.id ? "" : cat.id)}
                  className={cn(
                    "w-full text-left text-sm md:text-xs px-2.5 py-2.5 md:py-1.5 rounded transition-colors",
                    activeCategoryId === cat.id
                      ? "text-[var(--text-primary)] bg-[var(--bg-elevated)]"
                      : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                  )}
                >
                  {cat.name}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Années */}
      <section>
        <p className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-widest mb-3">Période</p>
        <div className="flex items-center gap-2">
          <input
            type="number"
            placeholder="1990"
            value={yearFrom}
            onChange={(e) => updateParam("yearFrom", e.target.value)}
            className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-primary)] text-xs rounded px-2 py-1.5 focus:outline-none focus:border-[var(--border-default)] placeholder:text-[var(--text-tertiary)] transition-colors"
          />
          <span className="text-[var(--text-tertiary)] text-xs flex-shrink-0">—</span>
          <input
            type="number"
            placeholder="2024"
            value={yearTo}
            onChange={(e) => updateParam("yearTo", e.target.value)}
            className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-primary)] text-xs rounded px-2 py-1.5 focus:outline-none focus:border-[var(--border-default)] placeholder:text-[var(--text-tertiary)] transition-colors"
          />
        </div>
      </section>

      {/* Tags */}
      {popularTags.length > 0 && (
        <section>
          <p className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-widest mb-3">Tags</p>
          <div className="flex flex-wrap gap-1.5">
            {popularTags.map((tag) => {
              const isActive = activeTags.includes(tag.slug);
              return (
                <button
                  key={tag.slug}
                  onClick={() => toggleTag(tag.slug)}
                  className={cn(
                    "text-xs md:text-[10px] px-3 py-2 md:px-2 md:py-1 rounded-full md:rounded-sm border transition-colors",
                    isActive
                      ? "bg-[var(--text-primary)] text-[var(--bg-base)] border-[var(--text-primary)]"
                      : "bg-transparent text-[var(--text-tertiary)] border-[var(--border-subtle)] hover:text-[var(--text-secondary)] hover:border-[var(--border-default)]"
                  )}
                >
                  {tag.name}
                  <span className="ml-1 opacity-40">{tag.count}</span>
                </button>
              );
            })}
          </div>
        </section>
      )}
    </aside>
  );
}
