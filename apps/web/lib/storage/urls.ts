const R2_PUBLIC_URL = process.env.NEXT_PUBLIC_R2_PUBLIC_URL ?? "";

export function getImageUrl(storageKey: string): string {
  return `${R2_PUBLIC_URL}/${storageKey}`;
}

export function getThumbnailUrl(thumbnailKey: string): string {
  return `${R2_PUBLIC_URL}/${thumbnailKey}`;
}

// ── Cloudflare Image Resizing ─────────────────────────────────────────────────

// Discrete width buckets — ensures stable URLs during smooth zoom (only changes
// when crossing a boundary) and maximises Cloudflare CDN cache hit rate.
const CF_WIDTH_BUCKETS = [200, 400, 800, 1200, 1600, 2400];

/**
 * Return a Cloudflare Image Resizing URL for `storageKey`.
 *
 * `canvasW`  — element width in canvas units
 * `zoom`     — current canvas zoom
 *
 * The requested pixel width is rounded UP to the next bucket from
 * CF_WIDTH_BUCKETS so the image is never blurry, and the URL stays stable
 * across small zoom changes that don't cross a bucket boundary.
 *
 * Animated images (GIFs) must use the original URL — Cloudflare resizing
 * strips animation frames.
 */
export function getResizedImageUrl(storageKey: string, canvasW: number, zoom: number): string {
  const dpr = typeof window !== "undefined" ? (window.devicePixelRatio || 1) : 1;
  const screenPx = Math.ceil(canvasW * zoom * dpr);
  const w = CF_WIDTH_BUCKETS.find((b) => b >= screenPx) ?? CF_WIDTH_BUCKETS[CF_WIDTH_BUCKETS.length - 1];
  return `${R2_PUBLIC_URL}/cdn-cgi/image/width=${w},quality=85,format=auto/${storageKey}`;
}
