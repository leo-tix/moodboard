"use client";

import { useDragControls, type DragControls } from "framer-motion";

export interface DragHandleProps {
  onPointerDown: (e: React.PointerEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  style: { touchAction: "none"; WebkitTouchCallout: "none" };
}

/**
 * Props obligatoires du `motion.div` draggable, à spreader telles quelles
 * (`<motion.div {...dragProps} ...>`). Regroupées ici pour éviter un bug
 * silencieux : `dragControls` doit être passé au MÊME élément que celui sur
 * lequel `dragControls.start()` est appelé, sinon le drag ne s'enclenche
 * jamais — sans erreur, sans warning, juste "rien ne se passe" au drag.
 * (Bug réel rencontré : oublié sur MoodboardCard/VisitJournal lors de la
 * première migration, resté indétecté par tsc/build.)
 */
export interface DragMotionProps {
  drag: boolean;
  dragListener: false;
  dragControls: DragControls;
  dragElastic: number;
  dragMomentum: false;
  dragSnapToOrigin: true;
  layout: boolean;
  whileDrag: { scale: number; zIndex: number; boxShadow: string; pointerEvents: "none" };
}

export interface UseDragHandleResult {
  dragControls: DragControls;
  /** À spreader sur le motion.div draggable — voir DragMotionProps. */
  dragProps: DragMotionProps;
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
 * Toujours spreader `dragProps` en entier sur le `motion.div` draggable —
 * ne jamais recopier ses champs un par un (c'est exactement ce qui a cassé
 * silencieusement le drag sur deux composants la première fois).
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

  const dragProps: DragMotionProps = {
    drag: enabled,
    dragListener: false,
    dragControls,
    dragElastic: 0.12,
    dragMomentum: false,
    dragSnapToOrigin: true,
    // Permet à Framer d'animer (FLIP) la position d'une carte quand ses
    // voisines sont réordonnées en direct pendant un drag — voir
    // MoodboardGrid/VisitJournal, qui poussent le nouvel ordre dans le state
    // dès le survol d'une autre carte plutôt qu'au drop uniquement.
    layout: true,
    whileDrag: {
      scale: 1.05,
      zIndex: 50,
      boxShadow: "0 25px 50px -12px rgba(0,0,0,0.55)",
      // `elementFromPoint` (utilisé pour le hit-test du drop) ignore les
      // éléments avec pointer-events:none — sans ça, la carte draguée, dont
      // le z-index élevé la place visuellement sous le curseur, se
      // retrouvait parfois détectée comme SA PROPRE cible au lieu de la
      // carte en dessous, rendant le drop aléatoire.
      pointerEvents: "none",
    },
  };

  return { dragControls, dragProps, onCardPointerDown, handleProps };
}
