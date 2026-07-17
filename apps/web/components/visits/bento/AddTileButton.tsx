"use client";

import { Plus } from "lucide-react";

// Bande d'ajout sous la grille. Elle était auparavant une tuile 1x1 DANS la
// grille (spec §5) — mais `grid-auto-flow:dense` l'aspirait dans le premier
// trou libre, donc régulièrement en haut du carnet, au milieu des blocs
// (audit 2026-07-17). Sous la grille, elle reste là où on l'attend et offre
// une cible bien plus large au doigt.
export function AddTileButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-4 md:mt-6 w-full min-h-[3.5rem] rounded-[20px] border-2 border-dashed border-[var(--border-default)] flex items-center justify-center gap-2 text-sm text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:border-[var(--text-tertiary)] transition-colors"
    >
      <Plus size={18} strokeWidth={1.75} />
      Ajouter une tuile
    </button>
  );
}
