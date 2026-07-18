"use client";

import { Palette } from "lucide-react";
import { getThumbnailUrl } from "@/lib/storage/urls";
import type { JournalTileContent } from "@/lib/visits/bentoTypes";

type PaletteContent = Extract<JournalTileContent, { type: "palette" }>;

// Tuile « palette » — les couleurs dominantes extraites d'une œuvre, en bandes.
// La vignette source (optionnelle) illustre d'où viennent les teintes. Les
// codes hex s'affichent dès qu'il y a la place (format ≥ 2 lignes).
export function PaletteTile({ content, w, h }: { content: PaletteContent; w: number; h: number }) {
  const compact = w === 1 && h === 1;
  const showHex = h === 2; // assez de hauteur pour les libellés
  const colors = content.colors.length ? content.colors : ["#2a2a2a", "#3a3a3a", "#4a4a4a"];
  const empty = content.colors.length === 0;

  return (
    <div className="w-full h-full flex flex-col bg-[var(--bg-elevated)]">
      {/* En-tête : titre + éventuelle vignette source */}
      {!compact && (
        <div className="flex items-center gap-2 px-3 pt-2.5 pb-1.5">
          <Palette size={14} strokeWidth={2} className="text-[var(--accent)] flex-shrink-0" />
          <p className="text-xs font-medium text-[var(--text-primary)] truncate flex-1">{content.title || "Palette"}</p>
          {content.sourceKey && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={getThumbnailUrl(content.sourceKey)} alt="" className="w-7 h-7 rounded object-cover border border-[var(--border-subtle)] flex-shrink-0" />
          )}
        </div>
      )}

      {/* Bandes de couleur */}
      <div className="flex-1 flex min-h-0">
        {colors.map((c, i) => (
          <div key={i} className="flex-1 relative flex items-end justify-center" style={{ backgroundColor: c }}>
            {showHex && !empty && (
              <span
                className="mb-1.5 text-[8px] font-mono px-1 py-0.5 rounded uppercase tracking-tight"
                style={{ color: readableOn(c), backgroundColor: "rgba(0,0,0,0.14)" }}
              >
                {c.replace("#", "")}
              </span>
            )}
          </div>
        ))}
      </div>

      {empty && (
        <p className="text-[10px] text-[var(--text-tertiary)] italic px-3 py-1.5">Appuie pour extraire une palette d&apos;une photo</p>
      )}
    </div>
  );
}

// Noir ou blanc selon la luminance du fond (lisibilité du code hex).
function readableOn(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? "#000" : "#fff";
}
