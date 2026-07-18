import { uploadToR2 } from "@/lib/storage/r2";
import { processImage } from "@/lib/image/process";
import { checkUploadAllowed, checkMimeType } from "@/lib/storage/quota";
import { randomUUID } from "crypto";

// Upload d'une photo attachée à une tuile bento (cartel, billet…). Réutilise le
// pipeline d'image existant (sharp → webp + vignette) et le contrôle de quota.
// Renvoie les clés R2 à stocker sur la tuile, ou une erreur typée à relayer.

export interface UploadedTilePhoto {
  storageKey: string;
  thumbnailKey: string;
  width: number;
  height: number;
}

export type TilePhotoResult =
  | { ok: true; photo: UploadedTilePhoto }
  | { ok: false; status: number; error: string };

export async function uploadTilePhoto(userId: string, file: File): Promise<TilePhotoResult> {
  if (!checkMimeType(file.type)) {
    return { ok: false, status: 400, error: "Type non supporté. Acceptés : JPG, PNG, WebP, GIF, AVIF" };
  }
  const pre = await checkUploadAllowed(userId, file.size);
  if (!pre.allowed) return { ok: false, status: 413, error: pre.reason ?? "Quota dépassé" };

  const buffer = Buffer.from(await file.arrayBuffer());
  const processed = await processImage(buffer);

  const post = await checkUploadAllowed(userId, processed.size);
  if (!post.allowed) return { ok: false, status: 413, error: post.reason ?? "Quota dépassé" };

  const uuid = randomUUID();
  const storageKey = `images/${uuid}.webp`;
  const thumbnailKey = `thumbs/${uuid}.webp`;
  await Promise.all([
    uploadToR2(storageKey, processed.original, "image/webp"),
    uploadToR2(thumbnailKey, processed.thumbnail, "image/webp"),
  ]);
  return { ok: true, photo: { storageKey, thumbnailKey, width: processed.width, height: processed.height } };
}
