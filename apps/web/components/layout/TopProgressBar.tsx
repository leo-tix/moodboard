"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

// Barre de progression globale en haut de l'écran : elle apparaît DÈS le clic
// sur un lien interne (avant la réponse serveur) et disparaît quand la nouvelle
// route est rendue. Comble le « rien ne se passe » sur les pages dynamiques qui
// attendent le serveur avant de s'afficher. Couvre TOUS les liens (nav, cartes
// du feed, profils, messages…) sans avoir à les instrumenter un par un.
//
// Next 16 n'expose plus d'événements de routeur → on démarre via un écouteur de
// clic (phase capture) et on termine sur le changement de pathname/searchParams.
export function TopProgressBar() {
  const pathname = usePathname();
  const search = useSearchParams();
  const [active, setActive] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement | null)?.closest?.("a");
      if (!a) return;
      const href = a.getAttribute("href");
      const target = a.getAttribute("target");
      if (!href || target === "_blank" || a.hasAttribute("download")) return;
      let url: URL;
      try { url = new URL(href, location.href); } catch { return; }
      if (url.origin !== location.origin) return; // lien externe
      if (url.pathname === location.pathname && url.search === location.search) return; // même page
      setActive(true);
      // Filet de sécurité : si la navigation n'aboutit pas (clic intercepté,
      // ex. ouverture d'une modale), on masque la barre après un délai.
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setActive(false), 8000);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  // La route (chemin ou query) a changé → nouveau contenu prêt → on termine.
  useEffect(() => {
    setActive(false);
    if (timerRef.current) window.clearTimeout(timerRef.current);
  }, [pathname, search]);

  return <div aria-hidden className={cn("nav-progress", active && "nav-progress--active")} />;
}
