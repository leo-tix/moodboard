"use client";

import { Ticket } from "lucide-react";
import { cn } from "@/lib/utils";
import { getThumbnailUrl } from "@/lib/storage/urls";
import type { JournalTileContent } from "@/lib/visits/bentoTypes";

type TicketContent = Extract<JournalTileContent, { type: "ticket" }>;

// Tuile « billet » — souvenir d'entrée façon ticket à souche : une partie
// principale (événement / lieu / date) et une souche détachée par une
// perforation (prix / catégorie). Photo du billet optionnelle en fond discret.
export function TicketTile({ content, w, h }: { content: TicketContent; w: number; h: number }) {
  const horizontal = w === 2 && h === 1;
  const compact = w === 1 && h === 1;
  const hasPhoto = !!content.thumbnailKey;

  const stub = (content.price || content.category) && (
    <div className={cn("flex flex-col items-center justify-center gap-0.5 flex-shrink-0", horizontal ? "px-3" : "px-2 py-1")}>
      {content.price && <p className="font-serif text-[var(--text-primary)] text-base leading-none">{content.price}</p>}
      {content.category && <p className="text-[9px] uppercase tracking-widest text-[var(--text-tertiary)] text-center">{content.category}</p>}
    </div>
  );

  const main = (
    <div className={cn("min-w-0 flex-1 flex flex-col justify-center", compact ? "p-2.5 gap-0.5" : "p-3.5 gap-1")}>
      <div className="flex items-center gap-1.5">
        <Ticket size={compact ? 12 : 13} strokeWidth={2} className="text-[var(--accent)] flex-shrink-0" />
        <span className="text-[9px] uppercase tracking-widest text-[var(--text-tertiary)]">Billet</span>
      </div>
      <p className={cn("font-serif text-[var(--text-primary)] leading-tight break-words", compact ? "text-sm line-clamp-2" : "text-lg line-clamp-2")}>
        {content.eventName || "Entrée"}
      </p>
      {!compact && (content.place || content.dateText) && (
        <p className="text-[11px] text-[var(--text-secondary)] truncate">
          {[content.place, content.dateText].filter(Boolean).join(" · ")}
        </p>
      )}
      {compact && content.price && <p className="text-[11px] text-[var(--text-secondary)]">{content.price}</p>}
    </div>
  );

  return (
    <div className="w-full h-full relative overflow-hidden bg-[var(--bg-elevated)]">
      {/* Photo du billet en fond très discret (contexte visuel) */}
      {hasPhoto && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={getThumbnailUrl(content.thumbnailKey!)} alt="" className="absolute inset-0 w-full h-full object-cover opacity-25" />
          <div className="absolute inset-0 bg-[var(--bg-elevated)]/60" />
        </>
      )}
      {/* Halo accent */}
      <div className="pointer-events-none absolute -bottom-10 -left-10 w-32 h-32 rounded-full opacity-[0.10]" style={{ background: "radial-gradient(circle, var(--accent) 0%, transparent 70%)" }} />

      {/* Encoches latérales façon billet : deux demi-cercles « découpés » sur les
          bords gauche/droite (cercles couleur du fond, coupés par overflow-hidden). */}
      <span aria-hidden className="pointer-events-none absolute left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-[var(--bg-base)] z-20" />
      <span aria-hidden className="pointer-events-none absolute right-0 top-1/2 translate-x-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-[var(--bg-base)] z-20" />

      <div className={cn("relative w-full h-full flex", horizontal ? "flex-row items-stretch" : "flex-col")}>
        {main}
        {stub && !compact && (
          <>
            {/* Perforation : trait pointillé + encoches */}
            <div className={cn("relative flex-shrink-0", horizontal ? "border-l border-dashed border-[var(--border-strong)] my-3" : "border-t border-dashed border-[var(--border-strong)] mx-3")} />
            {stub}
          </>
        )}
      </div>
    </div>
  );
}
