"use client";

import { cn } from "@/lib/utils";
import type { JournalTileContent } from "@/lib/visits/bentoTypes";

type CartelContent = Extract<JournalTileContent, { type: "cartel" }>;

// Tuile « cartel » — fiche descriptive d'une œuvre façon carton de musée.
// TEXTE UNIQUEMENT (2026-07-19) : la photo du cartel sert seulement à l'OCR et
// n'est jamais conservée ni affichée. Champs structurés adaptés aux 4 formats.
export function CartelTile({ content, w, h }: { content: CartelContent; w: number; h: number }) {
  const compact = w === 1 && h === 1;
  const tall = h === 2;
  const meta = [content.dateText, content.medium, content.dimensions].filter(Boolean).join(" · ");

  return (
    <div className={cn("w-full h-full bg-[var(--bg-elevated)] flex flex-col justify-center", compact ? "p-3 gap-0.5" : "p-4 gap-1")}>
      {content.artist && (
        <p className={cn("uppercase tracking-wide text-[var(--text-tertiary)] truncate", compact ? "text-[9px]" : "text-[10px]")}>
          {content.artist}
        </p>
      )}
      <p className={cn("font-serif text-[var(--text-primary)] leading-tight break-words", compact ? "text-sm line-clamp-3" : "text-lg line-clamp-3")}>
        {content.artworkTitle || "Sans titre"}
      </p>
      {!compact && meta && (
        <p className="text-[11px] text-[var(--text-secondary)] italic leading-snug break-words mt-0.5">{meta}</p>
      )}
      {!compact && content.room && (
        <p className="text-[10px] text-[var(--text-tertiary)] mt-1 truncate">Salle · {content.room}</p>
      )}
      {!compact && content.notes && tall && (
        <p className="text-xs text-[var(--text-secondary)] leading-snug break-words mt-1.5 line-clamp-5 whitespace-pre-wrap">{content.notes}</p>
      )}
    </div>
  );
}
