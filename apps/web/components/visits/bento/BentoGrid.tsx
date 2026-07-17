"use client";

import { cn } from "@/lib/utils";
import { spanClass, tileKey } from "@/lib/visits/bentoSpans";
import { BentoTile } from "@/components/visits/bento/BentoTile";
import { TileContent } from "@/components/visits/bento/TileContent";
import { AddTileButton } from "@/components/visits/bento/AddTileButton";
import type { SortableGrid } from "@/hooks/useSortableGrid";
import type { BentoTile as BentoTileData } from "@/lib/visits/bentoTypes";

interface BentoGridProps {
  tiles: BentoTileData[];
  editable: boolean;
  sortable?: SortableGrid;
  onOpenEdit?: (tile: BentoTileData) => void;
  onResize?: (tile: BentoTileData) => void;
  onDelete?: (tile: BentoTileData) => void;
  onPersistAudioTranscript?: (audioId: string, transcript: string) => Promise<void>;
  onAddClick?: () => void;
}

// Grille dense façon Bento.me (spec §1.1) : 2 colonnes mobile / 3 tablette /
// 4 desktop, `grid-auto-flow: dense` comble les trous laissés par les tuiles
// 2x1/1x2/2x2. Les lignes ont une hauteur fixe par palier (auto-rows) pour
// que les tuiles 1x1 restent à peu près carrées, comme sur bento.me.
export function BentoGrid({ tiles, editable, sortable, onOpenEdit, onResize, onDelete, onPersistAudioTranscript, onAddClick }: BentoGridProps) {
  const draggedTile = sortable?.draggingKey ? tiles.find((t) => tileKey(t) === sortable.draggingKey) : undefined;

  return (
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
          onOpenEdit={() => onOpenEdit?.(tile)}
          onResize={() => onResize?.(tile)}
          onDelete={() => onDelete?.(tile)}
          onPersistAudioTranscript={onPersistAudioTranscript}
        />
      ))}

      {editable && <AddTileButton onClick={() => onAddClick?.()} />}

      {/* Clone flottant pendant le drag — même contenu que la tuile réelle,
          agrandi/ombré (spec §2.1). pointer-events-none + position:fixed
          viennent de useSortableGrid (overlayStyle). */}
      {editable && sortable && (
        <div ref={sortable.overlayRef} style={sortable.overlayStyle}>
          {draggedTile && (
            <div className="w-full h-full rounded-[20px] overflow-hidden shadow-2xl shadow-black/50 scale-[1.05]">
              <TileContent tile={draggedTile} editable={false} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
