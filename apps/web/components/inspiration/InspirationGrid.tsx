"use client";

import { motion } from "framer-motion";
import { InspirationCard } from "./InspirationCard";

interface Inspiration {
  id: string;
  title: string;
  year: number | null;
  category: { name: string } | null;
  images: {
    thumbnailKey: string | null;
    blurHash: string | null;
    width: number | null;
    height: number | null;
    isMain: boolean;
  }[];
  tags: { tag: { name: string } }[];
}

interface InspirationGridProps {
  inspirations: Inspiration[];
  columns?: 2 | 3 | 4 | 5;
}

export function InspirationGrid({
  inspirations,
  columns = 4,
}: InspirationGridProps) {
  if (inspirations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-32 text-center">
        <p className="text-[var(--text-tertiary)] text-sm mb-1">
          Aucune inspiration pour le moment
        </p>
        <a
          href="/upload"
          className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors underline underline-offset-4"
        >
          Ajouter des références →
        </a>
      </div>
    );
  }

  const colClass: Record<number, string> = {
    2: "columns-2",
    3: "columns-3",
    4: "columns-2 sm:columns-3 lg:columns-4",
    5: "columns-2 sm:columns-3 lg:columns-4 xl:columns-5",
  };

  return (
    <div className={`${colClass[columns]} gap-2`}>
      {inspirations.map((item, i) => {
        const mainImage = item.images.find((img) => img.isMain) ?? item.images[0];

        return (
          <motion.div
            key={item.id}
            className="mb-2 break-inside-avoid"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: Math.min(i * 0.04, 0.6) }}
          >
            <InspirationCard
              id={item.id}
              title={item.title}
              thumbnailKey={mainImage?.thumbnailKey ?? null}
              blurHash={mainImage?.blurHash ?? null}
              width={mainImage?.width ?? null}
              height={mainImage?.height ?? null}
              category={item.category?.name}
              tags={item.tags.map((t) => t.tag.name)}
              year={item.year}
            />
          </motion.div>
        );
      })}
    </div>
  );
}
