"use client";

import { cn } from "@/lib/utils";
import { tileKey } from "@/lib/visits/bentoSpans";
import { BentoTile } from "@/components/visits/bento/BentoTile";
import { TileContent, type ImageNavItem } from "@/components/visits/bento/TileContent";
import { AddTileButton } from "@/components/visits/bento/AddTileButton";
import type { SortableGrid } from "@/hooks/useSortableGrid";
import type { BentoTile as BentoTileData } from "@/lib/visits/bentoTypes";

interface BentoGridProps {
  tiles: BentoTileData[];
  editable: boolean;
  sortable?: SortableGrid;
  /** Clé de la tuile dont le panneau d'édition est ouvert (surcouche de sélection). */
  selectedKey?: string | null;
  onOpenEdit?: (tile: BentoTileData) => void;
  onPersistAudioTranscript?: (audioId: string, transcript: string) => Promise<void>;
  onAddClick?: () => void;
}

// Grille dense façon Bento.me (spec §1.1) : 2 colonnes mobile / 3 tablette /
// 4 desktop, `grid-auto-flow: dense` comble les trous laissés par les tuiles
// 2x1/1x2/2x2. Les lignes ont une hauteur fixe par palier (auto-rows) pour
// que les tuiles 1x1 restent à peu près carrées, comme sur bento.me.
export function BentoGrid({ tiles, editable, sortable, selectedKey, onOpenEdit, onPersistAudioTranscript, onAddClick }: BentoGridProps) {
  const draggedTile = sortable?.draggingKey ? tiles.find((t) => tileKey(t) === sortable.draggingKey) : undefined;

  // Parcours ←/→ de la visionneuse limité aux images de CETTE visite.
  const imageNav: ImageNavItem[] = tiles
    .filter((t) => t.content.type === "image")
    .map((t) => {
      const c = t.content as Extract<BentoTileData["content"], { type: "image" }>;
      return { id: c.id, title: c.title, thumbnailKey: c.thumbnailKey };
    });

  return (
    <>
      <div
        className={cn(
          "grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 md:gap-6",
          "[grid-auto-flow:dense] auto-rows-[160px] sm:auto-rows-[180px] lg:auto-rows-[200px]"
        )}
      >
        {tiles.map((tile) => (
          <BentoTile
            key={tileKey(tile)}
            tile={tile}
            editable={editable}
            sortable={sortable}
            isDragging={sortable?.draggingKey === tileKey(tile)}
            selected={selectedKey === tileKey(tile)}
            onOpenEdit={() => onOpenEdit?.(tile)}
            onPersistAudioTranscript={onPersistAudioTranscript}
            imageNav={imageNav}
          />
        ))}
      </div>

      {/* Ajout HORS de la grille : en tant que tuile 1x1, `grid-auto-flow:dense`
          l'aspirait dans le premier trou disponible (donc souvent en haut de
          carnet, au milieu des blocs — audit 2026-07-17). En bande sous la
          grille, il reste là où on l'attend et offre une cible bien plus
          confortable au doigt. */}
      {editable && <AddTileButton onClick={() => onAddClick?.()} />}

      {/* Clone flottant pendant le drag — même contenu que la tuile réelle,
          agrandi/ombré (spec §2.1). pointer-events-none + position:fixed
          viennent de useSortableGrid (overlayStyle). */}
      {editable && sortable && (
        <div ref={sortable.overlayRef} style={sortable.overlayStyle}>
          {draggedTile && (
            <div className="w-full h-full rounded-[20px] overflow-hidden shadow-2xl shadow-black/50">
              <TileContent tile={draggedTile} editable={false} />
            </div>
          )}
        </div>
      )}
    </>
  );
}
