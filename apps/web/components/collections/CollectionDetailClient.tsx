"use client";

import { useState } from "react";
import { InspirationCard } from "@/components/inspiration/InspirationCard";

interface InspirationItem {
  inspiration: {
    id: string;
    title: string;
    year: number | null;
    images: {
      thumbnailKey: string | null;
      blurHash: string | null;
      width: number | null;
      height: number | null;
    }[];
    categories: { category: { name: string } }[];
    tags: { tag: { name: string } }[];
  };
}

interface CollectionDetailClientProps {
  collectionId: string;
  initialItems: InspirationItem[];
}

export function CollectionDetailClient({
  collectionId,
  initialItems,
}: CollectionDetailClientProps) {
  const [items, setItems] = useState(initialItems);
  const [removing, setRemoving] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const removeOne = async (inspirationId: string) => {
    setRemoving(inspirationId);
    try {
      await fetch(`/api/collections/${collectionId}/items`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inspirationIds: [inspirationId] }),
      });
      setItems((prev) => prev.filter((it) => it.inspiration.id !== inspirationId));
    } finally {
      setRemoving(null);
    }
  };

  const removeSelected = async () => {
    const ids = Array.from(selected);
    setRemoving("batch");
    try {
      await fetch(`/api/collections/${collectionId}/items`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inspirationIds: ids }),
      });
      setItems((prev) => prev.filter((it) => !ids.includes(it.inspiration.id)));
      setSelected(new Set());
      setSelectMode(false);
    } finally {
      setRemoving(null);
    }
  };

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <p className="text-[var(--text-tertiary)] text-sm">Cette collection est vide.</p>
        <p className="text-[var(--text-tertiary)] text-xs mt-1">
          Ajoutez des images depuis la bibliothèque.
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-[var(--text-tertiary)]">
          {items.length} image{items.length !== 1 ? "s" : ""}
        </p>
        <div className="flex items-center gap-3">
          {selectMode && selected.size > 0 && (
            <button
              onClick={removeSelected}
              disabled={removing === "batch"}
              className="text-xs text-red-400 hover:text-red-300 transition-colors disabled:opacity-40"
            >
              {removing === "batch"
                ? "Retrait…"
                : `Retirer ${selected.size} image${selected.size > 1 ? "s" : ""}`}
            </button>
          )}
          <button
            onClick={() => {
              setSelectMode((v) => !v);
              setSelected(new Set());
            }}
            className="text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors"
          >
            {selectMode ? "Annuler" : "Sélectionner"}
          </button>
        </div>
      </div>

      {/* Masonry grid */}
      <div className="columns-2 sm:columns-3 lg:columns-4 xl:columns-5 gap-3 space-y-3">
        {items.map(({ inspiration }) => {
          const img = inspiration.images[0];
          const category = inspiration.categories[0]?.category.name;
          const tags = inspiration.tags.map((t) => t.tag.name);

          return (
            <div key={inspiration.id} className="break-inside-avoid relative group">
              <InspirationCard
                id={inspiration.id}
                title={inspiration.title}
                thumbnailKey={img?.thumbnailKey ?? null}
                blurHash={img?.blurHash ?? null}
                width={img?.width ?? null}
                height={img?.height ?? null}
                category={category}
                tags={tags}
                year={inspiration.year}
                selectable={selectMode}
                selected={selected.has(inspiration.id)}
                onSelect={selectMode ? toggleSelect : undefined}
              />

              {/* Bouton retirer (hors mode sélection) */}
              {!selectMode && (
                <button
                  onClick={() => removeOne(inspiration.id)}
                  disabled={removing === inspiration.id}
                  className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/60 text-white text-[10px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/80 disabled:opacity-40 z-10"
                  title="Retirer de la collection"
                >
                  {removing === inspiration.id ? "…" : "✕"}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
