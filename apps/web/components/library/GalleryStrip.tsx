"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { getThumbnailUrl } from "@/lib/storage/urls";

export interface StripItem {
  id: string;
  title: string;
  thumbnailKey: string | null;
}

interface GalleryStripProps {
  currentId: string;
  items: StripItem[];
  onFallback: (items: StripItem[]) => void;
  /** Le parent a fini de vérifier sessionStorage pour un contexte scoped
   *  (résultats de recherche, collection, visite…). Tant que c'est faux, on
   *  n'a pas encore la réponse — ne PAS déclencher le repli "toute la
   *  bibliothèque" prématurément (voir DetailPageClient.tsx pour le détail
   *  de la course évitée : cet effet, enfant, s'exécute avant celui du
   *  parent qui lit sessionStorage). */
  navContextChecked: boolean;
}

export function GalleryStrip({ currentId, items, onFallback, navContextChecked }: GalleryStripProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Fallback: fetch from API only once on sait qu'il n'y a vraiment aucun
  // contexte scoped (pas juste "pas encore vérifié").
  useEffect(() => {
    if (items.length > 0 || !navContextChecked) return;
    fetch("/api/library/strip")
      .then((r) => r.json())
      .then((data) => onFallback(data.items ?? []))
      .catch(() => {});
  }, [items.length, navContextChecked, onFallback]);

  // Center active thumbnail instantly in the strip
  useEffect(() => {
    const container = scrollRef.current;
    if (!container || items.length === 0) return;
    const el = container.querySelector<HTMLElement>(`[data-strip-id="${currentId}"]`);
    if (!el) return;
    container.scrollLeft = el.offsetLeft - container.clientWidth / 2 + el.offsetWidth / 2;
  }, [currentId, items]);

  if (items.length === 0) {
    // Show a subtle loading skeleton while fetching
    return (
      <div className="flex-shrink-0 h-[72px] border-t border-[var(--border-subtle)] bg-[var(--bg-base)] flex items-center px-3 gap-1.5 overflow-hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="flex-shrink-0 w-14 h-14 rounded bg-[var(--bg-surface)] animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex-shrink-0 border-t border-[var(--border-subtle)] bg-[var(--bg-base)]"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
      <div ref={scrollRef} className="flex overflow-x-auto scrollbar-none py-2 px-3 gap-1.5 items-center">
        {items.map((item) => {
          const isActive = item.id === currentId;
          return (
            <Link
              key={item.id}
              href={`/library/${item.id}`}
              replace
              data-strip-id={item.id}
              title={item.title}
              className={`
                flex-shrink-0 w-14 h-14 rounded relative overflow-hidden transition-all duration-150
                ${isActive
                  ? "ring-2 ring-[var(--accent,#a78bfa)] ring-offset-1 ring-offset-[var(--bg-base)] opacity-100"
                  : "opacity-40 hover:opacity-80"}
              `}
            >
              {item.thumbnailKey ? (
                <img
                  src={getThumbnailUrl(item.thumbnailKey)}
                  alt={item.title}
                  loading="lazy"
                  className="absolute inset-0 w-full h-full object-cover"
                />
              ) : (
                <div className="absolute inset-0 bg-[var(--bg-elevated)]" />
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
