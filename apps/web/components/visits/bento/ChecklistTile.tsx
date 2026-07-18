"use client";

import { CheckCircle2, Circle, ListChecks } from "lucide-react";
import { cn } from "@/lib/utils";
import type { JournalTileContent } from "@/lib/visits/bentoTypes";

type ChecklistContent = Extract<JournalTileContent, { type: "checklist" }>;

// Tuile checklist interactive — « œuvres à revoir », « expos à voir »…
// Auto-hauteur : la tuile s'étend pour afficher tous les items. Cocher une
// case bascule l'état immédiatement (onToggle) sans ouvrir le pop-up ; le
// reste du corps ouvre l'édition (via le clic corps de BentoTile).
export function ChecklistTile({
  content,
  editable,
  onToggle,
}: {
  content: ChecklistContent;
  editable: boolean;
  onToggle?: (itemId: string) => void;
}) {
  const done = content.items.filter((i) => i.done).length;
  const total = content.items.length;

  return (
    <div className="w-full px-4 py-3">
      <div className="flex items-center gap-2 mb-2">
        <ListChecks size={15} strokeWidth={2} className="text-[var(--accent)] flex-shrink-0" />
        <p className="text-sm font-medium text-[var(--text-primary)] truncate flex-1">
          {content.title || "Checklist"}
        </p>
        {total > 0 && (
          <span className="text-[11px] text-[var(--text-tertiary)] tabular-nums flex-shrink-0">
            {done}/{total}
          </span>
        )}
      </div>

      {total === 0 ? (
        <p className="text-xs text-[var(--text-tertiary)] italic">Liste vide — appuie pour ajouter des éléments</p>
      ) : (
        <ul className="space-y-1.5">
          {content.items.map((item) => (
            <li key={item.id} className="flex items-start gap-2">
              <button
                type="button"
                disabled={!editable}
                onClick={(e) => { e.stopPropagation(); onToggle?.(item.id); }}
                className={cn("mt-0.5 flex-shrink-0 transition-colors", editable && "cursor-pointer")}
                aria-label={item.done ? "Décocher" : "Cocher"}
              >
                {item.done ? (
                  <CheckCircle2 size={16} strokeWidth={2} className="text-[var(--accent)]" />
                ) : (
                  <Circle size={16} strokeWidth={2} className="text-[var(--text-tertiary)]" />
                )}
              </button>
              <span
                className={cn(
                  "text-sm leading-snug break-words",
                  item.done ? "text-[var(--text-tertiary)] line-through" : "text-[var(--text-secondary)]"
                )}
              >
                {item.text || "…"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
