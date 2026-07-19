"use client";

import type { JournalTileContent } from "@/lib/visits/bentoTypes";

type CartelContent = Extract<JournalTileContent, { type: "cartel" }>;

// Tuile « cartel » — fiche descriptive d'une œuvre façon carton de musée.
// TEXTE UNIQUEMENT (la photo sert seulement à l'OCR, jamais conservée) et
// AUTO-HAUTEUR (2026-07-19) comme le module texte : la tuile s'étend pour
// afficher toute la description, sans troncature. Le fond est porté par
// BentoTile (régime auto-hauteur). Rendu en hauteur naturelle (pas de h-full).
export function CartelTile({ content }: { content: CartelContent }) {
  const meta = [content.dateText, content.medium, content.dimensions].filter(Boolean).join(" · ");

  return (
    <div className="w-full px-4 py-3.5 flex flex-col gap-1">
      {content.artist && (
        <p className="uppercase tracking-wide text-[10px] text-[var(--text-tertiary)] break-words">{content.artist}</p>
      )}
      <p className="font-serif text-lg text-[var(--text-primary)] leading-tight break-words">
        {content.artworkTitle || "Sans titre"}
      </p>
      {meta && <p className="text-[11px] text-[var(--text-secondary)] italic leading-snug break-words">{meta}</p>}
      {content.room && <p className="text-[10px] text-[var(--text-tertiary)] break-words">Salle · {content.room}</p>}
      {content.notes && (
        <p className="text-xs text-[var(--text-secondary)] leading-relaxed break-words whitespace-pre-wrap mt-1.5">{content.notes}</p>
      )}
    </div>
  );
}
