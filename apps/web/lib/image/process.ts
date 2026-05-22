import sharp from "sharp";
import { encode } from "blurhash";

const MAX_WIDTH = 2400;
const MAX_WIDTH_ANIMATED = 1200; // limite plus basse pour les animés (perf)
const THUMB_WIDTH = 600;
const THUMB_WIDTH_ANIMATED = 400;
const QUALITY = 85;

export interface ProcessedImage {
  original: Buffer;
  thumbnail: Buffer;
  blurHash: string;
  width: number;
  height: number;
  size: number;
  isAnimated: boolean;
  mimeType: string;
}

// ── Détection animation ────────────────────────────────────────────────────────

async function detectAnimation(
  buffer: Buffer
): Promise<{ animated: boolean; format: string; width: number; height: number; pages: number }> {
  const meta = await sharp(buffer, { animated: true }).metadata();
  const pages = meta.pages ?? 1;
  const animated = pages > 1 && (meta.format === "gif" || meta.format === "webp");
  return {
    animated,
    format: meta.format ?? "unknown",
    width: meta.width ?? 0,
    // Pour les animés : pageHeight = hauteur d'une frame
    height: (animated ? meta.pageHeight : meta.height) ?? meta.height ?? 0,
    pages,
  };
}

// ── Entrée publique ────────────────────────────────────────────────────────────

export async function processImage(inputBuffer: Buffer): Promise<ProcessedImage> {
  const info = await detectAnimation(inputBuffer);
  if (info.animated) {
    return processAnimated(inputBuffer, info);
  }
  return processStatic(inputBuffer);
}

// ── Pipeline image statique (inchangé) ────────────────────────────────────────

async function processStatic(inputBuffer: Buffer): Promise<ProcessedImage> {
  const meta = await sharp(inputBuffer).metadata();
  const originalWidth = meta.width ?? MAX_WIDTH;
  const needsResize = originalWidth > MAX_WIDTH;

  const original = await sharp(inputBuffer)
    .resize(needsResize ? MAX_WIDTH : undefined, undefined, { withoutEnlargement: true })
    .webp({ quality: QUALITY })
    .toBuffer();

  const originalMeta = await sharp(original).metadata();

  const thumbnail = await sharp(inputBuffer)
    .resize(THUMB_WIDTH, undefined, { withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();

  const { data: pixelData, info: rawInfo } = await sharp(inputBuffer)
    .resize(32, 32, { fit: "inside" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const blurHash = encode(new Uint8ClampedArray(pixelData), rawInfo.width, rawInfo.height, 4, 4);

  return {
    original,
    thumbnail,
    blurHash,
    width: originalMeta.width!,
    height: originalMeta.height!,
    size: original.length,
    isAnimated: false,
    mimeType: "image/webp",
  };
}

// ── Pipeline image animée (GIF / WebP animé) ──────────────────────────────────
//
// Stratégie :
//   - original  : WebP animé, max MAX_WIDTH_ANIMATED px de large
//   - thumbnail : WebP animé réduit (THUMB_WIDTH_ANIMATED), pour galerie
//   - blurHash  : depuis la 1ère frame (statique, rapide)
//
// Les deux restent animés → l'animation est visible partout.

async function processAnimated(
  inputBuffer: Buffer,
  info: { width: number; height: number }
): Promise<ProcessedImage> {
  const needsResize = info.width > MAX_WIDTH_ANIMATED;

  // WebP animé principal
  const original = await sharp(inputBuffer, { animated: true })
    .resize(needsResize ? MAX_WIDTH_ANIMATED : undefined, undefined, {
      withoutEnlargement: true,
      kernel: sharp.kernel.lanczos2, // plus rapide pour les GIFs multi-frames
    })
    .webp({ quality: 80, effort: 4 })
    .toBuffer();

  // Métadonnées de l'original produit
  const origMeta = await sharp(original, { animated: true }).metadata();
  const width = origMeta.width!;
  const height = origMeta.pageHeight ?? origMeta.height!;

  // WebP animé miniature (pour galerie / thumbnailKey)
  const thumbnail = await sharp(inputBuffer, { animated: true })
    .resize(THUMB_WIDTH_ANIMATED, undefined, {
      withoutEnlargement: true,
      kernel: sharp.kernel.lanczos2,
    })
    .webp({ quality: 70, effort: 3 })
    .toBuffer();

  // BlurHash depuis la 1ère frame uniquement
  const { data: pixelData, info: rawInfo } = await sharp(inputBuffer, { pages: 1 })
    .resize(32, 32, { fit: "inside" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const blurHash = encode(new Uint8ClampedArray(pixelData), rawInfo.width, rawInfo.height, 4, 4);

  return {
    original,
    thumbnail,
    blurHash,
    width,
    height,
    size: original.length,
    isAnimated: true,
    mimeType: "image/webp",
  };
}
