"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { InspirationCard } from "@/components/inspiration/InspirationCard";
import { getThumbnailUrl } from "@/lib/storage/urls";
import type { SuggestedAddition } from "@/lib/collections/suggestions";

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
  suggestions: SuggestedAddition[];
}

export function CollectionDetailClient({
  collectionId,
  initialItems,
  suggestions: initialSuggestions,
}: CollectionDetailClientProps) {
  const [items, setItems] = useState(initialItems);
  const [removing, setRemoving] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [suggestions, setSuggestions] = useState(initialSuggestions);
  const [adding, setAdding] = useState<string | null>(null);

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

  const addSuggestion = async (suggestion: SuggestedAddition) => {
    setAdding(suggestion.id);
    try {
      await fetch(`/api/collections/${collectionId}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inspirationIds: [suggestion.id] }),
      });
      // Retirer de la liste des suggestions
      setSuggestions((prev) => prev.filter((s) => s.id !== suggestion.id));
      // Ajouter aux items localement
      setItems((prev) => [
        ...prev,
        {
          inspiration: {
            id: suggestion.id,
            title: suggestion.title,
            year: suggestion.year,
            images: [
              {
                thumbnailKey: suggestion.thumbnailKey,
                blurHash: suggestion.blurHash,
                width: suggestion.width,
                height: suggestion.height,
              },
            ],
            categories: [],
            tags: [],
          },
        },
      ]);
    } finally {
      setAdding(null);
    }
  };

  const dismissSuggestion = (id: string) => {
    setSuggestions((prev) => prev.filter((s) => s.id !== id));
  };

  return (
    <div className="space-y-10">
      {/* ── Collection items ── */}
      <div>
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <p className="text-[var(--text-tertiary)] text-sm">Cette collection est vide.</p>
            <p className="text-[var(--text-tertiary)] text-xs mt-1">
              Ajoutez des images depuis la bibliothèque ou via les suggestions ci-dessous.
            </p>
          </div>
        ) : (
          <>
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
          </>
        )}
      </div>

      {/* ── Suggestions d'ajout ── */}
      {suggestions.length > 0 && (
        <div>
          <div className="flex items-baseline gap-3 mb-4">
            <h2 className="text-sm font-medium text-[var(--text-primary)]">
              Suggestions d&apos;ajout
            </h2>
            <p className="text-[10px] text-[var(--text-tertiary)]">
              Images partageant les mêmes tags ou catégories
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
            {suggestions.map((s) => {
              const isAdding = adding === s.id;
              return (
                <div key={s.id} className="group relative">
                  {/* Thumbnail */}
                  <div className="aspect-square rounded-md overflow-hidden bg-[var(--bg-surface)] mb-1.5 relative">
                    {s.thumbnailKey ? (
                      <Image
                        src={getThumbnailUrl(s.thumbnailKey)}
                        alt={s.title}
                        fill
                        className="object-cover"
                        sizes="20vw"
                      />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-[var(--text-tertiary)] text-xs">—</span>
                      </div>
                    )}
                    {/* Overlay */}
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
                    {/* Dismiss */}
                    <button
                      onClick={() => dismissSuggestion(s.id)}
                      className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/50 text-white/70 text-[9px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/70 z-10"
                      title="Ignorer"
                    >
                      ✕
                    </button>
                  </div>

                  {/* Infos */}
                  <Link
                    href={`/library/${s.id}`}
                    className="block text-[10px] font-medium text-[var(--text-primary)] leading-tight line-clamp-1 hover:underline mb-0.5"
                  >
                    {s.title}
                  </Link>
                  <p className="text-[9px] text-[var(--text-tertiary)] mb-1.5">
                    {s.matchReason}
                  </p>

                  {/* Bouton ajouter */}
                  <button
                    onClick={() => addSuggestion(s)}
                    disabled={isAdding}
                    className="text-[9px] text-[var(--accent,#a78bfa)] hover:opacity-80 transition-opacity disabled:opacity-40"
                  >
                    {isAdding ? "Ajout…" : "+ Ajouter"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
