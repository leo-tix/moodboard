import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { uploadToR2 } from "@/lib/storage/r2";
import { getImageUrl } from "@/lib/storage/urls";
import { checkUploadAllowed } from "@/lib/storage/quota";

export type SaveResult = { ok: true; inspirationId: string } | { ok: false; error: string; status: number };

// Copie une image (par son id) dans la bibliothèque de `userId` : copie R2
// indépendante (chacun a la sienne, pas de comptage partagé) + nouvelle
// Inspiration/Image acceptée. L'AUTORISATION (le droit d'accéder à cette image)
// est à la charge de l'appelant — ici on ne fait que la copie.
export async function saveImageToLibrary(imageId: string, userId: string): Promise<SaveResult> {
  const img = await db.image.findUnique({
    where: { id: imageId },
    include: { inspiration: { select: { title: true, author: true, year: true } } },
  });
  if (!img) return { ok: false, error: "Introuvable", status: 404 };

  const bytes = img.size + img.thumbnailSize;
  const check = await checkUploadAllowed(userId, bytes);
  if (!check.allowed) return { ok: false, error: check.reason ?? "Quota dépassé", status: 413 };

  // Copie les octets R2 (bucket public) sous de nouvelles clés.
  const origBuf = Buffer.from(await (await fetch(getImageUrl(img.storageKey))).arrayBuffer());
  const thumbBuf = img.thumbnailKey ? Buffer.from(await (await fetch(getImageUrl(img.thumbnailKey))).arrayBuffer()) : null;
  const uuid = randomUUID();
  const storageKey = `images/${uuid}.webp`;
  const thumbnailKey = `thumbs/${uuid}.webp`;
  await uploadToR2(storageKey, origBuf, img.mimeType || "image/webp");
  if (thumbBuf) await uploadToR2(thumbnailKey, thumbBuf, "image/webp");

  const inspiration = await db.inspiration.create({
    data: { userId, title: img.inspiration.title, author: img.inspiration.author, year: img.inspiration.year, status: "READY", isAccepted: true, mediaType: "IMAGE" },
  });
  await db.image.create({
    data: {
      inspirationId: inspiration.id,
      filename: `${uuid}.webp`,
      originalName: img.originalName,
      mimeType: img.mimeType,
      size: img.size,
      thumbnailSize: thumbBuf ? img.thumbnailSize : 0,
      width: img.width,
      height: img.height,
      storageKey,
      thumbnailKey: thumbBuf ? thumbnailKey : null,
      blurHash: img.blurHash,
      isMain: true,
      isAnimated: img.isAnimated,
    },
  });

  return { ok: true, inspirationId: inspiration.id };
}
