"use client";

import { cn } from "@/lib/utils";
import { tileKey, type TileWidth } from "@/lib/visits/bentoSpans";
import { BentoTile } from "@/components/visits/bento/BentoTile";
import { TileContent, type ImageNavItem } from "@/components/visits/bento/TileContent";
import { AddTileButton } from "@/components/visits/bento/AddTileButton";
import type { SortableGrid } from "@/hooks/useSortableGrid";
import type { BentoTile as BentoTileData } from "@/lib/visits/bentoTypes";

interface BentoGridProps {
  tiles: BentoTileData[];
  editable: boolean;
  sortable?: SortableGrid;
  isMobile?: boolean;
  /** Clé de la tuile dont le pop-up de réglages est ouvert (surcouche de sélection). */
  selectedKey?: string | null;
  /** Clé du bloc texte en édition inline (desktop). */
  editingContentKey?: string | null;
  onSetFormat?: (tile: BentoTileData, w: TileWidth, h: 1 | 2) => void;
  onOpenSettings?: (tile: BentoTileData) => void;
  onStartInlineEdit?: (tile: BentoTileData) => void;
  onEndInlineEdit?: () => void;
  onSaveText?: (tile: BentoTileData, value: string) => void;
  onPersistText?: (tile: BentoTileData, value: string) => Promise<void>;
  onPersistAudioTranscript?: (audioId: string, transcript: string) => Promise<void>;
  onToggleChecklistItem?: (checklistId: string, itemId: string) => void;
  onAutoRows?: (tile: BentoTileData, rows: number) => void;
  onAddClick?: () => void;
}

// Grille dense façon Bento.me : 2 colonnes mobile / 3 tablette / 4 desktop,
// `grid-auto-flow: dense` comble les trous. Les blocs texte s'étendent en
// hauteur automatiquement (row-span mesuré dans BentoTile).
export function BentoGrid({
  tiles,
  editable,
  sortable,
  isMobile,
  selectedKey,
  editingContentKey,
  onSetFormat,
  onOpenSettings,
  onStartInlineEdit,
  onEndInlineEdit,
  onSaveText,
  onPersistText,
  onPersistAudioTranscript,
  onToggleChecklistItem,
  onAutoRows,
  onAddClick,
}: BentoGridProps) {
  const draggedTile = sortable?.draggingKey ? tiles.find((t) => tileKey(t) === sortable.draggingKey) : undefined;

  // Avec des séparateurs, on veut des SECTIONS nettes : le flux dense
  // remonterait des tuiles d'une section dans les trous d'une section
  // précédente. On coupe donc `dense` dès qu'un séparateur est présent (les
  // séparateurs pleine largeur cassent alors proprement les lignes).
  const hasSeparator = tiles.some((t) => t.content.type === "separator");

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
          "auto-rows-[150px] sm:auto-rows-[170px] lg:auto-rows-[190px]",
          !hasSeparator && "[grid-auto-flow:dense]"
        )}
      >
        {tiles.map((tile) => (
          <BentoTile
            key={tileKey(tile)}
            tile={tile}
            editable={editable}
            sortable={sortable}
            isMobile={isMobile}
            isDragging={sortable?.draggingKey === tileKey(tile)}
            selected={selectedKey === tileKey(tile)}
            editingInline={editingContentKey === tileKey(tile)}
            imageNav={imageNav}
            onSetFormat={onSetFormat}
            onOpenSettings={onOpenSettings}
            onStartInlineEdit={onStartInlineEdit}
            onEndInlineEdit={onEndInlineEdit}
            onSaveText={onSaveText}
            onPersistText={onPersistText}
            onPersistAudioTranscript={onPersistAudioTranscript}
            onToggleChecklistItem={onToggleChecklistItem}
            onAutoRows={onAutoRows}
          />
        ))}
      </div>

      {editable && <AddTileButton onClick={() => onAddClick?.()} />}

      {editable && sortable && (
        <div ref={sortable.overlayRef} style={sortable.overlayStyle}>
          {draggedTile && (
            <div className="w-full h-full rounded-[20px] overflow-hidden shadow-2xl shadow-black/50 bg-[var(--bg-elevated)]">
              <TileContent tile={draggedTile} editable={false} />
            </div>
          )}
        </div>
      )}
    </>
  );
}
