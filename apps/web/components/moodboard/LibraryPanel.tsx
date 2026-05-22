"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import { getThumbnailUrl } from "@/lib/storage/urls";

interface LibraryItem {
  id: string;
  title: string;
  storageKey: string | null;
  thumbnailKey: string | null;
  width: number | null;
  height: number | null;
  isAnimated?: boolean;
}

interface Props {
  onAdd: (item: {
    inspirationId: string;
    storageKey: string;
    title: string;
    width?: number | null;
    height?: number | null;
    isAnimated?: boolean;
  }) => void;
}

export function LibraryPanel({ onAdd }: Props) {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

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

  return (
    <div className="flex flex-col h-full">
      <div className="flex-shrink-0 px-3 py-2.5 border-b border-[var(--border-subtle)]">
        <p className="text-xs font-medium text-[var(--text-secondary)] mb-2">Bibliothèque</p>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher…"
          className="w-full text-xs bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded px-2 py-1.5 text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none focus:border-[var(--border-default)]"
        />
      </div>

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
                      storageKey: item.storageKey,
                      title: item.title,
                      width: item.width,
                      height: item.height,
                      isAnimated: item.isAnimated ?? false,
                    })
                  );
                }}
                onClick={() =>
                  item.storageKey &&
                  onAdd({
                    inspirationId: item.id,
                    storageKey: item.storageKey,
                    title: item.title,
                    width: item.width,
                    height: item.height,
                    isAnimated: item.isAnimated ?? false,
                  })
                }
                className="relative aspect-video rounded overflow-hidden bg-[var(--bg-surface)] hover:ring-2 hover:ring-[var(--accent,#a78bfa)] transition-all group cursor-grab active:cursor-grabbing"
                title={`${item.title} — glisser ou cliquer pour ajouter`}
              >
                {item.thumbnailKey ? (
                  item.isAnimated ? (
                    <img
                      src={getThumbnailUrl(item.thumbnailKey)}
                      alt={item.title}
                      className="absolute inset-0 w-full h-full object-cover"
                    />
                  ) : (
                    <Image
                      src={getThumbnailUrl(item.thumbnailKey)}
                      alt={item.title}
                      fill
                      className="object-cover"
                      sizes="120px"
                    />
                  )
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
    </div>
  );
}
