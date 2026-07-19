// Types partagés pour le canvas moodboard

// ── Apple Pencil stroke types ──────────────────────────────────────────────

export type PencilTool = "pen" | "marker" | "eraser";

export interface StrokePoint {
  x: number;        // moodboard canvas coordinates
  y: number;
  pressure: number; // 0–1
  tiltX?: number;
  tiltY?: number;
}

export interface Stroke {
  id: string;
  tool: PencilTool;
  color: string;
  width: number;    // base width in canvas units
  points: StrokePoint[];
}

export type CanvasElementBase = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  zIndex: number;
  opacity?: number; // 0–1, default 1
  groupId?: string; // elements sharing a groupId form a logical group
  locked?: boolean; // true → drag/resize disabled; still selectable
};

export type ImageElement = CanvasElementBase & {
  type: "image";
  inspirationId: string;
  storageKey: string;
  /** WebP thumbnail (max 600 px wide) stored in the "thumbs/" prefix of R2. */
  thumbnailKey?: string;
  title: string;
  objectFit?: "cover" | "contain"; // default "cover"
  aspectRatio?: number; // naturalWidth / naturalHeight, used for lockAspectRatio
  isAnimated?: boolean; // true → use <img> instead of Next.js <Image>
};

export type TextElement = CanvasElementBase & {
  type: "text";
  content: string;
  fontSize: number;
  color: string;
  bold: boolean;
  italic: boolean;
  textAlign?: "left" | "center" | "right";
};

export type ColorElement = CanvasElementBase & {
  type: "color";
  color: string;
};

export type StickyElement = CanvasElementBase & {
  type: "sticky";
  content: string;
  backgroundColor: string; // fond coloré
  textColor: string;
};

/**
 * A committed Apple Pencil stroke that behaves exactly like any other canvas element.
 *
 * The stroke points are stored in ORIGINAL canvas coordinates and never mutated
 * after commit.  Moving / resizing only updates x/y/w/h; the canvas renderer derives
 * the correct matrix transform from (x,y,w,h) vs (originX,originY,originW,originH).
 */
export type StrokeElement = CanvasElementBase & {
  type: "stroke";
  /** Raw stroke data — points in original canvas coords, never modified post-commit */
  stroke: Stroke;
  /** Bounding box at commit time — used to compute the render transform on move/resize */
  originX: number;
  originY: number;
  originW: number;
  originH: number;
};

/** A geometric shape drawn on the canvas (rectangle, ellipse, diamond). */
export type ShapeElement = CanvasElementBase & {
  type: "shape";
  shape: "rectangle" | "ellipse" | "diamond";
  fillColor: string;       // "transparent" = no fill
  strokeColor: string;
  strokeWidth: number;     // px in canvas units
  strokeStyle: "solid" | "dashed" | "dotted";
  cornerRadius?: number;   // for rectangles only
  label?: string;          // optional text inside the shape
  fontSize?: number;
  labelColor?: string;
};

export type LinearPoint = { x: number; y: number };

/**
 * A line or arrow drawn on the canvas.
 * Points are stored in canvas units, relative to (element.x, element.y).
 * element.x/y is the top-left of the bounding box of all points.
 * element.w/h is the size of that bounding box.
 */
export type LinearElement = CanvasElementBase & {
  type: "linear";
  subtype: "line" | "arrow";
  /** Relative to (element.x, element.y) */
  points: LinearPoint[];
  strokeColor: string;
  strokeWidth: number;
  strokeStyle: "solid" | "dashed" | "dotted";
  startArrowhead: "none" | "arrow" | "bar";
  endArrowhead: "none" | "arrow" | "bar";
};

/**
 * Mémo vocal enregistré directement sur la planche (2026-07-14) — reprend le
 * mécanisme du carnet de visite (VoiceMemoRecorder, AudioPlayer/waveform
 * réactive partagée). Le storageKey/durée/transcript vivent en base
 * (MoodboardAudio, cascade delete + purge R2 explicite) : l'élément canvas
 * ne référence que `audioId` + la position/taille, pas les données audio
 * elles-mêmes — cohérent avec le fait qu'un mémo est un NOUVEL upload R2
 * (contrairement à un ImageElement, qui référence une image déjà existante
 * de la bibliothèque).
 */
export type AudioElement = CanvasElementBase & {
  type: "audio";
  audioId: string; // MoodboardAudio.id
  storageKey: string;
  durationSec: number | null;
  transcript?: string | null;
  /** Timings par mot (Whisper) pour le karaoke synchronisé — dénormalisés dans
   *  le canvas comme le transcript ; null/absent → estimation. */
  wordTimings?: { word: string; start: number; end: number }[] | null;
  /** Auteur du mémo — dénormalisé au moment de la création pour l'avatar
   *  affiché sur le bloc, sans jointure supplémentaire à l'affichage. */
  authorName?: string | null;
  authorImage?: string | null; // storageKey R2 de l'avatar, comme User.image
};

export type CanvasElement = ImageElement | TextElement | ColorElement | StickyElement | StrokeElement | ShapeElement | LinearElement | AudioElement;

export interface MoodboardData {
  id: string;
  title: string;
  /** All canvas elements, including StrokeElements (converted from legacy pencilStrokes on load) */
  canvasData: CanvasElement[];
  /**
   * Legacy field — only present on boards created before the StrokeElement migration.
   * Converted to StrokeElements at load time in edit/page.tsx; never written to for new strokes.
   */
  pencilStrokes?: Stroke[];
  background: string;
  shareToken: string | null;
  shareExpiry: string | null;
  order: number;
  folderId: string | null;
  /** Total image count on the real board — canvasData above may be trimmed for preview */
  imageCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface MoodboardFolderData {
  id: string;
  name: string;
  order: number;
}
