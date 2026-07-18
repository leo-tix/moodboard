// Grille modulaire façon Bento.me — formats de tuile.
//
// Deux régimes (audit 2026-07-18) :
// - MÉDIA (image, audio, embed, carte) : 4 formats fixes uniformes
//   (Carré/Large/Vertical/Grand). La hauteur est décidée par le format.
// - TEXTE (titre, note, citation) : la LARGEUR est choisie (Normal/Large),
//   la HAUTEUR est automatique — la tuile s'étend par paliers de grille
//   (row-span 1, 2, 3, 4…) pour tout afficher sans jamais couper. `h` porte
//   alors la dernière valeur mesurée (voir useMeasuredRows dans BentoTile).

export type JournalTileType = "image" | "note" | "title" | "quote" | "audio" | "embed" | "map";

export type TileWidth = 1 | 2;

export interface TileSpan {
  w: TileWidth;
  // 1|2 pour les médias (format), 1..N pour le texte (auto-hauteur).
  h: number;
}

export interface JournalTile {
  type: JournalTileType;
  id: string;
  w: TileWidth;
  h: number;
}

export function isTextType(type: JournalTileType): boolean {
  return type === "title" || type === "note" || type === "quote";
}

export type FormatIcon = "square" | "wide" | "tall" | "big";

export interface FormatOption {
  w: TileWidth;
  h: 1 | 2;
  label: string;
  icon: FormatIcon;
}

// Médias : 4 formats uniformes proposés partout (demande utilisateur
// 2026-07-18 : "uniformisé pour tous les modules").
export const MEDIA_FORMATS: FormatOption[] = [
  { w: 1, h: 1, label: "Carré", icon: "square" },
  { w: 2, h: 1, label: "Large", icon: "wide" },
  { w: 1, h: 2, label: "Vertical", icon: "tall" },
  { w: 2, h: 2, label: "Grand", icon: "big" },
];

// Texte : uniquement la largeur (la hauteur est automatique).
export const TEXT_WIDTHS: FormatOption[] = [
  { w: 1, h: 1, label: "Normal", icon: "square" },
  { w: 2, h: 1, label: "Large", icon: "wide" },
];

export function formatOptions(type: JournalTileType): FormatOption[] {
  return isTextType(type) ? TEXT_WIDTHS : MEDIA_FORMATS;
}

export const DEFAULT_SPAN: Record<JournalTileType, TileSpan> = {
  image: { w: 1, h: 1 },
  note: { w: 2, h: 1 },
  title: { w: 2, h: 1 },
  quote: { w: 2, h: 1 },
  audio: { w: 1, h: 1 },
  embed: { w: 2, h: 2 },
  map: { w: 2, h: 1 },
};

// Placement dans la grille — style inline plutôt que classes Tailwind : `h`
// peut dépasser 6 (texte long auto-étendu) et Tailwind ne génère les
// utilitaires row-span que jusqu'à 6. `span` reste identique à tous les
// breakpoints (seul le NOMBRE de colonnes de la grille change).
export function spanStyle(w: TileWidth, h: number): React.CSSProperties {
  return { gridColumn: `span ${w}`, gridRow: `span ${Math.max(1, Math.round(h))}` };
}

export function tileKey(tile: { type: string; id: string }): string {
  return `${tile.type}-${tile.id}`;
}
