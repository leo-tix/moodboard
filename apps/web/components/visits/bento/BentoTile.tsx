"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { DragHandle } from "@/components/ui/DragHandle";
import { NoteEditor } from "@/components/visits/NoteEditor";
import { FormatQuickBar } from "@/components/visits/bento/FormatPicker";
import { TileContent, type ImageNavItem } from "@/components/visits/bento/TileContent";
import { isAutoHeight, isNoteType, spanStyle, tileKey, type TileWidth } from "@/lib/visits/bentoSpans";
import type { SortableGrid } from "@/hooks/useSortableGrid";
import type { BentoTile as BentoTileData } from "@/lib/visits/bentoTypes";

// Mesure le contenu d'une tuile texte et en déduit le nombre de lignes de
// grille (row-span) nécessaire pour tout afficher, sans jamais couper. La
// tuile s'étend par paliers entiers : la grille reste intacte (demande
// utilisateur 2026-07-18). scrollHeight reflète la hauteur naturelle du
// contenu même si la tuile le rogne (overflow hidden), d'où la convergence.
function useMeasuredRows(enabled: boolean, initialRows: number, onRows?: (n: number) => void) {
  const [rows, setRows] = useState(Math.max(1, initialRows));
  const innerRef = useRef<HTMLDivElement>(null);
  const tileRef = useRef<HTMLDivElement>(null);
  const onRowsRef = useRef(onRows);
  onRowsRef.current = onRows;
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  useEffect(() => {
    if (!enabled) return;
    const inner = innerRef.current;
    const tile = tileRef.current;
    if (!inner || !tile) return;
    const compute = () => {
      const grid = tile.parentElement;
      if (!grid) return;
      const cs = getComputedStyle(grid);
      const rowH = parseFloat(cs.gridAutoRows) || 180;
      const gap = parseFloat(cs.rowGap) || 16;
      const H = inner.scrollHeight;
      let n = 1;
      while (n < 12 && n * rowH + (n - 1) * gap < H - 1) n++;
      if (n !== rowsRef.current) {
        rowsRef.current = n;
        setRows(n);
        onRowsRef.current?.(n);
      }
    };
    const ro = new ResizeObserver(compute);
    ro.observe(inner);
    compute();
    return () => ro.disconnect();
  }, [enabled]);

  return { rows, innerRef, tileRef };
}

interface BentoTileProps {
  tile: BentoTileData;
  editable: boolean;
  sortable?: SortableGrid;
  isDragging?: boolean;
  /** true si son pop-up de réglages est ouvert — surcouche de sélection. */
  selected?: boolean;
  isMobile?: boolean;
  imageNav?: ImageNavItem[];
  /** true si CE bloc texte est en cours d'édition inline (desktop). */
  editingInline?: boolean;
  onSetFormat?: (tile: BentoTileData, w: TileWidth, h: 1 | 2) => void;
  onOpenSettings?: (tile: BentoTileData) => void;
  onStartInlineEdit?: (tile: BentoTileData) => void;
  onEndInlineEdit?: () => void;
  onSaveText?: (tile: BentoTileData, value: string) => void;
  onPersistText?: (tile: BentoTileData, value: string) => Promise<void>;
  onPersistAudioTranscript?: (audioId: string, transcript: string) => Promise<void>;
  onToggleChecklistItem?: (checklistId: string, itemId: string) => void;
  onAutoRows?: (tile: BentoTileData, rows: number) => void;
}

// Types dont le clic sur le CORPS déclenche une action d'édition (les autres
// ont une action propre : image → visionneuse, lien → URL, audio → lecture).
const BODY_EDITS = new Set<BentoTileData["type"]>([
  "note",
  "map",
  "highlight",
  "cartel",
  "ticket",
  "checklist",
  "timeline",
  "palette",
  "sketch",
]);

// "Widget Wrapper" (spec §3.1). Chrome commun : coins arrondis, hover public,
// drag, icônes de format au survol, bouton réglages. Contenu délégué à
// TileContent, sauf pour un bloc texte en édition inline (éditeur rendu ici).
export function BentoTile({
  tile,
  editable,
  sortable,
  isDragging,
  selected,
  isMobile,
  imageNav,
  editingInline,
  onSetFormat,
  onOpenSettings,
  onStartInlineEdit,
  onEndInlineEdit,
  onSaveText,
  onPersistText,
  onPersistAudioTranscript,
  onToggleChecklistItem,
  onAutoRows,
}: BentoTileProps) {
  const key = tileKey(tile);
  // autoHeight : mesuré (note/checklist/frise). note : édition Tiptap inline.
  const autoHeight = isAutoHeight(tile.type);
  const note = isNoteType(tile.type);

  const { rows, innerRef, tileRef } = useMeasuredRows(
    autoHeight,
    tile.h,
    onAutoRows ? (n) => onAutoRows(tile, n) : undefined
  );
  const effectiveH = autoHeight ? rows : tile.h;

  // Pas de drag pendant l'édition inline (Tiptap est un contenteditable, non
  // exclu par le garde-fou pointerdown de useSortableGrid).
  const sortableProps = editable && sortable && !editingInline ? sortable.getContainerProps(key) : {};

  const bodyEdits = editable && BODY_EDITS.has(tile.type);

  const handleBodyClick = () => {
    if (!bodyEdits || editingInline) return;
    if (sortable?.wasDragging()) return;
    if (note && !isMobile) onStartInlineEdit?.(tile);
    else onOpenSettings?.(tile); // note mobile, ou autre module → pop-up central
  };

  return (
    <motion.div
      // Pas d'animation `layout` sur le texte : elle traduit un changement de
      // hauteur par un scaleY transitoire (le texte « s'écrase » pendant la
      // transition), très visible quand la tuile grandit à la frappe en
      // auto-hauteur. Croissance instantanée à la place. Les médias gardent
      // l'animation (réordonnancement fluide).
      layout={!autoHeight && !editingInline}
      ref={tileRef}
      {...sortableProps}
      style={spanStyle(tile.w, effectiveH)}
      className={cn(
        "group/tile relative rounded-[20px] overflow-hidden",
        autoHeight && "bg-[var(--bg-elevated)]",
        editable && !editingInline && "cursor-grab active:cursor-grabbing",
        !editable && "transition-transform duration-300 ease-out hover:-translate-y-0.5 hover:scale-[1.02]",
        selected && "ring-2 ring-[var(--text-primary)] ring-offset-2 ring-offset-[var(--bg-base)]"
      )}
      onClickCapture={(e) => {
        if (sortable?.wasDragging()) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
      onClick={handleBodyClick}
    >
      {isDragging ? (
        <div className="w-full h-full rounded-[20px] border-2 border-dashed border-[var(--border-default)] bg-[var(--bg-surface)]/60" />
      ) : autoHeight ? (
        <div ref={innerRef}>
          {editingInline && note ? (
            <div className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
              <InlineTextEditor
                tile={tile}
                onSave={(v) => { onSaveText?.(tile, v); onEndInlineEdit?.(); }}
                onPersist={(v) => onPersistText?.(tile, v) ?? Promise.resolve()}
              />
            </div>
          ) : (
            <TileContent tile={tile} editable={editable} onToggleChecklistItem={onToggleChecklistItem} />
          )}
        </div>
      ) : (
        <TileContent
          tile={tile}
          editable={editable}
          onPersistAudioTranscript={onPersistAudioTranscript}
          imageNav={imageNav}
        />
      )}

      {editable && !isDragging && !editingInline && (
        <>
          {/* Icônes de format AU SURVOL (desktop) : clic = format appliqué
              directement. Masqué au tactile (pas de survol) où le pop-up
              central via le bouton réglages fait le même travail. */}
          {onSetFormat && (
            <div className="absolute top-2 left-2 z-20 opacity-0 group-hover/tile:opacity-100 transition-opacity hidden sm:[@media(hover:hover)]:block">
              <FormatQuickBar
                type={tile.type}
                w={tile.w}
                h={tile.h}
                onChange={(w, h) => onSetFormat(tile, w, h)}
              />
            </div>
          )}

          {/* Contrôles groupés EN HAUT À DROITE : poignée de drag (tactile) +
              réglages. Regroupés ici pour ne pas chevaucher le contenu — la
              poignée était auparavant en bas à gauche, pile sur le bouton
              lecture de la carte mémo vocal (bug 2026-07-18). */}
          <div className="absolute top-2 right-2 z-20 flex items-center gap-1.5">
            {sortable && (
              <DragHandle {...sortable.getHandleProps(key)} title="Glisser pour réordonner" />
            )}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onOpenSettings?.(tile); }}
              className="w-8 h-8 rounded-full bg-black/60 backdrop-blur-sm text-white/90 flex items-center justify-center opacity-0 group-hover/tile:opacity-100 pointer-coarse:opacity-100 focus-visible:opacity-100 transition-opacity"
              title="Réglages de la tuile"
              aria-label="Réglages de la tuile"
            >
              <SlidersHorizontal size={14} strokeWidth={2} />
            </button>
          </div>
        </>
      )}
    </motion.div>
  );
}

// Éditeur inline pour un bloc texte (desktop). Réutilise les éditeurs
// existants (déjà éprouvés en inline dans l'ancien carnet) ; onBlur sauvegarde
// et referme, onAutoSave persiste en continu.
function InlineTextEditor({
  tile,
  onSave,
  onPersist,
}: {
  tile: BentoTileData;
  onSave: (value: string) => void;
  onPersist: (value: string) => Promise<void>;
}) {
  if (tile.content.type === "note") {
    return (
      <NoteEditor
        content={tile.content.content}
        editable
        showToolbar
        onBlurSave={onSave}
        onAutoSave={onPersist}
        placeholder="Écris… (titre, paragraphe, citation via la barre)"
      />
    );
  }
  return null;
}
