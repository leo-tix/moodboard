const R2_PUBLIC_URL = process.env.NEXT_PUBLIC_R2_PUBLIC_URL ?? "";

export function getImageUrl(storageKey: string): string {
  return `${R2_PUBLIC_URL}/${storageKey}`;
}

export function getThumbnailUrl(thumbnailKey: string): string {
  return `${R2_PUBLIC_URL}/${thumbnailKey}`;
}

