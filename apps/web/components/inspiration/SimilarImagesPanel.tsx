"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Images } from "lucide-react";
import { getThumbnailUrl } from "@/lib/storage/urls";

interface SimilarItem {
  id: string;
  title: string;
  thumbnailKey: string | null;
  width: number | null;
  height: number | null;
  similarity: number;
}

// Panneau "images proches" — lecture seule, seuil large (proximité
// stylistique, pas quasi-identité), distinct de la détection stricte de
// doublons (voir DuplicateBadge). Jamais d'action possible ici : juste de la
// découverte.
export function SimilarImagesPanel({ id }: { id: string }) {
  const [items, setItems] = useState<SimilarItem[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/inspirations/${id}/similar`)
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((data) => { if (!cancelled) setItems(data.items ?? []); })
      .catch(() => { if (!cancelled) setItems([]); });
    return () => { cancelled = true; };
  }, [id]);

  if (!items || items.length === 0) return null;

  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Images size={14} strokeWidth={2} className="text-[var(--text-secondary)] shrink-0" />
        <span className="text-xs font-medium text-[var(--text-primary)]">Images proches</span>
      </div>
      <div className="flex gap-1.5 overflow-x-auto pb-0.5">
        {items.map((item) => (
          <Link
            key={item.id}
            href={`/library/${item.id}`}
            title={item.title}
            className="relative shrink-0 w-14 h-14 rounded-md overflow-hidden bg-[var(--bg-elevated)]"
          >
            {item.thumbnailKey ? (
              <img
                src={getThumbnailUrl(item.thumbnailKey)}
                alt={item.title}
                className="absolute inset-0 w-full h-full object-cover"
              />
            ) : null}
          </Link>
        ))}
      </div>
    </div>
  );
}
