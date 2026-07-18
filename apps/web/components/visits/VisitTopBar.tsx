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
    <>
    <div
      ref={ref}
      // Mobile → `fixed` (relatif au viewport), PAS `sticky` : sur iOS toutes
      // les apps (dont Chrome) tournent sous WebKit, où `position: sticky` dans
      // un conteneur `overflow:auto` imbriqué (ici le <main> défilant) DÉCROCHE
      // pendant le rebond élastique tout en bas — la barre disparaissait
      // "arrivé en bas" (retour utilisateur 2026-07-18, non reproductible sur
      // l'émulateur Chromium car c'est un bug spécifique WebKit). `fixed` ne
      // dépend d'aucun conteneur défilant → fiable partout. Un intercalaire
      // (plus bas) réserve les 56px sur mobile. Desktop → on garde `sticky` :
      // il fonctionne, et un `fixed` pleine largeur chevaucherait la sidebar.
      className="fixed inset-x-0 top-0 md:sticky md:inset-x-auto md:top-0 md:-mx-6 md:-mt-6 z-40 h-14 px-4 md:px-6 flex items-center justify-between gap-3"
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
    {/* Intercalaire mobile : la barre étant `fixed` (hors flux) sur mobile, on
        réserve sa hauteur ici pour que la cover/carte ne passent pas dessous.
        Masqué en desktop où la barre `sticky` réserve déjà sa place. */}
    <div className="h-14 md:hidden" aria-hidden />
    </>
  );
}
