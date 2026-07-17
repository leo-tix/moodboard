"use client";

import { Plus } from "lucide-react";

// Dernière tuile de la grille en mode édition — format 1x1, bordure
// pointillée, ouvre le picker de type (spec §5 : "se fond dans la grille").
export function AddTileButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="col-span-1 row-span-1 rounded-[20px] border-2 border-dashed border-[var(--border-default)] flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:border-[var(--text-tertiary)] transition-colors"
      title="Ajouter une tuile"
    >
      <Plus size={22} strokeWidth={1.75} />
    </button>
  );
}
