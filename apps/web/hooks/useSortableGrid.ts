"use client";

import { useEffect, useRef, useState } from "react";
import type { DragHandleProps } from "@/hooks/useDragHandle";

/**
 * Réordonnancement de grille robuste, sur le modèle éprouvé des libs DnD
 * sérieuses (dnd-kit, react-beautiful-dnd, Trello) : **overlay flottant + item
 * fantôme**.
 *
 * Pourquoi pas simplement `drag` + `layout` de Framer Motion sur l'élément
 * lui-même : l'élément draguée participerait à la fois à l'animation `layout`
 * (quand la liste se réordonne) ET à la transformation de drag — les deux se
 * battent, l'élément « saute » ou dérive vers son futur emplacement pendant
 * qu'on le tient. Impossible à corriger proprement tant que l'élément qui bouge
 * est aussi celui qui se réorganise dans le flux.
 *
 * La solution : on découple les deux.
 * - Un **clone flottant** (`position: fixed`, `pointer-events: none`) suit le
 *   pointeur — piloté directement via une ref, zéro re-render par frame. C'est
 *   le seul élément qui bouge à la main, donc parfaitement fluide.
 * - L'item d'origine reste dans la grille en **fantôme** (opacité réduite) et
 *   ne fait que se réordonner via `layout` de Framer, comme ses voisins — une
 *   animation FLIP propre, sans conflit puisqu'il n'est pas « draggué ».
 * - Au drop, le clone s'anime vers l'emplacement final du fantôme, puis
 *   disparaît (pas de téléportation).
 *
 * Le hit-test (`elementFromPoint`) ignore le clone (pointer-events:none) et le
 * fantôme (on compare la clé). Seul le franchissement d'une NOUVELLE cible
 * déclenche un réordonnancement → pas d'oscillation.
 *
 * Saisie : souris = n'importe où sur l'item ; tactile = poignée dédiée
 * (`touch-action:none` permanent — voir useDragHandle pour la raison plateforme).
 */

const DRAG_THRESHOLD = 6; // px avant qu'un appui ne devienne un drag (préserve le clic)

export interface SortableGrid {
  /** Clé de l'item en cours de drag (null au repos). */
  draggingKey: string | null;
  /** Props à spreader sur chaque item triable (démarre le drag à la souris). */
  getContainerProps: (key: string) => {
    "data-sortable-key": string;
    onPointerDown: (e: React.PointerEvent) => void;
  };
  /** Props à spreader sur la poignée tactile dédiée (composant DragHandle). */
  getHandleProps: (key: string) => DragHandleProps;
  /** True brièvement après un vrai drag — à tester dans onClick pour ne pas naviguer par accident. */
  wasDragging: () => boolean;
  /** Réf à poser sur le conteneur du clone flottant. */
  overlayRef: React.RefObject<HTMLDivElement | null>;
  /** Style à appliquer au conteneur du clone flottant. */
  overlayStyle: React.CSSProperties;
}

interface SortableOptions {
  /** Déplace `draggedKey` à la position de `targetKey` dans le state local. */
  onReorder: (draggedKey: string, targetKey: string) => void;
  /** Fin du geste. `hitEl` = élément réellement sous le pointeur au relâchement. */
  onDrop: (hitEl: Element | null, x: number, y: number, draggedKey: string) => void;
  /** Optionnel, à chaque frame : survol de cibles externes (ex. dossiers). */
  onHover?: (hitEl: Element | null, x: number, y: number, draggedKey: string) => void;
}

interface Armed {
  key: string;
  rect: DOMRect;
  startX: number;
  startY: number;
}

export function useSortableGrid(opts: SortableOptions): SortableGrid {
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [overlaySize, setOverlaySize] = useState<{ w: number; h: number } | null>(null);

  const optsRef = useRef(opts);
  optsRef.current = opts;

  const draggingKeyRef = useRef<string | null>(null);
  const lastTargetRef = useRef<string | null>(null);
  const armedRef = useRef<Armed | null>(null);
  const grabOffset = useRef({ x: 0, y: 0 });
  const pointer = useRef({ x: 0, y: 0 });
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const didDragRef = useRef(false);

  // Écouteurs à identité stable (pour add/removeEventListener), qui délèguent à
  // des implémentations réévaluées à chaque rendu (closures sur les refs).
  const moveImpl = useRef<(e: PointerEvent) => void>(() => {});
  const upImpl = useRef<(e: PointerEvent) => void>(() => {});
  const moveListener = useRef((e: PointerEvent) => moveImpl.current(e)).current;
  const upListener = useRef((e: PointerEvent) => upImpl.current(e)).current;

  const removeListeners = () => {
    window.removeEventListener("pointermove", moveListener);
    window.removeEventListener("pointerup", upListener);
    window.removeEventListener("pointercancel", upListener);
  };

  const applyOverlayTransform = () => {
    const el = overlayRef.current;
    if (!el) return;
    el.style.transform = `translate3d(${pointer.current.x - grabOffset.current.x}px, ${pointer.current.y - grabOffset.current.y}px, 0)`;
  };

  const activate = (a: Armed, e: PointerEvent) => {
    grabOffset.current = { x: a.startX - a.rect.left, y: a.startY - a.rect.top };
    pointer.current = { x: e.clientX, y: e.clientY };
    draggingKeyRef.current = a.key;
    lastTargetRef.current = a.key;
    didDragRef.current = true;
    armedRef.current = null;
    document.body.style.userSelect = "none";
    setOverlaySize({ w: a.rect.width, h: a.rect.height });
    setDraggingKey(a.key);
  };

  const processMove = (e: PointerEvent) => {
    const dk = draggingKeyRef.current;
    if (!dk) return;
    pointer.current = { x: e.clientX, y: e.clientY };
    applyOverlayTransform();
    const hitEl = document.elementFromPoint(e.clientX, e.clientY);
    optsRef.current.onHover?.(hitEl, e.clientX, e.clientY, dk);
    const targetKey = hitEl?.closest<HTMLElement>("[data-sortable-key]")?.getAttribute("data-sortable-key") ?? null;
    if (targetKey && targetKey !== dk && targetKey !== lastTargetRef.current) {
      lastTargetRef.current = targetKey;
      optsRef.current.onReorder(dk, targetKey);
    }
  };

  const finishDrop = (dk: string) => {
    const overlay = overlayRef.current;
    const esc = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(dk) : dk;
    const placeholder = document.querySelector<HTMLElement>(`[data-sortable-key="${esc}"]`);
    const clear = () => { setDraggingKey(null); setOverlaySize(null); };
    if (overlay && placeholder) {
      // Anime le clone vers l'emplacement final du fantôme (pas de téléportation).
      const r = placeholder.getBoundingClientRect();
      overlay.style.transition = "transform 0.18s cubic-bezier(0.2,0,0,1)";
      overlay.style.transform = `translate3d(${r.left}px, ${r.top}px, 0)`;
      window.setTimeout(clear, 180);
    } else {
      clear();
    }
  };

  moveImpl.current = (e: PointerEvent) => {
    if (draggingKeyRef.current) {
      e.preventDefault();
      processMove(e);
      return;
    }
    const a = armedRef.current;
    if (!a) return;
    if (Math.hypot(e.clientX - a.startX, e.clientY - a.startY) < DRAG_THRESHOLD) return;
    activate(a, e);
    processMove(e);
  };

  upImpl.current = (e: PointerEvent) => {
    removeListeners();
    document.body.style.userSelect = "";
    const dk = draggingKeyRef.current;
    armedRef.current = null;
    draggingKeyRef.current = null;
    lastTargetRef.current = null;
    if (!dk) return; // simple clic (jamais passé le seuil)
    const hitEl = document.elementFromPoint(e.clientX, e.clientY);
    optsRef.current.onDrop(hitEl, e.clientX, e.clientY, dk);
    finishDrop(dk);
    // didDrag reste vrai un court instant pour neutraliser le clic qui suit.
    window.setTimeout(() => { didDragRef.current = false; }, 160);
  };

  const startArming = (key: string, cardEl: HTMLElement | null, e: React.PointerEvent) => {
    if (!cardEl) return;
    armedRef.current = {
      key,
      rect: cardEl.getBoundingClientRect(),
      startX: e.clientX,
      startY: e.clientY,
    };
    window.addEventListener("pointermove", moveListener, { passive: false });
    window.addEventListener("pointerup", upListener);
    window.addEventListener("pointercancel", upListener);
  };

  useEffect(() => () => {
    removeListeners();
    document.body.style.userSelect = "";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getContainerProps = (key: string) => ({
    "data-sortable-key": key,
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType !== "mouse" || e.button !== 0) return; // tactile => poignée
      // Ne pas démarrer sur les vrais contrôles (menu, suppression, champs).
      // On N'EXCLUT PAS <a> : dans le carnet de visite, toute la vignette est
      // un <Link> — il faut pouvoir la saisir. Le seuil de 6px + wasDragging()
      // distinguent le clic (navigation) du drag.
      if ((e.target as HTMLElement).closest("button, input, textarea, select")) return;
      startArming(key, e.currentTarget as HTMLElement, e);
    },
  });

  const getHandleProps = (key: string): DragHandleProps => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.stopPropagation();
      navigator.vibrate?.(10);
      const card = (e.currentTarget as HTMLElement).closest<HTMLElement>("[data-sortable-key]");
      startArming(key, card, e);
    },
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    style: { touchAction: "none", WebkitTouchCallout: "none" },
  });

  const wasDragging = () => didDragRef.current;

  const overlayStyle: React.CSSProperties = {
    position: "fixed",
    top: 0,
    left: 0,
    width: overlaySize?.w,
    height: overlaySize?.h,
    transform: `translate3d(${pointer.current.x - grabOffset.current.x}px, ${pointer.current.y - grabOffset.current.y}px, 0)`,
    pointerEvents: "none",
    zIndex: 9999,
    willChange: "transform",
  };

  return { draggingKey, getContainerProps, getHandleProps, wasDragging, overlayRef, overlayStyle };
}
