"use client";

import { useRef } from "react";
import { cn } from "@/lib/utils";

// Piste de trim avec fenêtre DÉPLAÇABLE (retour utilisateur 2026-10-21) :
// avant ce composant, les deux poignées de VideoTrimModal (deux
// <input type=range> natifs superposés) ne permettaient de déplacer QUE le
// début ou QUE la fin indépendamment — pour repositionner tout un passage
// de durée fixe (ex. "je veux 5s, mais sur CE moment précis"), il fallait
// re-régler les deux poignées à la main. YouTubeSectionPicker n'avait même
// pas de piste du tout (seulement des boutons "Début ici"/"Fin ici" liés à
// la tête de lecture, inutilisables si on a dépassé le point voulu).
//
// Entièrement en Pointer Events (pas de <input type=range>) : un seul
// gestionnaire sur la piste fait son propre hit-test (poignée gauche/droite
// vs. barre centrale vs. piste vide) plutôt que de superposer plusieurs
// inputs avec des z-index qui se marchent dessus. Unifie souris/tactile
// sans code séparé. Cliquer sur la piste EN DEHORS de la fenêtre la
// recentre instantanément sur le point cliqué, puis continue comme un
// déplacement — un seul geste pour "aller à peu près là" + ajuster fin.
export interface RangeConstraints {
  duration: number;
  minWindowS?: number;
  maxWindowS?: number;
}

export function clampResizeStart(value: number, end: number, c: RangeConstraints): number {
  const minW = c.minWindowS ?? 0.2;
  const maxW = c.maxWindowS ?? c.duration;
  const lo = Math.max(0, end - maxW);
  const hi = Math.max(lo, end - minW);
  return Math.min(Math.max(value, lo), hi);
}

export function clampResizeEnd(value: number, start: number, c: RangeConstraints): number {
  const minW = c.minWindowS ?? 0.2;
  const maxW = c.maxWindowS ?? c.duration;
  const hi = Math.min(c.duration, start + maxW);
  const lo = Math.min(hi, start + minW);
  return Math.max(Math.min(value, hi), lo);
}

export function clampMoveStart(value: number, windowLen: number, c: RangeConstraints): number {
  const maxStart = Math.max(0, c.duration - windowLen);
  return Math.min(Math.max(value, 0), maxStart);
}

interface RangeScrubberProps extends RangeConstraints {
  start: number;
  end: number;
  onChange: (start: number, end: number) => void;
  /** Déclenché à chaque tick de glissement — pour prévisualiser (seek) pendant l'ajustement. */
  onPreview?: (time: number) => void;
  disabled?: boolean;
  variant?: "overlay" | "surface";
  /** Superposition libre (ex. repère de tête de lecture) — rendue au-dessus, non interactive. */
  children?: React.ReactNode;
}

type DragMode = "start" | "end" | "move";

export function RangeScrubber({
  duration,
  start,
  end,
  onChange,
  onPreview,
  minWindowS = 0.2,
  maxWindowS,
  disabled,
  variant = "surface",
  children,
}: RangeScrubberProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ mode: DragMode; grabOffset: number } | null>(null);
  const constraints: RangeConstraints = { duration, minWindowS, maxWindowS };

  const timeFromClientX = (clientX: number): number => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return 0;
    const ratio = (clientX - rect.left) / rect.width;
    return Math.min(duration, Math.max(0, ratio * duration));
  };

  const startPct = duration > 0 ? (start / duration) * 100 : 0;
  const endPct = duration > 0 ? (end / duration) * 100 : 0;

  const applyDrag = (mode: DragMode, clientX: number, grabOffset: number) => {
    const t = timeFromClientX(clientX);
    if (mode === "start") {
      const next = clampResizeStart(t, end, constraints);
      onChange(next, end);
      onPreview?.(next);
    } else if (mode === "end") {
      const next = clampResizeEnd(t, start, constraints);
      onChange(start, next);
      onPreview?.(next);
    } else {
      const windowLen = end - start;
      const next = clampMoveStart(t - grabOffset, windowLen, constraints);
      onChange(next, next + windowLen);
      onPreview?.(next);
    }
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (disabled || !trackRef.current || duration <= 0) return;
    const rect = trackRef.current.getBoundingClientRect();
    const xPx = e.clientX - rect.left;
    const startPx = (startPct / 100) * rect.width;
    const endPx = (endPct / 100) * rect.width;
    const HIT = 16;

    let mode: DragMode;
    if (Math.abs(xPx - startPx) <= HIT && Math.abs(xPx - startPx) <= Math.abs(xPx - endPx)) {
      mode = "start";
    } else if (Math.abs(xPx - endPx) <= HIT) {
      mode = "end";
    } else if (xPx > startPx && xPx < endPx) {
      mode = "move";
    } else {
      // Clic hors fenêtre : recentre immédiatement dessus, puis le geste se
      // poursuit comme un déplacement classique.
      mode = "move";
      const windowLen = end - start;
      const t = timeFromClientX(e.clientX);
      const next = clampMoveStart(t - windowLen / 2, windowLen, constraints);
      onChange(next, next + windowLen);
      onPreview?.(next);
    }

    const grabOffset = mode === "move" ? timeFromClientX(e.clientX) - start : 0;
    dragRef.current = { mode, grabOffset };
    trackRef.current.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || disabled) return;
    applyDrag(drag.mode, e.clientX, drag.grabOffset);
  };

  const endDrag = (e: React.PointerEvent) => {
    dragRef.current = null;
    try {
      trackRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* déjà relâché */
    }
  };

  const nudge = (which: "start" | "end", deltaS: number) => {
    if (which === "start") {
      const next = clampResizeStart(start + deltaS, end, constraints);
      onChange(next, end);
      onPreview?.(next);
    } else {
      const next = clampResizeEnd(end + deltaS, start, constraints);
      onChange(start, next);
      onPreview?.(next);
    }
  };

  const handleKeyDown = (which: "start" | "end") => (e: React.KeyboardEvent) => {
    if (disabled) return;
    const step = e.shiftKey ? 1 : 0.1;
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      e.preventDefault();
      nudge(which, -step);
    } else if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      e.preventDefault();
      nudge(which, step);
    }
  };

  const palette =
    variant === "overlay"
      ? {
          track: "bg-white/15",
          fill: "bg-white",
          handle: "bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.4)]",
          move: "bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.4)]",
        }
      : {
          track: "bg-[var(--bg-elevated)]",
          fill: "bg-[var(--text-primary)]",
          handle: "bg-[var(--text-primary)] shadow-[0_0_0_1px_var(--bg-base)]",
          move: "bg-[var(--accent,#a78bfa)]",
        };

  return (
    <div
      ref={trackRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      className={cn(
        "relative h-8 touch-none select-none",
        disabled && "opacity-50 pointer-events-none",
      )}
    >
      <div className={cn("absolute inset-x-0 top-1/2 -translate-y-1/2 h-1 rounded-full pointer-events-none", palette.track)} />
      <div
        className={cn("absolute top-1/2 -translate-y-1/2 h-1 rounded-full pointer-events-none", palette.fill)}
        style={{ left: `${startPct}%`, width: `${Math.max(0, endPct - startPct)}%` }}
      />
      {/* Losange central — affordance visuelle du déplacement de toute la fenêtre. */}
      <div
        className={cn("absolute top-1/2 w-2.5 h-2.5 pointer-events-none", palette.move)}
        style={{ left: `${(startPct + endPct) / 2}%`, transform: "translate(-50%, -50%) rotate(45deg)" }}
      />
      <div
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label="Début du passage"
        aria-valuemin={0}
        aria-valuemax={duration}
        aria-valuenow={start}
        onKeyDown={handleKeyDown("start")}
        className={cn("absolute top-1/2 w-4 h-4 rounded-full pointer-events-none focus:outline-none focus:ring-2 focus:ring-offset-0 focus:ring-current", palette.handle)}
        style={{ left: `${startPct}%`, transform: "translate(-50%, -50%)" }}
      />
      <div
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label="Fin du passage"
        aria-valuemin={0}
        aria-valuemax={duration}
        aria-valuenow={end}
        onKeyDown={handleKeyDown("end")}
        className={cn("absolute top-1/2 w-4 h-4 rounded-full pointer-events-none focus:outline-none focus:ring-2 focus:ring-offset-0 focus:ring-current", palette.handle)}
        style={{ left: `${endPct}%`, transform: "translate(-50%, -50%)" }}
      />
      {children}
    </div>
  );
}
