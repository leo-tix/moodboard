"use client";

import { cn } from "@/lib/utils";
import { WIDGET_SPANS, spanLabel, type JournalTileType, type TileSpan } from "@/lib/visits/bentoSpans";

interface FormatPickerProps {
  type: JournalTileType;
  current: TileSpan;
  onChange: (span: TileSpan) => void;
}

// Choix explicite du format d'une tuile — remplace l'ancienne poignée de
// redimensionnement qui cyclait à l'aveugle sur une liste jamais montrée
// (retour utilisateur 2026-07-17 : "comment sélectionner format de la
// tuile ?"). Chaque format est dessiné à l'échelle, celui en cours est mis en
// évidence : on voit d'un coup d'œil ce qui est disponible pour CE type de
// bloc (WIDGET_SPANS varie par type — une vidéo n'a pas de format carré).
export function FormatPicker({ type, current, onChange }: FormatPickerProps) {
  const spans = WIDGET_SPANS[type];
  if (spans.length < 2) return null;

  return (
    <div className="space-y-1.5">
      <span className="text-[11px] text-[var(--text-tertiary)] uppercase tracking-wide">Format</span>
      <div className="flex items-center gap-2">
        {spans.map((s) => {
          const active = s.w === current.w && s.h === current.h;
          return (
            <button
              key={`${s.w}x${s.h}`}
              type="button"
              onClick={() => onChange(s)}
              title={spanLabel(s.w, s.h)}
              aria-pressed={active}
              className={cn(
                "flex flex-col items-center gap-1.5 px-2 py-2 rounded-lg border transition-colors",
                active
                  ? "border-[var(--text-primary)] bg-[var(--bg-surface)]"
                  : "border-[var(--border-subtle)] hover:border-[var(--text-tertiary)]"
              )}
            >
              {/* Aperçu à l'échelle du format (base 14px par unité) */}
              <span
                className={cn("block rounded-[3px]", active ? "bg-[var(--text-primary)]" : "bg-[var(--text-tertiary)]")}
                style={{ width: s.w * 14, height: s.h * 14 }}
              />
              <span className={cn("text-[10px]", active ? "text-[var(--text-primary)]" : "text-[var(--text-tertiary)]")}>
                {spanLabel(s.w, s.h)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
