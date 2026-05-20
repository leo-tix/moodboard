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

  const updateParam = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
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

  const hasFilters = activeCategoryId || activeTags.length > 0 || yearFrom || yearTo;

  const clearAll = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("categoryId");
    params.delete("tags");
    params.delete("yearFrom");
    params.delete("yearTo");
    params.delete("page");
    router.push(`${pathname}?${params.toString()}`);
  };

  return (
    <aside className="w-52 flex-shrink-0 space-y-6">
      {/* Clear all */}
      {hasFilters && (
        <button
          onClick={clearAll}
          className="text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors"
        >
          ← Effacer les filtres
        </button>
      )}

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
                  "w-full text-left text-xs px-2.5 py-1.5 rounded transition-colors",
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
                  onClick={() =>
                    updateParam("categoryId", activeCategoryId === cat.id ? "" : cat.id)
                  }
                  className={cn(
                    "w-full text-left text-xs px-2.5 py-1.5 rounded transition-colors",
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
        <p className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-widest mb-3">
          Période
        </p>
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

      {/* Tags populaires */}
      {popularTags.length > 0 && (
        <section>
          <p className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-widest mb-3">
            Tags
          </p>
          <div className="flex flex-wrap gap-1.5">
            {popularTags.map((tag) => {
              const isActive = activeTags.includes(tag.slug);
              return (
                <button
                  key={tag.slug}
                  onClick={() => toggleTag(tag.slug)}
                  className={cn(
                    "text-[10px] px-2 py-1 rounded-sm border transition-colors",
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
