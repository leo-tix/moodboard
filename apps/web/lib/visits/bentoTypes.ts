import type { JournalTile, JournalTileType } from "@/lib/visits/bentoSpans";
import type { WikiStructured } from "@/lib/visits/wikiArtist";

// Éléments des modules à contenu structuré (stockés en Json dans leur table).
export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

export interface TimelineEvent {
  id: string;
  dateText: string;
  label: string;
  description?: string;
}

// Année comparable extraite d'une date libre (« 1872 », « v. 1890 »,
// « Entre 1926 et 1934 », « XVIIe siècle »…) pour trier la frise. On prend la
// 1re année à 3-4 chiffres ; à défaut un siècle romain → année approx ; sinon
// +∞ (l'événement va en fin).
function timelineYear(dateText: string): number {
  const y = dateText.match(/\b(\d{3,4})\b/);
  if (y) return parseInt(y[1], 10);
  const rom = dateText.match(/\b([IVXLC]+)\s*e?\s*si[eè]cle/i);
  if (rom) {
    const map: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100 };
    const s = rom[1].toUpperCase();
    let n = 0;
    for (let i = 0; i < s.length; i++) {
      const cur = map[s[i]], nxt = map[s[i + 1]] ?? 0;
      n += cur < nxt ? -cur : cur;
    }
    return (n - 1) * 100; // XVIIe siècle → 1600
  }
  return Number.POSITIVE_INFINITY;
}

// Trie les jalons par date croissante (tri stable ; les dates illisibles
// restent en fin dans leur ordre d'origine).
export function sortTimelineEvents(events: TimelineEvent[]): TimelineEvent[] {
  return events
    .map((ev, i) => ({ ev, i, y: timelineYear(ev.dateText || "") }))
    .sort((a, b) => a.y - b.y || a.i - b.i)
    .map((x) => x.ev);
}

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
  | {
      type: "audio";
      id: string;
      storageKey: string;
      durationSec: number | null;
      transcript: string | null;
      /** Timings par mot (Whisper) pour le karaoke synchronisé — null si absents. */
      wordTimings: { word: string; start: number; end: number }[] | null;
    }
  | {
      type: "embed";
      id: string;
      kind: "LINK" | "YOUTUBE" | "ARTIST";
      url: string;
      title: string | null;
      description: string | null;
      image: string | null;
      siteName: string | null;
      /** Infobox Wikidata pour la fiche wiki (kind ARTIST). */
      data?: WikiStructured | null;
    }
  | { type: "map"; id: string; locationName: string; latitude: number; longitude: number }
  | {
      type: "cartel";
      id: string;
      artworkTitle: string;
      artist: string | null;
      dateText: string | null;
      medium: string | null;
      dimensions: string | null;
      room: string | null;
      notes: string | null;
      storageKey: string | null;
      thumbnailKey: string | null;
      width: number | null;
      height: number | null;
    }
  | { type: "palette"; id: string; title: string | null; colors: string[]; sourceKey: string | null }
  | {
      type: "ticket";
      id: string;
      eventName: string;
      place: string | null;
      dateText: string | null;
      price: string | null;
      category: string | null;
      storageKey: string | null;
      thumbnailKey: string | null;
      width: number | null;
      height: number | null;
    }
  | { type: "sketch"; id: string; storageKey: string; thumbnailKey: string | null; width: number | null; height: number | null }
  | { type: "highlight"; id: string; title: string; rating: number; note: string | null }
  | { type: "checklist"; id: string; title: string | null; items: ChecklistItem[] }
  | { type: "timeline"; id: string; title: string | null; events: TimelineEvent[] }
  | { type: "separator"; id: string; label: string };

export type BentoTile = JournalTile & { content: JournalTileContent };

export type { JournalTile, JournalTileType };
