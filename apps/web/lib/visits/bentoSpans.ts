// Grille modulaire façon Bento.me — formats de tuile.
//
// Deux régimes (audit 2026-07-18) :
// - MÉDIA (image, audio, embed, carte, cartel, palette, billet, croquis,
//   coup de cœur) : 4 formats fixes uniformes (Carré/Large/Vertical/Grand).
//   La hauteur est décidée par le format.
// - AUTO-HAUTEUR (note, checklist, frise) : la LARGEUR est choisie
//   (Normal/Large), la HAUTEUR est automatique — la tuile s'étend par paliers
//   de grille (row-span 1, 2, 3, 4…) pour tout afficher sans jamais couper.
//   `h` porte alors la dernière valeur mesurée (voir useMeasuredRows dans
//   BentoTile).

// Types de tuile du carnet. Le module texte unique `note` (titre/paragraphe/
// citation = options de formatage depuis 2026-07-18) ; les modules « musée »
// (cartel/palette/ticket/sketch/highlight/checklist/timeline) ajoutés le
// 2026-07-18. La fiche artiste réutilise le type `embed` (kind ARTIST).
export type JournalTileType =
  | "image"
  | "note"
  | "audio"
  | "embed"
  | "map"
  | "cartel"
  | "palette"
  | "ticket"
  | "sketch"
  | "highlight"
  | "checklist"
  | "timeline";

export type TileWidth = 1 | 2;

export interface TileSpan {
  w: TileWidth;
  // 1|2 pour les médias (format), 1..N pour l'auto-hauteur (texte/liste/frise).
  h: number;
}

export interface JournalTile {
  type: JournalTileType;
  id: string;
  w: TileWidth;
  h: number;
}

// Types à hauteur automatique (largeur choisie, hauteur mesurée). Leur contenu
// est de longueur variable → on les laisse s'étendre par paliers de grille.
// `cartel` en fait partie (2026-07-19) : une longue description/notes doit
// rester entièrement lisible, comme le module texte.
const AUTO_HEIGHT_TYPES = new Set<JournalTileType>(["note", "checklist", "timeline", "cartel"]);

export function isAutoHeight(type: JournalTileType): boolean {
  return AUTO_HEIGHT_TYPES.has(type);
}

// Le module texte riche (Tiptap) — édition inline sur desktop. Distinct des
// autres types auto-hauteur (checklist/frise) qui s'éditent via le pop-up.
export function isNoteType(type: JournalTileType): boolean {
  return type === "note";
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

// Auto-hauteur : uniquement la largeur (la hauteur est automatique).
export const TEXT_WIDTHS: FormatOption[] = [
  { w: 1, h: 1, label: "Normal", icon: "square" },
  { w: 2, h: 1, label: "Large", icon: "wide" },
];

export function formatOptions(type: JournalTileType): FormatOption[] {
  return isAutoHeight(type) ? TEXT_WIDTHS : MEDIA_FORMATS;
}

export const DEFAULT_SPAN: Record<JournalTileType, TileSpan> = {
  image: { w: 1, h: 1 },
  note: { w: 2, h: 1 },
  audio: { w: 1, h: 1 },
  embed: { w: 2, h: 2 },
  map: { w: 2, h: 1 },
  cartel: { w: 1, h: 1 },
  palette: { w: 2, h: 1 },
  ticket: { w: 2, h: 1 },
  sketch: { w: 1, h: 1 },
  highlight: { w: 1, h: 1 },
  checklist: { w: 2, h: 1 },
  timeline: { w: 2, h: 1 },
};

// Placement dans la grille — style inline plutôt que classes Tailwind : `h`
// peut dépasser 6 (contenu long auto-étendu) et Tailwind ne génère les
// utilitaires row-span que jusqu'à 6. `span` reste identique à tous les
// breakpoints (seul le NOMBRE de colonnes de la grille change).
export function spanStyle(w: TileWidth, h: number): React.CSSProperties {
  return { gridColumn: `span ${w}`, gridRow: `span ${Math.max(1, Math.round(h))}` };
}

export function tileKey(tile: { type: string; id: string }): string {
  return `${tile.type}-${tile.id}`;
}
