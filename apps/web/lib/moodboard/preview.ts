import type { CanvasElement } from "@/lib/moodboard/types";

const MAX_PREVIEW_ELEMENTS = 24;

/**
 * Trims a board's canvasData down to a fixed cap for grid-thumbnail rendering.
 * Boards can hold 100+ images; rendering every one as a real <img> in a small
 * preview tile is both invisible at that scale and the main cause of the
 * planches page loading slowly as the board count grows. Keeps the largest
 * elements (most visually significant at thumbnail scale), then restores
 * z-index order so stacking still looks right.
 */
export function capCanvasForPreview(canvasData: CanvasElement[]): CanvasElement[] {
  if (canvasData.length <= MAX_PREVIEW_ELEMENTS) return canvasData;

  const byArea = [...canvasData].sort((a, b) => b.w * b.h - a.w * a.h);
  const kept = byArea.slice(0, MAX_PREVIEW_ELEMENTS);
  const keptIds = new Set(kept.map((e) => e.id));

  return canvasData.filter((e) => keptIds.has(e.id));
}
