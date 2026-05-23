import type { CanvasElement } from "./types";
import { buildCachedStroke, drawCachedStroke } from "./pencil";

// ── Constants ─────────────────────────────────────────────────────────────────

const PAD         = 48;    // canvas-unit padding around the content bounding box
const PIXEL_RATIO = 2;     // output resolution multiplier (2× = "retina" quality)
const MAX_DIM     = 4096;  // hard cap (px) to avoid OOM on very large boards
const BORDER_R    = 8;     // canvas-unit border radius matching the editor

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Renders all canvas elements (including StrokeElements) onto an offscreen
 * HTMLCanvasElement and triggers a PNG download in the browser.
 *
 * Images are fetched through /api/proxy-image so that `drawImage` never
 * taints the canvas (same-origin fetch, no CORS headers needed on R2).
 *
 * Stroke elements use the same Path2D cache + per-element matrix transform
 * as the live editor, so exported strokes are pixel-identical to what the
 * user sees on screen.
 */
export async function exportMoodboardAsPng(
  elements: CanvasElement[],
  background: string,
  title: string,
  { transparent = false }: { transparent?: boolean } = {},
): Promise<void> {
  if (typeof window === "undefined") return;

  if (elements.length === 0) {
    const c = makeCanvas(800, 600);
    if (!transparent) {
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, 800, 600);
    }
    triggerDownload(c, title);
    return;
  }

  // ── Bounding box (union of all elements) ──────────────────────────────────
  const allXs = elements.flatMap((e) => [e.x, e.x + e.w]);
  const allYs = elements.flatMap((e) => [e.y, e.y + e.h]);

  const minX = Math.min(...allXs) - PAD;
  const minY = Math.min(...allYs) - PAD;
  const maxX = Math.max(...allXs) + PAD;
  const maxY = Math.max(...allYs) + PAD;
  const bw = maxX - minX;
  const bh = maxY - minY;

  // Scale: try PIXEL_RATIO but clamp so neither dimension exceeds MAX_DIM
  const scale = Math.min(PIXEL_RATIO, MAX_DIM / Math.max(bw, bh));

  const canvas = makeCanvas(Math.round(bw * scale), Math.round(bh * scale));
  const ctx = canvas.getContext("2d")!;

  // ── Background ────────────────────────────────────────────────────────────
  if (!transparent) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  // ── Elements (sorted by effective z-order) ────────────────────────────────
  const sorted = [...elements].sort((a, b) => {
    const az = a.type === "sticky" ? a.zIndex + 100_000 : a.zIndex;
    const bz = b.type === "sticky" ? b.zIndex + 100_000 : b.zIndex;
    return az - bz;
  });

  // Per-export stroke cache (Path2D is built once per stroke, reused if the
  // export function is called multiple times in the same session).
  const strokeCache = new Map<string, ReturnType<typeof buildCachedStroke>>();

  for (const el of sorted) {
    ctx.save();
    ctx.globalAlpha = el.opacity ?? 1;

    if (el.type === "stroke") {
      // Per-element matrix: scale + translate from origin bbox to current bbox,
      // then convert moodboard coords → export pixel coords.
      const sid = el.stroke.id;
      if (!strokeCache.has(sid)) strokeCache.set(sid, buildCachedStroke(el.stroke));
      const cached = strokeCache.get(sid)!;

      const sx = el.originW > 0 ? el.w / el.originW : 1;
      const sy = el.originH > 0 ? el.h / el.originH : 1;
      const tx = el.x - el.originX * sx;
      const ty = el.y - el.originY * sy;

      ctx.setTransform(
        scale * sx, 0, 0, scale * sy,
        (tx - minX) * scale,
        (ty - minY) * scale,
      );
      drawCachedStroke(ctx, cached);
      ctx.restore();
      continue;
    }

    const x  = (el.x - minX) * scale;
    const y  = (el.y - minY) * scale;
    const w  = el.w * scale;
    const h  = el.h * scale;
    const br = BORDER_R * scale;

    if (el.type === "color") {
      ctx.fillStyle = el.color;
      roundRect(ctx, x, y, w, h, br);
      ctx.fill();
    }

    else if (el.type === "sticky") {
      // Background
      ctx.fillStyle = el.backgroundColor;
      roundRect(ctx, x, y, w, h, br);
      ctx.fill();
      // Text
      ctx.fillStyle = el.textColor;
      const fs      = Math.round(13 * scale);
      const lh      = fs * 1.45;
      const pad     = 12 * scale;
      ctx.font      = `${fs}px system-ui, -apple-system, sans-serif`;
      ctx.textBaseline = "top";
      drawWrappedText(ctx, el.content, x + pad, y + pad, w - pad * 2, lh);
    }

    else if (el.type === "text") {
      const fs    = Math.round(el.fontSize * scale);
      const lh    = fs * 1.4;
      const style = el.italic ? "italic " : "";
      const wt    = el.bold   ? "bold "   : "";
      ctx.font    = `${style}${wt}${fs}px system-ui, -apple-system, sans-serif`;
      ctx.fillStyle    = el.color;
      ctx.textBaseline = "top";
      drawWrappedText(ctx, el.content, x + 4 * scale, y + 4 * scale, w - 8 * scale, lh);
    }

    else if (el.type === "image") {
      try {
        const img = await loadProxiedImage(el.storageKey);
        roundRect(ctx, x, y, w, h, br);
        ctx.clip();
        drawImageCover(ctx, img, x, y, w, h, el.objectFit ?? "cover");
      } catch {
        // Image failed — grey placeholder so export still completes
        ctx.fillStyle = "rgba(120,120,140,0.3)";
        roundRect(ctx, x, y, w, h, br);
        ctx.fill();
      }
    }

    ctx.restore();
  }

  // Reset transform after all strokes (which may have set non-identity transforms)
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  triggerDownload(canvas, title);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width  = w;
  c.height = h;
  return c;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.quadraticCurveTo(x + w, y,     x + w, y + rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  ctx.lineTo(x + rad, y + h);
  ctx.quadraticCurveTo(x,     y + h, x, y + h - rad);
  ctx.lineTo(x, y + rad);
  ctx.quadraticCurveTo(x,     y,     x + rad, y);
  ctx.closePath();
}

function drawImageCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  dx: number, dy: number, dw: number, dh: number,
  fit: "cover" | "contain",
) {
  if (fit === "contain") {
    ctx.drawImage(img, dx, dy, dw, dh);
    return;
  }
  // object-fit: cover — crop to fill
  const ir = img.naturalWidth / img.naturalHeight;
  const dr = dw / dh;
  let sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight;
  if (ir > dr) {
    sw = sh * dr;
    sx = (img.naturalWidth  - sw) / 2;
  } else {
    sh = sw / dr;
    sy = (img.naturalHeight - sh) / 2;
  }
  ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
}

/** Wraps text at word boundaries, respects \n line breaks. */
function drawWrappedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number, y: number,
  maxW: number, lineH: number,
) {
  let curY = y;
  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(" ");
    let line = "";
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxW && line) {
        ctx.fillText(line, x, curY);
        line  = word;
        curY += lineH;
      } else {
        line = test;
      }
    }
    if (line) ctx.fillText(line, x, curY);
    curY += lineH;
  }
}

/**
 * Loads an image for use in canvas drawImage (no CORS tainting).
 *
 * Strategy:
 *  1. Try R2 CDN directly with crossOrigin="anonymous" — zero Vercel bandwidth
 *     when the R2 bucket has CORS configured for the current origin.
 *  2. On failure (local dev, missing CORS header, network error) fall back to
 *     the same-origin proxy /api/proxy-image which always works.
 *
 * This means the function is transparent to environment — no config change
 * needed between local dev and production.
 */
function loadProxiedImage(storageKey: string): Promise<HTMLImageElement> {
  const base     = process.env.NEXT_PUBLIC_R2_PUBLIC_URL ?? "";
  const directUrl = `${base}/${storageKey}`;
  const proxyUrl  = `/api/proxy-image?key=${encodeURIComponent(storageKey)}`;

  return new Promise((resolve, reject) => {
    // Attempt 1 — direct R2 with CORS
    const direct = new Image();
    direct.crossOrigin = "anonymous";
    direct.onload  = () => resolve(direct);
    direct.onerror = () => {
      // Attempt 2 — same-origin proxy (local dev, CORS not yet configured, etc.)
      console.warn(`[export] CORS failed for ${storageKey}, falling back to proxy`);
      const proxy = new Image();
      proxy.onload  = () => resolve(proxy);
      proxy.onerror = () => reject(new Error(`Failed to load image: ${storageKey}`));
      proxy.src = proxyUrl;
    };
    direct.src = directUrl;
  });
}

function triggerDownload(canvas: HTMLCanvasElement, title: string) {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a   = document.createElement("a");
    a.href     = url;
    a.download = `${title.replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-") || "planche"}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, "image/png");
}
