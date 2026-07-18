"use client";

import { Star, Heart } from "lucide-react";
import { cn } from "@/lib/utils";
import type { JournalTileContent } from "@/lib/visits/bentoTypes";

type HighlightContent = Extract<JournalTileContent, { type: "highlight" }>;

// Tuile « coup de cœur » — met en avant une œuvre favorite : titre + note
// d'étoiles + commentaire libre. Accent chaleureux (dégradé ambré discret)
// pour la distinguer d'une simple note. S'adapte aux 4 formats bento.
export function HighlightTile({ content, w, h }: { content: HighlightContent; w: number; h: number }) {
  const big = w === 2 && h === 2;
  const compact = w === 1 && h === 1;
  const starSize = big ? 20 : compact ? 14 : 16;

  return (
    <div
      className={cn(
        "w-full h-full flex flex-col bg-[var(--bg-elevated)] relative overflow-hidden",
        compact ? "p-3 justify-center gap-1.5" : "p-4 justify-center gap-2"
      )}
    >
      {/* Halo ambré d'ambiance (coup de cœur) */}
      <div
        className="pointer-events-none absolute -top-8 -right-8 w-32 h-32 rounded-full opacity-[0.14]"
        style={{ background: "radial-gradient(circle, #f5a623 0%, transparent 70%)" }}
      />

      <Heart
        size={compact ? 14 : 16}
        strokeWidth={2}
        className="text-[#f5a623] flex-shrink-0 fill-[#f5a623]/25"
      />

      {content.title && (
        <p
          className={cn(
            "font-serif text-[var(--text-primary)] leading-tight break-words",
            big ? "text-2xl" : compact ? "text-sm line-clamp-2" : "text-lg line-clamp-2"
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

      {content.note && !compact && (
        <p className={cn("text-[var(--text-secondary)] leading-snug break-words", big ? "text-sm line-clamp-6" : "text-xs line-clamp-3")}>
          {content.note}
        </p>
      )}

      {!content.title && content.rating === 0 && !content.note && (
        <p className="text-xs text-[var(--text-tertiary)] italic">Coup de cœur — appuie pour éditer</p>
      )}
    </div>
  );
}
