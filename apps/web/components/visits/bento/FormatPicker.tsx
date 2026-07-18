"use client";

import { cn } from "@/lib/utils";
import { formatOptions, type FormatOption, type JournalTileType, type TileWidth } from "@/lib/visits/bentoSpans";

// Petit schéma à l'échelle du format (largeur × hauteur) — bien plus lisible
// qu'une icône générique : on voit la FORME que prendra la tuile.
function FormatGlyph({ w, h, active, unit = 12 }: { w: 1 | 2; h: 1 | 2; active: boolean; unit?: number }) {
  return (
    <span
      className={cn("block rounded-[3px] transition-colors", active ? "bg-[var(--text-primary)]" : "bg-[var(--text-tertiary)]")}
      style={{ width: w * unit, height: h * unit }}
    />
  );
}

function sameFormat(a: FormatOption, w: number, h: number, textOnly: boolean): boolean {
  // Pour le texte, seule la largeur compte (la hauteur est automatique).
  return textOnly ? a.w === w : a.w === w && a.h === h;
}

interface FormatPickerProps {
  type: JournalTileType;
  w: number;
  h: number;
  onChange: (w: TileWidth, h: 1 | 2) => void;
}

// Sélecteur de format LABELLISÉ — utilisé dans le pop-up central (mobile,
// et desktop pour les réglages). Chaque format dessiné à l'échelle + nommé.
export function FormatPicker({ type, w, h, onChange }: FormatPickerProps) {
  const options = formatOptions(type);
  const textOnly = options.length === 2 && options.every((o) => o.h === 1);
  return (
    <div className="space-y-1.5">
      <span className="text-[11px] text-[var(--text-tertiary)] uppercase tracking-wide">Format</span>
      <div className="flex items-center gap-2">
        {options.map((o) => {
          const active = sameFormat(o, w, h, textOnly);
          return (
            <button
              key={o.label}
              type="button"
              onClick={() => onChange(o.w, o.h)}
              aria-pressed={active}
              title={o.label}
              className={cn(
                "flex flex-col items-center justify-center gap-1.5 flex-1 py-2.5 rounded-lg border transition-colors",
                active ? "border-[var(--text-primary)] bg-[var(--bg-surface)]" : "border-[var(--border-subtle)] hover:border-[var(--text-tertiary)]"
              )}
            >
              <span className="h-6 flex items-center justify-center">
                <FormatGlyph w={o.w} h={o.h} active={active} />
              </span>
              <span className={cn("text-[10px]", active ? "text-[var(--text-primary)]" : "text-[var(--text-tertiary)]")}>{o.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Rangée d'icônes compacte — apparaît AU SURVOL d'une tuile sur desktop, dans
// un coin. Clic = format appliqué directement, sans ouvrir le pop-up (demande
// utilisateur 2026-07-18).
export function FormatQuickBar({ type, w, h, onChange }: FormatPickerProps) {
  const options = formatOptions(type);
  const textOnly = options.length === 2 && options.every((o) => o.h === 1);
  return (
    <div className="flex items-center gap-0.5 rounded-lg bg-black/60 backdrop-blur-sm px-1 py-1">
      {options.map((o) => {
        const active = sameFormat(o, w, h, textOnly);
        return (
          <button
            key={o.label}
            type="button"
            onClick={(e) => { e.stopPropagation(); onChange(o.w, o.h); }}
            aria-pressed={active}
            title={o.label}
            className={cn(
              "w-7 h-7 rounded-md flex items-center justify-center transition-colors",
              active ? "bg-white/20" : "hover:bg-white/10"
            )}
          >
            <span
              className={cn("block rounded-[2px]", active ? "bg-white" : "bg-white/50")}
              style={{ width: o.w * 7, height: o.h * 7 }}
            />
          </button>
        );
      })}
    </div>
  );
}
