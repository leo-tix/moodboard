"use client";

import { useDragControls, type DragControls } from "framer-motion";

export interface DragHandleProps {
  onPointerDown: (e: React.PointerEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  style: { touchAction: "none"; WebkitTouchCallout: "none" };
}

export interface UseDragHandleResult {
  dragControls: DragControls;
  /** À passer sur le pointerdown de l'élément entier (carte, bloc…) */
  onCardPointerDown: (e: React.PointerEvent) => void;
  /** Props à spreader sur la poignée dédiée (tactile uniquement) */
  handleProps: DragHandleProps;
}

/**
 * Démarre un drag Framer Motion (`useDragControls` + `dragListener={false}`)
 * selon deux entrées distinctes :
 *
 * - **Souris** : `onCardPointerDown` sur l'élément entier — on peut saisir
 *   n'importe où, pas de conflit avec un geste de scroll.
 * - **Tactile** : `handleProps` sur une poignée dédiée, petite et séparée,
 *   avec `touch-action: none` posé PERMANENMENT dès le rendu (jamais togglé
 *   en cours de route).
 *
 * Pourquoi une poignée séparée au tactile et pas "n'importe où sur la carte" :
 * le navigateur décide UNE FOIS POUR TOUTES, dès le tout premier instant où
 * le doigt touche l'écran, si le geste sera un scroll natif ou non — en
 * lisant `touch-action` à cet instant précis. Impossible de changer cette
 * décision après coup (même de façon synchrone) une fois le doigt posé, donc
 * un "appui long puis drag" sur toute la carte perd systématiquement contre
 * le scroll natif dès que le doigt bouge. Une poignée avec `touch-action:none`
 * fixe dès le rendu élimine cette course : le navigateur sait dès le départ
 * qu'un toucher ici n'est jamais un scroll.
 *
 * Utilisé par InspirationCard (bibliothèque), MoodboardCard (planches) et
 * VisitJournal (carnet de visite) — même mécanique partout sur le site.
 */
export function useDragHandle(enabled: boolean): UseDragHandleResult {
  const dragControls = useDragControls();

  const onCardPointerDown = (e: React.PointerEvent) => {
    if (!enabled || e.pointerType !== "mouse") return;
    dragControls.start(e);
  };

  const handleProps: DragHandleProps = {
    onPointerDown: (e: React.PointerEvent) => {
      if (!enabled) return;
      e.stopPropagation();
      navigator.vibrate?.(10);
      dragControls.start(e);
    },
    onContextMenu: (e: React.MouseEvent) => {
      if (enabled) e.preventDefault();
    },
    style: { touchAction: "none", WebkitTouchCallout: "none" },
  };

  return { dragControls, onCardPointerDown, handleProps };
}
