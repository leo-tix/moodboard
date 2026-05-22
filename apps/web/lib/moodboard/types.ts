// Types partagés pour le canvas moodboard

export type CanvasElementBase = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  zIndex: number;
  opacity?: number; // 0–1, default 1
};

export type ImageElement = CanvasElementBase & {
  type: "image";
  inspirationId: string;
  storageKey: string;
  title: string;
  objectFit?: "cover" | "contain"; // default "cover"
  aspectRatio?: number; // naturalWidth / naturalHeight, used for lockAspectRatio
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

export type CanvasElement = ImageElement | TextElement | ColorElement | StickyElement;

export interface MoodboardData {
  id: string;
  title: string;
  canvasData: CanvasElement[];
  background: string;
  shareToken: string | null;
  shareExpiry: string | null;
  createdAt: string;
  updatedAt: string;
}
