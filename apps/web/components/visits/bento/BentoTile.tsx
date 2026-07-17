"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Maximize2, MoreHorizontal, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { DragHandle } from "@/components/ui/DragHandle";
import { spanClass, tileKey } from "@/lib/visits/bentoSpans";
import { TileContent } from "@/components/visits/bento/TileContent";
import type { SortableGrid } from "@/hooks/useSortableGrid";
import type { BentoTile as BentoTileData } from "@/lib/visits/bentoTypes";

interface BentoTileProps {
  tile: BentoTileData;
  editable: boolean;
  sortable?: SortableGrid;
  /** true si cette tuile est celle actuellement draguée — remplace son contenu par un placeholder vide (même esprit que le ghostBar existant). */
  isDragging?: boolean;
  onOpenEdit?: () => void;
  onResize?: () => void;
  onDelete?: () => void;
  onPersistAudioTranscript?: (audioId: string, transcript: string) => Promise<void>;
}

// "Widget Wrapper" (spec §3.1) — chrome commun à toute tuile : coins
// arrondis, hover public (translateY + scale), drag (édition), poignée de
// resize qui cycle les formats, menu ⋯ (supprimer). Le contenu réel est
// délégué à TileContent, identique en édition et en lecture seule.
export function BentoTile({ tile, editable, sortable, isDragging, onOpenEdit, onResize, onDelete, onPersistAudioTranscript }: BentoTileProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const key = tileKey(tile);
  const sortableProps = editable && sortable ? sortable.getContainerProps(key) : {};
  // Le mémo audio édite déjà son transcript via son propre crayon inline
  // (AudioBlockCard) — pas besoin/pas de sens d'ouvrir le drawer dessus.
  const clickOpensDrawer = editable && tile.type !== "audio";

  return (
    <motion.div
      layout
      {...sortableProps}
      className={cn(
        spanClass(tile.w, tile.h),
        "group/tile relative rounded-[20px] overflow-hidden",
        editable ? "cursor-grab active:cursor-grabbing" : "transition-transform duration-300 ease-out hover:-translate-y-0.5 hover:scale-[1.02]"
      )}
      onClick={() => {
        if (!clickOpensDrawer) return;
        if (sortable?.wasDragging()) return;
        onOpenEdit?.();
      }}
    >
      {isDragging ? (
        <div className="w-full h-full rounded-[20px] border-2 border-dashed border-[var(--border-default)] bg-[var(--bg-surface)]/60" />
      ) : (
        <TileContent tile={tile} editable={editable} onPersistAudioTranscript={onPersistAudioTranscript} />
      )}

      {editable && !isDragging && (
        <>
          {/* opacity-0 + group-hover ne se déclenche jamais au tactile (pas de
              survol) — pointer-coarse:opacity-100 garde ces contrôles
              TOUJOURS visibles sur mobile/tablette, hover-révélés seulement à
              la souris (bug constaté 2026-07-17 : poignées invisibles et donc
              inutilisables sur téléphone). */}
          <div
            className="absolute top-2 right-2 z-20 opacity-0 group-hover/tile:opacity-100 pointer-coarse:opacity-100 transition-opacity"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              className="w-7 h-7 rounded-full bg-black/55 text-white/90 flex items-center justify-center"
              title="Options"
            >
              <MoreHorizontal size={14} strokeWidth={2} />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full mt-1 w-40 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-default)] shadow-xl overflow-hidden">
                <button
                  onClick={() => { setMenuOpen(false); onDelete?.(); }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-red-400 hover:bg-[var(--bg-surface)] transition-colors"
                >
                  <Trash2 size={13} strokeWidth={1.75} /> Supprimer
                </button>
              </div>
            )}
          </div>

          {/* Poignée de resize — cycle WIDGET_SPANS[type] au clic (spec §2.2 :
              jamais de dimension libre). */}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onResize?.(); }}
            className="absolute bottom-2 right-2 z-20 w-7 h-7 rounded-md bg-black/55 text-white/80 flex items-center justify-center opacity-0 group-hover/tile:opacity-100 pointer-coarse:opacity-100 transition-opacity"
            title="Changer le format"
          >
            <Maximize2 size={13} strokeWidth={2} />
          </button>

          {/* DragHandle est déjà `hidden pointer-coarse:flex` en soi (réservée
              au tactile — la souris saisit le corps de la carte n'importe où,
              voir useSortableGrid) : pas de hover à ajouter par-dessus, sinon
              elle resterait invisible sur mobile pour la même raison que
              ci-dessus. */}
          <DragHandle {...sortable!.getHandleProps(key)} className="absolute bottom-2 left-2 z-20" title="Glisser pour réordonner" />
        </>
      )}
    </motion.div>
  );
}
