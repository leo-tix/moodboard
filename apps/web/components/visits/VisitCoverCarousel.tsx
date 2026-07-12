"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { getImageUrl } from "@/lib/storage/urls";

export interface CoverImage {
  id: string;
  storageKey: string;
  width: number | null;
  height: number | null;
}

// Couverture façon Apple Journal : bandeau plein-large en tête de visite,
// les images de la visite défilent en carrousel (au lieu d'un simple titre
// statique). Pleine résolution (getImageUrl, pas thumbnail) car c'est la
// pièce hero de la page. `backHref` : bouton retour rond flottant sur la
// cover (façon Journal) — remplace le lien texte sous la cover.
export function VisitCoverCarousel({ images, backHref }: { images: CoverImage[]; backHref?: string }) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || images.length <= 1) return;
    const onScroll = () => {
      const index = Math.round(scroller.scrollLeft / scroller.clientWidth);
      setActiveIndex(Math.min(images.length - 1, Math.max(0, index)));
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", onScroll);
  }, [images.length]);

  if (images.length === 0) return null;

  return (
    <div className="relative -mx-4 md:-mx-6 -mt-4 md:-mt-6 mb-5 h-[38vh] md:h-[46vh] overflow-hidden">
      <div
        ref={scrollerRef}
        className="h-full w-full flex overflow-x-auto snap-x snap-mandatory scroll-smooth"
        style={{ scrollbarWidth: "none" }}
      >
        {images.map((img) => (
          <div key={img.id} className="h-full w-full flex-shrink-0 snap-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={getImageUrl(img.storageKey)}
              alt=""
              loading={img.id === images[0].id ? "eager" : "lazy"}
              className="h-full w-full object-cover"
            />
          </div>
        ))}
      </div>

      {/* Retour flottant façon Journal — visible sans scroller, par-dessus la photo */}
      {backHref && (
        <Link
          href={backHref}
          className="absolute top-3 left-3 md:top-4 md:left-4 z-10 w-9 h-9 flex items-center justify-center rounded-full bg-black/50 backdrop-blur-sm text-white/90 hover:bg-black/70 transition-colors"
          title="Retour au carnet de visite"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </Link>
      )}

      {/* Dégradé de lisibilité + points de pagination */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/70 to-transparent" />
      {images.length > 1 && (
        <div className="absolute bottom-3 inset-x-0 flex items-center justify-center gap-1.5">
          {images.map((img, i) => (
            <span
              key={img.id}
              className={cn(
                "h-1.5 rounded-full transition-all",
                i === activeIndex ? "w-4 bg-white" : "w-1.5 bg-white/40"
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
}
