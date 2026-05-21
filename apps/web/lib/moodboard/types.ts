// Types partagés pour le canvas moodboard

export type CanvasElementBase = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  zIndex: number;
};

export type ImageElement = CanvasElementBase & {
  type: "image";
  inspirationId: string;
  storageKey: string;
  title: string;
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

export type CanvasElement = ImageElement | TextElement | ColorElement;

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
