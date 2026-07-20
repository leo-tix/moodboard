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
// Clé = PREMIER segment du chemin (la « section » : /library, /moodboards, …),
// PAS le pathname complet. Ainsi le fondu se joue au changement de SECTION,
// mais PAS quand on passe d'un élément à l'autre au sein d'une section
// (/library/id1 → /library/id2, glissement photo) : sans ça, chaque navigation
// entre photos remontait ce div et refaisait un fondu depuis l'opacité 0 → une
// « frame noire » entre chaque glissement (retour utilisateur 2026-07-20).
// On n'utilise PAS les search params → pas de re-fondu à chaque filtre (?q=…).
// Opacité seule : sans incidence sur le positionnement des `fixed` descendants.
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const section = "/" + (pathname.split("/")[1] ?? "");
  return (
    <div key={section} className="page-fade-in-anim">
      {children}
    </div>
  );
}
