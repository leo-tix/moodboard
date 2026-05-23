"use client";

import { useState, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import { InspirationCard } from "./InspirationCard";

export interface InspirationGridItem {
  id: string;
  title: string;
  year: number | null;
  categories: { category: { name: string } }[];
  images: {
    storageKey?: string | null;
    thumbnailKey: string | null;
    blurHash: string | null;
    width: number | null;
    height: number | null;
    isMain: boolean;
    isAnimated?: boolean;
  }[];
  tags: { tag: { name: string } }[];
}

interface InspirationGridProps {
  inspirations: InspirationGridItem[];
  columns?: 2 | 3 | 4 | 5;
  selectable?: boolean;
  selectedIds?: Set<string>;
  onSelect?: (id: string) => void;
  onBeforeNavigate?: () => void;
  emptyMessage?: string;
}

// Responsive column count — mobile-first.
// Mirrors the old CSS breakpoints: columns-2 sm:columns-3 lg:columns-4.
function useColCount(target: 2 | 3 | 4 | 5): number {
  const [cols, setCols] = useState(2); // mobile default before hydration
  useEffect(() => {
    const update = () => {
      const w = window.innerWidth;
      const resolved: Record<number, number> = {
        2: 2,
        3: w >= 640 ? 3 : 2,
        4: w >= 1024 ? 4 : w >= 640 ? 3 : 2,
        5: w >= 1280 ? 5 : w >= 1024 ? 4 : w >= 640 ? 3 : 2,
      };
      setCols(resolved[target]);
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [target]);
  return cols;
}

// Shortest-column-first masonry using real image aspect ratios.
// Deterministic: adding items at the end never moves earlier items between columns.
function buildMasonryColumns(
  items: InspirationGridItem[],
  colCount: number
): InspirationGridItem[][] {
  const cols: InspirationGridItem[][] = Array.from({ length: colCount }, () => []);
  const heights = new Array<number>(colCount).fill(0);
  for (const item of items) {
    const img = item.images.find((i) => i.isMain) ?? item.images[0];
    const ar = img?.height && img?.width ? img.height / img.width : 1;
    const shortest = heights.indexOf(Math.min(...heights));
    cols[shortest].push(item);
    heights[shortest] += ar;
  }
  return cols;
}

export function InspirationGrid({
  inspirations,
  columns = 4,
  selectable,
  selectedIds,
  onSelect,
  onBeforeNavigate,
  emptyMessage,
}: InspirationGridProps) {
  const colCount = useColCount(columns);
  const masonryCols = useMemo(
    () => buildMasonryColumns(inspirations, colCount),
    [inspirations, colCount]
  );

  if (inspirations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-32 text-center">
        <p className="text-[var(--text-tertiary)] text-sm mb-1">
          {emptyMessage ?? "Aucune inspiration pour le moment"}
        </p>
        {!emptyMessage && (
          <a
            href="/upload"
            className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors underline underline-offset-4"
          >
            Ajouter des références →
          </a>
        )}
      </div>
    );
  }

  return (
    <div className="flex gap-2">
      {masonryCols.map((col, ci) => (
        <div key={ci} className="flex-1 flex flex-col gap-2">
          {col.map((item, i) => {
            const mainImage = item.images.find((img) => img.isMain) ?? item.images[0];
            const firstCategory = item.categories[0]?.category.name ?? null;
            const extraCount = item.categories.length > 1 ? item.categories.length - 1 : 0;

            return (
              <motion.div
                key={item.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.2, delay: Math.min(i * 0.02, 0.1) }}
              >
                <InspirationCard
                  id={item.id}
                  title={item.title}
                  thumbnailKey={mainImage?.thumbnailKey ?? null}
                  blurHash={mainImage?.blurHash ?? null}
                  width={mainImage?.width ?? null}
                  height={mainImage?.height ?? null}
                  isAnimated={mainImage?.isAnimated ?? false}
                  category={
                    firstCategory
                      ? extraCount > 0
                        ? `${firstCategory} +${extraCount}`
                        : firstCategory
                      : null
                  }
                  tags={item.tags.map((t) => t.tag.name)}
                  year={item.year}
                  selectable={selectable}
                  selected={selectedIds?.has(item.id)}
                  onSelect={onSelect}
                  onBeforeNavigate={!selectable ? onBeforeNavigate : undefined}
                />
              </motion.div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
