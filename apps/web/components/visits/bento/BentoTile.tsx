"use client";

import { motion } from "framer-motion";
import { SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { DragHandle } from "@/components/ui/DragHandle";
import { spanClass, tileKey } from "@/lib/visits/bentoSpans";
import { TileContent, type ImageNavItem } from "@/components/visits/bento/TileContent";
import type { SortableGrid } from "@/hooks/useSortableGrid";
import type { BentoTile as BentoTileData } from "@/lib/visits/bentoTypes";

interface BentoTileProps {
  tile: BentoTileData;
  editable: boolean;
  sortable?: SortableGrid;
  /** true si cette tuile est celle actuellement draguée — remplace son contenu par un placeholder vide (même esprit que le ghostBar de l'ancien carnet). */
  isDragging?: boolean;
  /** true si son panneau d'édition est ouvert — surcouche de sélection (spec §3.1). */
  selected?: boolean;
  onOpenEdit?: () => void;
  onPersistAudioTranscript?: (audioId: string, transcript: string) => Promise<void>;
  /** Images du carnet, transmis à TileContent pour le parcours ←/→ de la visionneuse. */
  imageNav?: ImageNavItem[];
}

// Le clic sur le CORPS de la tuile déclenche l'action naturelle du contenu
// (ouvrir l'image en grand, suivre le lien, jouer le mémo…). Les types sans
// action propre ouvrent directement le panneau d'édition — sinon un bloc de
// texte ne réagirait à aucun clic. Réglages/format/suppression passent
// TOUJOURS par le bouton dédié, quel que soit le type (audit 2026-07-17).
const BODY_OPENS_EDIT = new Set<BentoTileData["type"]>(["note", "title", "quote", "map"]);

// "Widget Wrapper" (spec §3.1) — chrome commun à toute tuile : coins
// arrondis, hover public (translateY + scale), drag, bouton "Modifier".
// Le contenu réel est délégué à TileContent, identique en édition et en
// lecture seule.
export function BentoTile({ tile, editable, sortable, isDragging, selected, onOpenEdit, onPersistAudioTranscript, imageNav }: BentoTileProps) {
  const key = tileKey(tile);
  const sortableProps = editable && sortable ? sortable.getContainerProps(key) : {};
  const bodyOpensEdit = editable && BODY_OPENS_EDIT.has(tile.type);

  return (
    <motion.div
      layout
      {...sortableProps}
      className={cn(
        spanClass(tile.w, tile.h),
        "group/tile relative rounded-[20px] overflow-hidden",
        editable && "cursor-grab active:cursor-grabbing",
        !editable && "transition-transform duration-300 ease-out hover:-translate-y-0.5 hover:scale-[1.02]",
        selected && "ring-2 ring-[var(--text-primary)] ring-offset-2 ring-offset-[var(--bg-base)]"
      )}
      // Un drag qui se termine sur la tuile ne doit pas déclencher le clic qui
      // suit (ouverture d'une image, navigation d'un lien…) — même garde que
      // l'ancien carnet, en capture pour intercepter aussi les <a> internes.
      onClickCapture={(e) => {
        if (sortable?.wasDragging()) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
      onClick={() => {
        if (!bodyOpensEdit) return;
        if (sortable?.wasDragging()) return;
        onOpenEdit?.();
      }}
    >
      {isDragging ? (
        <div className="w-full h-full rounded-[20px] border-2 border-dashed border-[var(--border-default)] bg-[var(--bg-surface)]/60" />
      ) : (
        <TileContent tile={tile} editable={editable} onPersistAudioTranscript={onPersistAudioTranscript} imageNav={imageNav} />
      )}

      {editable && !isDragging && (
        <>
          {/* Point d'entrée UNIQUE des réglages (format, contenu, suppression).
              opacity-0 + group-hover ne se déclenche jamais au tactile (pas de
              survol) — pointer-coarse:opacity-100 le garde visible sur
              mobile/tablette. */}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onOpenEdit?.(); }}
            className="absolute top-2 right-2 z-20 w-8 h-8 rounded-full bg-black/60 backdrop-blur-sm text-white/90 flex items-center justify-center opacity-0 group-hover/tile:opacity-100 pointer-coarse:opacity-100 focus-visible:opacity-100 transition-opacity"
            title="Modifier la tuile"
            aria-label="Modifier la tuile"
          >
            <SlidersHorizontal size={14} strokeWidth={2} />
          </button>

          {/* DragHandle est déjà `hidden pointer-coarse:flex` (réservée au
              tactile — à la souris on saisit le corps de la carte n'importe
              où, voir useSortableGrid) : pas de hover à ajouter par-dessus. */}
          <DragHandle {...sortable!.getHandleProps(key)} className="absolute bottom-2 left-2 z-20" title="Glisser pour réordonner" />
        </>
      )}
    </motion.div>
  );
}
