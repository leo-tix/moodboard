// Grille modulaire façon Bento.me (2026-07-15) — formats de tuile autorisés
// par type de bloc. La poignée de resize (BentoTile.tsx) cycle à travers
// WIDGET_SPANS[type] au clic, jamais de dimension libre.

export type JournalTileType = "image" | "note" | "title" | "quote" | "audio" | "embed" | "map";

export interface TileSpan {
  w: 1 | 2;
  h: 1 | 2;
}

export interface JournalTile {
  type: JournalTileType;
  id: string;
  w: 1 | 2;
  h: 1 | 2;
}

export const WIDGET_SPANS: Record<JournalTileType, TileSpan[]> = {
  image: [{ w: 1, h: 1 }, { w: 2, h: 1 }, { w: 1, h: 2 }, { w: 2, h: 2 }],
  note: [{ w: 2, h: 1 }, { w: 2, h: 2 }, { w: 1, h: 1 }],
  title: [{ w: 2, h: 1 }, { w: 1, h: 1 }],
  quote: [{ w: 2, h: 1 }, { w: 2, h: 2 }, { w: 1, h: 1 }],
  // AudioBlockCard est déjà pensé carré (voir AudioBlockCard.tsx `square`).
  audio: [{ w: 1, h: 1 }, { w: 2, h: 2 }],
  // YouTube veut du 16:9 large — pas de format 1x1/1x2.
  embed: [{ w: 2, h: 2 }, { w: 2, h: 1 }],
  map: [{ w: 2, h: 1 }, { w: 2, h: 2 }],
};

export const DEFAULT_SPAN: Record<JournalTileType, TileSpan> = {
  image: { w: 1, h: 1 },
  note: { w: 2, h: 1 },
  title: { w: 2, h: 1 },
  quote: { w: 2, h: 1 },
  audio: { w: 1, h: 1 },
  embed: { w: 2, h: 2 },
  map: { w: 2, h: 1 },
};

// Cycle vers le format suivant autorisé pour ce type (retombe sur le premier
// une fois le dernier atteint).
export function nextSpan(type: JournalTileType, current: TileSpan): TileSpan {
  const spans = WIDGET_SPANS[type];
  const idx = spans.findIndex((s) => s.w === current.w && s.h === current.h);
  return spans[(idx + 1) % spans.length] ?? spans[0];
}

// Classes Tailwind figées (col-span-{n}/row-span-{n} doivent apparaître en
// toutes lettres dans le code source pour être générées — pas de
// construction dynamique de nom de classe).
const SPAN_CLASSES: Record<string, string> = {
  "1x1": "col-span-1 row-span-1",
  "2x1": "col-span-2 row-span-1",
  "1x2": "col-span-1 row-span-2",
  "2x2": "col-span-2 row-span-2",
};

export function spanClass(w: 1 | 2, h: 1 | 2): string {
  return SPAN_CLASSES[`${w}x${h}`] ?? SPAN_CLASSES["1x1"];
}

export function tileKey(tile: { type: string; id: string }): string {
  return `${tile.type}-${tile.id}`;
}
