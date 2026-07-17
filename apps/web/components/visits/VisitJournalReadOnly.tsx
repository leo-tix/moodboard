"use client";

import { BentoGrid } from "@/components/visits/bento/BentoGrid";
import { JournalAuthorProvider } from "@/components/visits/JournalAuthorContext";
import type { BentoTile } from "@/lib/visits/bentoTypes";

// Rendu LECTURE SEULE du carnet pour la page publique — même grille bento que
// l'éditeur (BentoGrid/TileContent, mode `editable=false` : pas de drag, pas
// de menu, pas de drawer, pas de bouton "+"), contenu identique via
// TileContent (plus de duplication du rendu embed/audio entre éditeur et
// lecture seule).
export function VisitJournalReadOnly({
  tiles,
  authorName,
  authorImage,
}: {
  tiles: BentoTile[];
  /** Auteur du carnet — photo affichée sur les blocs mémo vocal. */
  authorName?: string | null;
  authorImage?: string | null;
}) {
  if (tiles.length === 0) {
    return <p className="text-sm text-[var(--text-tertiary)] py-8 text-center">Ce carnet est vide.</p>;
  }
  return (
    <JournalAuthorProvider value={{ name: authorName ?? null, image: authorImage ?? null }}>
      <BentoGrid tiles={tiles} editable={false} />
    </JournalAuthorProvider>
  );
}
