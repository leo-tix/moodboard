import { db } from "@/lib/db";
import { getImageUrl, getThumbnailUrl } from "@/lib/storage/urls";

// Aperçu (feed / messages) d'une visite ou collection : la cover EXPLICITE si
// définie, sinon repli sur la première image de la ressource — sans quoi la
// carte reste vide alors que la ressource contient des images.

type ImgKeys = { thumbnailKey: string | null; storageKey: string } | null | undefined;

/** URL d'aperçu d'une image (vignette si dispo), ou null. */
export function pickImgUrl(img: ImgKeys): string | null {
  if (!img) return null;
  return img.thumbnailKey ? getThumbnailUrl(img.thumbnailKey) : getImageUrl(img.storageKey);
}

const FIRST_IMAGE = { orderBy: [{ isMain: "desc" as const }, { order: "asc" as const }], take: 1, select: { thumbnailKey: true, storageKey: true } };

/** Cover d'une visite : coverKey explicite, sinon première inspiration prête. */
export async function visitCoverUrl(id: string, coverKey: string | null): Promise<string | null> {
  if (coverKey) return getImageUrl(coverKey);
  const insp = await db.inspiration.findFirst({
    where: { visitId: id, status: "READY" },
    orderBy: [{ visitOrder: "asc" }, { createdAt: "asc" }],
    select: { images: FIRST_IMAGE },
  });
  return pickImgUrl(insp?.images[0]);
}

/** Cover d'une collection : coverImageKey explicite, sinon 1re image d'item. */
export async function collectionCoverUrl(id: string, coverImageKey: string | null): Promise<string | null> {
  if (coverImageKey) return getImageUrl(coverImageKey);
  const item = await db.collectionItem.findFirst({
    where: { collectionId: id },
    orderBy: { order: "asc" },
    select: { inspiration: { select: { images: FIRST_IMAGE } } },
  });
  return pickImgUrl(item?.inspiration.images[0]);
}
