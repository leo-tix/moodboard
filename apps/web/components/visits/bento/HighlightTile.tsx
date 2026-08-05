"use client";

import { Star, Heart } from "lucide-react";
import { cn } from "@/lib/utils";
import type { JournalTileContent } from "@/lib/visits/bentoTypes";

type HighlightContent = Extract<JournalTileContent, { type: "highlight" }>;

// Tuile « coup de cœur » — met en avant une œuvre favorite : titre + note
// d'étoiles + commentaire libre. Accent chaleureux (dégradé ambré discret)
// pour la distinguer d'une simple note.
//
// HAUTEUR AUTOMATIQUE (cf. AUTO_HEIGHT_TYPES) : la tuile s'étend par paliers de
// grille pour afficher l'avis EN ENTIER. Elle doit donc se rendre à sa hauteur
// naturelle — pas de `h-full`, pas de `justify-center`, pas de `line-clamp` —
// sinon le texte est tronqué et la mesure est faussée (retour 2026-08-05).
// Seule la largeur (1 ou 2 colonnes) est choisie par l'utilisateur.
export function HighlightTile({ content, w }: { content: HighlightContent; w: number; h?: number }) {
  const big = w === 2;
  const starSize = big ? 18 : 15;

  return (
    <div
      className={cn(
        "w-full flex flex-col bg-[var(--bg-elevated)] relative overflow-hidden",
        big ? "px-4 py-3.5 gap-2" : "px-3 py-3 gap-1.5"
      )}
    >
      {/* Halo ambré d'ambiance (coup de cœur) */}
      <div
        className="pointer-events-none absolute -top-8 -right-8 w-32 h-32 rounded-full opacity-[0.14]"
        style={{ background: "radial-gradient(circle, #f5a623 0%, transparent 70%)" }}
      />

      <Heart
        size={big ? 16 : 14}
        strokeWidth={2}
        className="text-[#f5a623] flex-shrink-0 fill-[#f5a623]/25"
      />

      {content.title && (
        <p
          className={cn(
            "font-serif text-[var(--text-primary)] leading-tight break-words",
            big ? "text-xl" : "text-base"
          )}
        >
          {content.title}
        </p>
      )}

      {content.rating > 0 && (
        <div className="flex items-center gap-0.5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Star
              key={i}
              size={starSize}
              strokeWidth={1.75}
              className={i < content.rating ? "text-[#f5a623] fill-[#f5a623]" : "text-[var(--border-strong)]"}
            />
          ))}
        </div>
      )}

      {/* Avis affiché INTÉGRALEMENT (plus de line-clamp, plus de masquage en
          1 colonne) : la tuile grandit pour le contenir. `whitespace-pre-wrap`
          conserve les retours à la ligne saisis par l'utilisateur. */}
      {content.note && (
        <p className={cn("text-[var(--text-secondary)] leading-snug break-words whitespace-pre-wrap", big ? "text-sm" : "text-xs")}>
          {content.note}
        </p>
      )}

      {!content.title && content.rating === 0 && !content.note && (
        <p className="text-xs text-[var(--text-tertiary)] italic">Coup de cœur — appuie pour éditer</p>
      )}
    </div>
  );
}
