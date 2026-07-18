// Extraction des couleurs dominantes d'une image, côté CLIENT (canvas) — pour
// le module Palette du carnet (Phase 6, 2026-07-18). Aucune dépendance : on
// dessine l'image réduite sur un canvas, on quantifie les pixels dans une
// grille RGB grossière, et on renvoie les N teintes les plus fréquentes.

function toHex(n: number): string {
  return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
}

export async function extractPalette(file: File | Blob, count = 6): Promise<string[]> {
  const bitmap = await createImageBitmap(file);
  // Réduction : ~90px de large suffit pour les teintes dominantes et reste rapide.
  const scale = Math.min(1, 90 / bitmap.width);
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) { bitmap.close?.(); return []; }
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  const { data } = ctx.getImageData(0, 0, w, h);

  // Quantification en grille 5×5×5 (accumulateur de somme + comptage par case).
  const LEVELS = 5;
  const step = 256 / LEVELS;
  const buckets = new Map<number, { r: number; g: number; b: number; n: number }>();
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a < 125) continue; // ignore les pixels transparents
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const key = Math.floor(r / step) * LEVELS * LEVELS + Math.floor(g / step) * LEVELS + Math.floor(b / step);
    const acc = buckets.get(key);
    if (acc) { acc.r += r; acc.g += g; acc.b += b; acc.n++; }
    else buckets.set(key, { r, g, b, n: 1 });
  }

  const sorted = [...buckets.values()].sort((a, b) => b.n - a.n).slice(0, count);
  return sorted.map((c) => `#${toHex(c.r / c.n)}${toHex(c.g / c.n)}${toHex(c.b / c.n)}`);
}
