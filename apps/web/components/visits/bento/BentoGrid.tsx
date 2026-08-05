"use client";

import { useState } from "react";
import { ImmersiveViewer } from "@/components/library/ImmersiveViewer";
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

// Grille dense façon Bento.me : 2 COLONNES PARTOUT (mobile → desktop), pour que
// la mise en page du carnet soit identique quel que soit l'écran — demande
// utilisateur 2026-08-05 (« faire 2 colonnes sur desktop comme sur mobile »).
// Sur grand écran les colonnes sont donc plus larges, et les lignes plus hautes
// pour garder des tuiles bien proportionnées.
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

  // Visionneuse plein écran des images en LECTURE SEULE (carnet public partagé
  // par lien, et mode lecture). ImmersiveViewer est autonome — aucun routeur,
  // aucune session — donc utilisable par un visiteur anonyme, sans lui ouvrir
  // la visionneuse de la bibliothèque (demande utilisateur 2026-08-05).
  const [viewerId, setViewerId] = useState<string | null>(null);

  // Avec des séparateurs, on veut des SECTIONS nettes : le flux dense
  // remonterait des tuiles d'une section dans les trous d'une section
  // précédente. On coupe donc `dense` dès qu'un séparateur est présent (les
  // séparateurs pleine largeur cassent alors proprement les lignes).
  const hasSeparator = tiles.some((t) => t.content.type === "separator");

  const imageNav: ImageNavItem[] = tiles
    .filter((t) => t.content.type === "image")
    .map((t) => {
      const c = t.content as Extract<BentoTileData["content"], { type: "image" }>;
      return { id: c.id, title: c.title, thumbnailKey: c.thumbnailKey, storageKey: c.storageKey };
    });

  const viewerIdx = viewerId ? imageNav.findIndex((i) => i.id === viewerId) : -1;

  return (
    <>
      <div
        className={cn(
          "grid grid-cols-2 gap-4 md:gap-6",
          "auto-rows-[150px] sm:auto-rows-[190px] lg:auto-rows-[230px]",
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
            onOpenImage={editable ? undefined : (id) => setViewerId(id)}
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

      {!editable && viewerIdx !== -1 && (
        <ImmersiveViewer
          storageKey={imageNav[viewerIdx].storageKey}
          title={imageNav[viewerIdx].title}
          counter={`${viewerIdx + 1} / ${imageNav.length}`}
          onClose={() => setViewerId(null)}
          onPrev={viewerIdx > 0 ? () => setViewerId(imageNav[viewerIdx - 1].id) : null}
          onNext={viewerIdx < imageNav.length - 1 ? () => setViewerId(imageNav[viewerIdx + 1].id) : null}
          currentThumbKey={imageNav[viewerIdx].thumbnailKey}
          prevThumbKey={viewerIdx > 0 ? imageNav[viewerIdx - 1].thumbnailKey : null}
          nextThumbKey={viewerIdx < imageNav.length - 1 ? imageNav[viewerIdx + 1].thumbnailKey : null}
        />
      )}

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
