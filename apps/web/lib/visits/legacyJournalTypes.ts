// Types de l'ANCIEN système de carnet (blocs purs + colonnes, pré-bento).
// Ne servent plus qu'au script de migration one-shot vers la grille bento
// (buildJournalItems dans journalItems.ts) — extraits de VisitJournal.tsx
// (2026-07-15) qui n'en a plus besoin depuis son passage à BentoTile/
// bentoTypes.ts.

export interface JournalImage {
  type: "image";
  id: string;
  title: string;
  author: string | null;
  year: number | null;
  thumbnailKey: string | null;
  width: number | null;
  height: number | null;
}

export interface JournalNote {
  type: "note";
  id: string;
  content: string;
}

export interface JournalTitle {
  type: "title";
  id: string;
  content: string;
}

export interface JournalQuote {
  type: "quote";
  id: string;
  content: string;
}

export interface JournalAudio {
  type: "audio";
  id: string;
  storageKey: string;
  durationSec: number | null;
  transcript: string | null;
}

export type JournalBlock = JournalImage | JournalNote | JournalTitle | JournalQuote | JournalAudio;

export interface JournalColumns {
  type: "columns";
  id: string;
  left: JournalBlock[];
  right: JournalBlock[];
}

export interface JournalEmbed {
  type: "embed";
  id: string;
  kind: "LINK" | "YOUTUBE";
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
}

export type JournalItem = JournalBlock | JournalColumns | JournalEmbed;
