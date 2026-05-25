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

export type CanvasElement = ImageElement | TextElement | ColorElement | StickyElement | StrokeElement;

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
  createdAt: string;
  updatedAt: string;
}
