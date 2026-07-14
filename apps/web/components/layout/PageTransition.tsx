"use client";

import { usePathname } from "next/navigation";

// Transition douce entre les pages : fondu d'entrée à chaque navigation.
//
// Implémentation en CSS pur (classe .page-fade-in-anim, keyframes dans
// globals.css), PAS en framer-motion : une animation CSS ne dépend pas de
// requestAnimationFrame, elle ne peut donc jamais laisser la page bloquée à
// opacity 0 si le rAF est throttlé (onglet en arrière-plan, appareil lent).
// L'état hors-animation est opacity:1 → la page est toujours visible, même
// au chargement à froid avant hydratation, et même si prefers-reduced-motion
// neutralise la durée (voir la garde @media dans globals.css).
//
// Clé = pathname : remonter ce div à chaque changement de route relance
// l'animation CSS. On n'utilise PAS les search params → pas de re-fondu à
// chaque changement de filtre/recherche (?q=…), seulement au vrai changement
// de page. Opacité seule : sans incidence sur le positionnement des éléments
// `fixed` descendants (FAB de capture, etc.).
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div key={pathname} className="page-fade-in-anim">
      {children}
    </div>
  );
}
