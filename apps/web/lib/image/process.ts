import sharp from "sharp";
import { encode } from "blurhash";

const MAX_WIDTH = 2400;
const THUMB_WIDTH = 600;
const QUALITY = 85;

export interface ProcessedImage {
  original: Buffer;
  thumbnail: Buffer;
  blurHash: string;
  width: number;
  height: number;
  size: number;
}

// Compresse + génère thumbnail + blurHash
export async function processImage(inputBuffer: Buffer): Promise<ProcessedImage> {
  const image = sharp(inputBuffer);
  const metadata = await image.metadata();

  const originalWidth = metadata.width ?? MAX_WIDTH;
  const needsResize = originalWidth > MAX_WIDTH;

  // Image originale compressée en WebP
  const original = await sharp(inputBuffer)
    .resize(needsResize ? MAX_WIDTH : undefined, undefined, {
      withoutEnlargement: true,
    })
    .webp({ quality: QUALITY })
    .toBuffer();

  const originalMeta = await sharp(original).metadata();
  const width = originalMeta.width!;
  const height = originalMeta.height!;

  // Thumbnail WebP
  const thumbnail = await sharp(inputBuffer)
    .resize(THUMB_WIDTH, undefined, { withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();

  // BlurHash depuis une version très petite (perf)
  const { data: pixelData, info } = await sharp(inputBuffer)
    .resize(32, 32, { fit: "inside" })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const blurHash = encode(
    new Uint8ClampedArray(pixelData),
    info.width,
    info.height,
    4,
    4
  );

  return {
    original,
    thumbnail,
    blurHash,
    width,
    height,
    size: original.length,
  };
}
