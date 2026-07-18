import type { JournalTile, JournalTileType } from "@/lib/visits/bentoSpans";

// Contenu résolu d'une tuile — même forme que les anciens JournalBlock/
// JournalEmbed (VisitJournal.tsx), unifiés en un seul type discriminé
// puisque la grille bento n'a plus besoin de distinguer "bloc pur" vs
// "embed top-level uniquement" (les colonnes qui justifiaient cette
// distinction ont disparu).
export type JournalTileContent =
  | {
      type: "image";
      id: string;
      title: string;
      author: string | null;
      year: number | null;
      thumbnailKey: string | null;
      width: number | null;
      height: number | null;
    }
  | { type: "note"; id: string; content: string }
  | { type: "audio"; id: string; storageKey: string; durationSec: number | null; transcript: string | null }
  | {
      type: "embed";
      id: string;
      kind: "LINK" | "YOUTUBE";
      url: string;
      title: string | null;
      description: string | null;
      image: string | null;
      siteName: string | null;
    }
  | { type: "map"; id: string; locationName: string; latitude: number; longitude: number };

export type BentoTile = JournalTile & { content: JournalTileContent };

export type { JournalTile, JournalTileType };
