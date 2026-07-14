"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ChevronLeft } from "lucide-react";

// Barre d'actions ancrée EN HAUT de la page de visite (sticky) : le bouton
// Retour et le bouton Partager restent accessibles pendant tout le défilement
// du carnet, sans devoir remonter à la cover. Transparente par-dessus la cover
// (les pastilles opaques restent lisibles sur la photo), elle prend un fond
// dépoli dès qu'on scrolle — façon barre de navigation iOS sur un hero.
export function VisitTopBar({ backHref, children }: { backHref: string; children?: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    // Le conteneur défilant est le <main> du layout applicatif (voir
    // app/(app)/layout.tsx) — pas la fenêtre.
    const scroller = ref.current?.closest("main");
    const target: HTMLElement | Window = scroller ?? window;
    const read = () => {
      const y = scroller ? scroller.scrollTop : window.scrollY;
      setScrolled(y > 24);
    };
    read();
    target.addEventListener("scroll", read, { passive: true });
    return () => target.removeEventListener("scroll", read);
  }, []);

  return (
    <div
      ref={ref}
      className="sticky top-0 z-40 -mx-4 md:-mx-6 -mt-4 md:-mt-6 h-14 px-4 md:px-6 flex items-center justify-between gap-3"
      // Fond dépoli piloté en style inline (color-mix + backdrop-filter) :
      // les utilitaires Tailwind v4 à valeur arbitraire + opacité
      // (bg-[var(--x)]/80) ne génèrent pas de couleur fiable. NB : PAS de
      // `transition-colors` ici — Chromium échoue à interpoler vers une valeur
      // color-mix() posée via CSSOM et laisse le fond transparent.
      style={
        scrolled
          ? {
              backgroundColor: "color-mix(in srgb, var(--bg-base) 82%, transparent)",
              backdropFilter: "blur(12px)",
              WebkitBackdropFilter: "blur(12px)",
              borderBottom: "1px solid var(--border-subtle)",
            }
          : { borderBottom: "1px solid transparent" }
      }
    >
      <Link
        href={backHref}
        className="flex items-center gap-1 rounded-full pl-2 pr-3 py-1.5 text-xs bg-[var(--bg-elevated)] border border-[var(--border-default)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
        title="Retour au carnet de visite"
      >
        <ChevronLeft size={14} strokeWidth={2} /> Retour
      </Link>
      {children}
    </div>
  );
}
