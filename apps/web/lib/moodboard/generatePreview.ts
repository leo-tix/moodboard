import sharp from "sharp";
import { getImageUrl } from "@/lib/storage/urls";
import type { CanvasElement } from "@/lib/moodboard/types";

// Génère une VIGNETTE (webp) d'une planche côté serveur, sans navigateur ni
// canvas : on récupère les miniatures R2 et on les composite avec sharp. Le
// résultat est stocké sur R2 (previewKey) → les listes affichent l'aperçu via
// une simple <img> au lieu de télécharger tout `canvasData` (economie d'egress).
//
// La mise en page reproduit MoodboardPreview : boîte englobante de tous les
// éléments, mise à l'échelle pour tenir dans le cadre 16:9 avec une marge.

const OUT_W = 800;
const OUT_H = 450;
const PAD = OUT_W * 0.05;
const MAX_ELEMENTS = 80;

type RGBA = { r: number; g: number; b: number; alpha: number };

function hexToRgba(hex: string, alpha = 1): RGBA {
  let h = (hex || "").trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length === 8) {
    const a = parseInt(h.slice(6, 8), 16) / 255;
    h = h.slice(0, 6);
    alpha = a;
  }
  if (h.length !== 6 || /[^0-9a-fA-F]/.test(h)) return { r: 20, g: 20, b: 20, alpha };
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), alpha };
}

async function fetchBuffer(url: string): Promise<Buffer | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return Buffer.from(await r.arrayBuffer());
  } catch {
    return null;
  }
}

/** Retourne le webp de l'aperçu, ou null si la planche est vide / échec total. */
export async function generateBoardPreview(canvasData: CanvasElement[], background: string): Promise<Buffer | null> {
  const els = (canvasData ?? []).filter((e) => e && typeof e.x === "number");
  if (els.length === 0) return null;

  const minX = Math.min(...els.map((e) => e.x));
  const minY = Math.min(...els.map((e) => e.y));
  const maxX = Math.max(...els.map((e) => e.x + e.w));
  const maxY = Math.max(...els.map((e) => e.y + e.h));
  const bw = Math.max(1, maxX - minX);
  const bh = Math.max(1, maxY - minY);
  const scale = Math.min((OUT_W - PAD * 2) / bw, (OUT_H - PAD * 2) / bh);
  const offsetX = (OUT_W - bw * scale) / 2;
  const offsetY = (OUT_H - bh * scale) / 2;

  const sorted = [...els]
    .sort((a, b) => {
      const az = a.type === "sticky" ? a.zIndex + 100000 : a.zIndex;
      const bz = b.type === "sticky" ? b.zIndex + 100000 : b.zIndex;
      return az - bz;
    })
    .slice(0, MAX_ELEMENTS);

  const composites: sharp.OverlayOptions[] = [];

  for (const el of sorted) {
    let px = Math.round((el.x - minX) * scale + offsetX);
    let py = Math.round((el.y - minY) * scale + offsetY);
    let pw = Math.round(el.w * scale);
    let ph = Math.round(el.h * scale);
    // Clamp dans le cadre (sharp refuse un composite qui déborde).
    px = Math.max(0, Math.min(px, OUT_W - 1));
    py = Math.max(0, Math.min(py, OUT_H - 1));
    pw = Math.max(1, Math.min(pw, OUT_W - px));
    ph = Math.max(1, Math.min(ph, OUT_H - py));

    if (el.type === "image") {
      const key = el.thumbnailKey ?? el.storageKey;
      const buf = await fetchBuffer(getImageUrl(key));
      if (!buf) continue;
      try {
        const resized = await sharp(buf)
          .resize(pw, ph, { fit: el.objectFit === "contain" ? "contain" : "cover", background: { r: 0, g: 0, b: 0, alpha: 0 } })
          .toBuffer();
        composites.push({ input: resized, left: px, top: py });
      } catch { /* image illisible → ignorée */ }
      continue;
    }

    // Blocs pleins (couleur / sticky / forme) et texte (léger) → rectangle.
    let fill: RGBA | null = null;
    if (el.type === "color") fill = hexToRgba(el.color);
    else if (el.type === "sticky") fill = hexToRgba(el.backgroundColor);
    else if (el.type === "shape" && el.fillColor && el.fillColor !== "transparent") fill = hexToRgba(el.fillColor);
    else if (el.type === "text") fill = { ...hexToRgba(el.color), alpha: 0.15 };
    if (!fill) continue;

    try {
      const rect = await sharp({ create: { width: pw, height: ph, channels: 4, background: fill } }).png().toBuffer();
      composites.push({ input: rect, left: px, top: py });
    } catch { /* skip */ }
  }

  const bg = hexToRgba(background || "#0a0a0a", 1);
  return sharp({ create: { width: OUT_W, height: OUT_H, channels: 4, background: bg } })
    .composite(composites)
    .webp({ quality: 72 })
    .toBuffer();
}
