"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef } from "react";
import type { CommentThread } from "@/lib/moodboard/comments";

// Couche des pastilles de commentaires, superposée au canvas.
//
// Les pastilles vivent en coordonnées CANVAS (comme les éléments) mais doivent
// garder une TAILLE D'ÉCRAN constante : les placer dans le conteneur transformé
// les ferait grossir avec le zoom. On les rend donc dans une couche non
// transformée et on recalcule leur position à chaque pan/zoom.
//
// Ce recalcul passe par un handle impératif (`notifyPanZoom`), comme la couche
// de traits (StrokeCanvas/PencilLayer) : pendant un déplacement, pan et zoom
// vivent dans des refs et sont appliqués directement au DOM, sans repasser par
// l'état React — c'est ce qui garde la navigation fluide.

export interface CommentsLayerHandle {
  notifyPanZoom: (pan: { x: number; y: number }, zoom: number) => void;
}

interface Props {
  threads: CommentThread[];
  /** Fil ouvert dans le panneau — pastille mise en avant. */
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Ancre du commentaire en cours de rédaction (pas encore envoyé). */
  pendingPin: { x: number; y: number } | null;
  /** Couche inerte (mode dessin, glisser-déposer…) : pastilles non cliquables. */
  disabled?: boolean;
  /**
   * Pan/zoom courants, lus au montage. Indispensable : la couche est montée à
   * l'ouverture du panneau, souvent bien après que la vue a été déplacée, et
   * `notifyPanZoom` n'arrive qu'au mouvement SUIVANT — sans cela les pastilles
   * s'afficheraient au mauvais endroit jusqu'au premier geste.
   */
  getView: () => { pan: { x: number; y: number }; zoom: number };
}

export const CommentsLayer = forwardRef<CommentsLayerHandle, Props>(function CommentsLayer(
  { threads, selectedId, onSelect, pendingPin, disabled = false, getView },
  ref,
) {
  const pinsRef = useRef(new Map<string, HTMLElement>());
  // null tant qu'aucun pan/zoom n'a été signalé → on interroge le parent.
  const viewRef = useRef<{ pan: { x: number; y: number }; zoom: number } | null>(null);
  // `getView` est redéfini à chaque rendu du parent : on le garde dans une ref
  // pour que `place` reste stable et ne relance pas tout le repositionnement.
  const getViewRef = useRef(getView);
  useEffect(() => { getViewRef.current = getView; }, [getView]);

  const place = useCallback((el: HTMLElement, x: number, y: number) => {
    const { pan, zoom } = viewRef.current ?? getViewRef.current();
    // -100% en X/Y : la pointe de la bulle (coin bas-gauche) tombe pile sur
    // le point cliqué, comme un repère de carte.
    el.style.transform = `translate(${pan.x + x * zoom}px, ${pan.y + y * zoom}px) translate(0, -100%)`;
  }, []);

  const placeAll = useCallback(() => {
    for (const thread of threads) {
      const el = pinsRef.current.get(thread.id);
      if (el && thread.x !== null && thread.y !== null) place(el, thread.x, thread.y);
    }
    const pendingEl = pinsRef.current.get("__pending__");
    if (pendingEl && pendingPin) place(pendingEl, pendingPin.x, pendingPin.y);
  }, [threads, pendingPin, place]);


  useImperativeHandle(ref, () => ({
    notifyPanZoom: (pan, zoom) => {
      viewRef.current = { pan, zoom };
      placeAll();
    },
  }), [placeAll]);

  // Repositionne après chaque rendu (nouveau fil, fil supprimé, filtre changé) :
  // le pan/zoom courant vit dans une ref que React ne connaît pas.
  useLayoutEffect(placeAll, [placeAll]);

  const register = (id: string) => (el: HTMLElement | null) => {
    if (el) pinsRef.current.set(id, el);
    else pinsRef.current.delete(id);
  };

  return (
    <div
      className="absolute inset-0 overflow-hidden pointer-events-none"
      style={{ zIndex: 160 }}
      aria-hidden={disabled}
    >
      {threads.map((thread, i) => {
        if (thread.x === null || thread.y === null) return null;
        const selected = thread.id === selectedId;
        const count = 1 + thread.replies.length;
        return (
          <button
            key={thread.id}
            ref={register(thread.id)}
            type="button"
            onClick={(e) => { e.stopPropagation(); onSelect(thread.id); }}
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            title={`${thread.authorName} — ${thread.body.slice(0, 80)}`}
            className={[
              "absolute top-0 left-0 flex items-center justify-center",
              "h-7 min-w-7 px-1.5 rounded-full rounded-bl-[3px] text-[11px] font-semibold",
              "border shadow-lg transition-colors select-none",
              disabled ? "pointer-events-none" : "pointer-events-auto cursor-pointer",
              thread.resolved
                ? "bg-[var(--bg-elevated)] border-[var(--border-default)] text-[var(--text-tertiary)]"
                : "bg-[var(--accent,#a78bfa)] border-white/30 text-[#1a1a1a]",
              selected ? "ring-2 ring-white/80 ring-offset-1 ring-offset-black/40" : "",
            ].join(" ")}
          >
            {i + 1}
            {count > 1 && <span className="ml-0.5 opacity-70 font-normal">·{count}</span>}
          </button>
        );
      })}

      {pendingPin && (
        <div
          ref={register("__pending__")}
          className="absolute top-0 left-0 h-7 w-7 rounded-full rounded-bl-[3px] border-2 border-dashed border-[var(--accent,#a78bfa)] bg-[var(--accent,#a78bfa)]/25 animate-pulse"
        />
      )}
    </div>
  );
});
