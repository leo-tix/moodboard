"use client";

import { Milestone } from "lucide-react";
import type { JournalTileContent } from "@/lib/visits/bentoTypes";

type TimelineContent = Extract<JournalTileContent, { type: "timeline" }>;

// Tuile frise / chronologie — sections d'un parcours d'expo ou périodes d'un
// artiste. Rendu en frise verticale : trait de liaison + puces, date + libellé
// (+ description). Auto-hauteur : s'étend pour afficher tous les jalons.
export function TimelineTile({ content }: { content: TimelineContent }) {
  return (
    <div className="w-full px-4 py-3">
      <div className="flex items-center gap-2 mb-3">
        <Milestone size={15} strokeWidth={2} className="text-[var(--accent)] flex-shrink-0" />
        <p className="text-sm font-medium text-[var(--text-primary)] truncate">
          {content.title || "Chronologie"}
        </p>
      </div>

      {content.events.length === 0 ? (
        <p className="text-xs text-[var(--text-tertiary)] italic">Frise vide — appuie pour ajouter des jalons</p>
      ) : (
        <ol className="relative">
          {/* trait vertical de liaison */}
          <span className="absolute left-[5px] top-1.5 bottom-1.5 w-px bg-[var(--border-default)]" aria-hidden />
          {content.events.map((ev) => (
            <li key={ev.id} className="relative pl-6 pb-3 last:pb-0">
              <span className="absolute left-0 top-1 w-[11px] h-[11px] rounded-full bg-[var(--accent)] ring-2 ring-[var(--bg-elevated)]" aria-hidden />
              {ev.dateText && (
                <p className="text-[11px] uppercase tracking-wide text-[var(--text-tertiary)] leading-tight">{ev.dateText}</p>
              )}
              <p className="text-sm text-[var(--text-primary)] leading-snug break-words">{ev.label || "…"}</p>
              {ev.description && (
                <p className="text-xs text-[var(--text-secondary)] leading-snug break-words mt-0.5">{ev.description}</p>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
