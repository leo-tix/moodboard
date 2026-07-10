"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { motion, type PanInfo } from "framer-motion";
import { cn } from "@/lib/utils";
import { getThumbnailUrl } from "@/lib/storage/urls";
import { useDragHandle } from "@/hooks/useDragHandle";
import { DragHandle } from "@/components/ui/DragHandle";

interface InspirationCardProps {
  id: string;
  title: string;
  thumbnailKey: string | null;
  blurHash: string | null;
  width: number | null;
  height: number | null;
  isAnimated?: boolean;
  category?: string | null;
  tags?: string[];
  year?: number | null;
  className?: string;
  /** Nombre de planches moodboard où cette image est présente */
  moodboardCount?: number;
  // Selection
  selectable?: boolean;
  selected?: boolean;
  onSelect?: (id: string) => void;
  onBeforeNavigate?: () => void;
  // Drag vers collection/visite/corbeille — démarré depuis la poignée ⠿
  onCardDragStart?: (id: string) => void;
  onCardDrag?: (x: number, y: number) => void;
  onCardDragEnd?: (x: number, y: number) => void;
}

export function InspirationCard({
  id,
  title,
  thumbnailKey,
  blurHash: _blurHash,
  width,
  height,
  isAnimated: _isAnimated = false,
  category,
  tags = [],
  year,
  className,
  moodboardCount,
  selectable,
  selected,
  onSelect,
  onBeforeNavigate,
  onCardDragStart,
  onCardDrag,
  onCardDragEnd,
}: InspirationCardProps) {
  const [hovered, setHovered] = useState(false);
  const dragEnabled = !!onCardDragStart;
  const { dragControls, onCardPointerDown, handleProps } = useDragHandle(dragEnabled);
  // Évite qu'un clic/tap déclenché juste après un vrai drag ne navigue ou
  // ne (dé)sélectionne la carte par accident.
  const justDraggedRef = useRef(false);

  const guardClick = (fn: () => void) => {
    if (justDraggedRef.current) return;
    fn();
  };

  const thumbUrl = thumbnailKey ? getThumbnailUrl(thumbnailKey) : null;
  const aspectRatio = width && height ? width / height : 1;

  const cardContent = (
    <motion.div
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => setHovered(false)}
      className={cn(
        "relative overflow-hidden rounded-md bg-[var(--bg-surface)] cursor-pointer",
        selected && "ring-2 ring-[var(--accent)] ring-offset-1 ring-offset-[var(--bg-base)]"
      )}
      style={{ aspectRatio }}
      whileHover={{ scale: selectable ? 1 : 1.005 }}
      whileDrag={{ scale: 1.06, zIndex: 50, boxShadow: "0 25px 50px -12px rgba(0,0,0,0.55)" }}
      transition={{ duration: 0.2 }}
      drag={dragEnabled}
      dragListener={false}
      dragControls={dragControls}
      dragElastic={0.12}
      dragMomentum={false}
      dragSnapToOrigin
      onPointerDown={onCardPointerDown}
      onDragStart={() => {
        // Armé dès le DÉBUT du drag, pas à la fin : le "click" natif du
        // navigateur peut se déclencher avant que onDragEnd n'ait fini de
        // s'exécuter (pas d'ordre garanti entre les deux), donc poser le flag
        // seulement dans onDragEnd arrivait parfois trop tard pour l'empêcher.
        justDraggedRef.current = true;
        onCardDragStart?.(id);
      }}
      onDrag={(_e, info: PanInfo) => onCardDrag?.(info.point.x, info.point.y)}
      onDragEnd={(_e, info: PanInfo) => {
        onCardDragEnd?.(info.point.x, info.point.y);
        setTimeout(() => { justDraggedRef.current = false; }, 150);
      }}
    >
      {/* Image — <img> natif pour les animés (Next.js <Image> supprime l'animation GIF) */}
      {thumbUrl ? (
        <img
          src={thumbUrl}
          alt={title}
          draggable={false}
          className={cn(
            "absolute inset-0 w-full h-full object-cover transition-transform duration-300",
            hovered && !selectable ? "scale-[1.02]" : "scale-100"
          )}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-[var(--text-tertiary)] text-xs">Sans image</span>
        </div>
      )}

      {/* Badge moodboards */}
      {moodboardCount != null && moodboardCount > 0 && (
        <div className="absolute top-2 right-2 z-10 flex items-center gap-1 bg-black/60 backdrop-blur-sm text-white text-[9px] font-medium px-1.5 py-0.5 rounded-full pointer-events-none">
          <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
            <rect x="1" y="3" width="8" height="6" rx="1"/><path d="M3 3V2a2 2 0 014 0v1"/>
          </svg>
          {moodboardCount}
        </div>
      )}

      {/* Checkbox de sélection */}
      {selectable && (
        <div
          className={cn(
            "absolute top-2 left-2 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all z-10",
            // pointer-coarse : toujours visible au tactile (pas de hover possible)
            "opacity-0 pointer-coarse:opacity-100",
            (selected || hovered) && "opacity-100",
            selected
              ? "bg-[var(--accent)] border-[var(--accent)]"
              : "bg-black/40 border-white/40"
          )}
        >
          {selected && <span className="text-[var(--bg-base)] text-[9px] font-bold">✓</span>}
        </div>
      )}

      {dragEnabled && (
        <DragHandle
          {...handleProps}
          className="absolute bottom-2 right-2 z-20"
          title="Glisser vers une collection, une visite ou la corbeille"
        />
      )}

      {/* Overlay hover — infos (masqué en mode sélection) */}
      {!selectable && (
        <motion.div
          className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent flex flex-col justify-end p-3"
          initial={{ opacity: 0 }}
          animate={{ opacity: hovered ? 1 : 0 }}
          transition={{ duration: 0.18 }}
        >
          <p className="text-white text-xs font-medium leading-tight line-clamp-2 mb-1.5">{title}</p>
          <div className="flex items-center gap-2 flex-wrap">
            {category && <span className="text-[10px] text-white/60">{category}</span>}
            {year && <span className="text-[10px] text-white/40">{year}</span>}
          </div>
          {tags.length > 0 && (
            <div className="flex gap-1 mt-1.5 flex-wrap">
              {tags.slice(0, 3).map((tag) => (
                <span key={tag} className="text-[9px] px-1.5 py-0.5 bg-white/10 text-white/70 rounded-sm">
                  {tag}
                </span>
              ))}
            </div>
          )}
        </motion.div>
      )}

      {/* Titre visible en mode sélection au hover */}
      {selectable && hovered && (
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2">
          <p className="text-white text-[10px] leading-tight line-clamp-1">{title}</p>
        </div>
      )}
    </motion.div>
  );

  if (selectable && onSelect) {
    return (
      <div
        className={cn("block group", className)}
        onClick={() => guardClick(() => onSelect(id))}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && onSelect(id)}
      >
        {cardContent}
      </div>
    );
  }

  return (
    <Link
      href={`/library/${id}`}
      className={cn("block group", className)}
      // Sans ça, le navigateur déclenche son propre drag natif du lien (ghost
      // "titre + URL") qui prend le pas sur le drag Framer Motion piloté à la
      // main ci-dessus — même piège que <img draggable={false}> plus haut.
      draggable={dragEnabled ? false : undefined}
      // Idem au tactile : sans ça, l'appui long ouvre le menu contextuel natif
      // du navigateur. -webkit-touch-callout couvre le callout iOS Safari.
      onContextMenu={dragEnabled ? (e) => e.preventDefault() : undefined}
      style={dragEnabled ? { WebkitTouchCallout: "none" } : undefined}
      onClick={(e) => {
        if (justDraggedRef.current) { e.preventDefault(); return; }
        onBeforeNavigate?.();
      }}
    >
      {cardContent}
    </Link>
  );
}
