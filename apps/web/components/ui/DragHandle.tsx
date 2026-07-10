"use client";

import { cn } from "@/lib/utils";
import type { DragHandleProps } from "@/hooks/useDragHandle";

interface Props extends DragHandleProps {
  className?: string;
  title?: string;
}

/**
 * Poignée de drag ⠿ — réservée au tactile (voir useDragHandle pour le
 * pourquoi). Sur souris, l'élément parent est saisissable n'importe où et
 * cette poignée reste masquée (`hidden pointer-coarse:flex`).
 */
export function DragHandle({ className, title, ...handleProps }: Props) {
  return (
    <div
      {...handleProps}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
      className={cn(
        "hidden pointer-coarse:flex items-center justify-center",
        "w-7 h-7 rounded-full bg-black/60 backdrop-blur-sm opacity-70",
        "cursor-grab active:cursor-grabbing",
        className
      )}
      title={title ?? "Glisser"}
    >
      <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" className="text-white">
        <circle cx="3" cy="2.5" r="1.1" /><circle cx="9" cy="2.5" r="1.1" />
        <circle cx="3" cy="6" r="1.1" /><circle cx="9" cy="6" r="1.1" />
        <circle cx="3" cy="9.5" r="1.1" /><circle cx="9" cy="9.5" r="1.1" />
      </svg>
    </div>
  );
}
