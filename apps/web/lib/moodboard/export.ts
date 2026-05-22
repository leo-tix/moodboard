import type { CanvasElement } from "./types";

// ── Constants ─────────────────────────────────────────────────────────────────

const PAD         = 48;    // canvas-unit padding around the content bounding box
const PIXEL_RATIO = 2;     // output resolution multiplier (2× = "retina" quality)
const MAX_DIM     = 4096;  // hard cap (px) to avoid OOM on very large boards
const BORDER_R    = 8;     // canvas-unit border radius matching the editor

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Renders all canvas elements onto an offscreen HTMLCanvasElement and
 * triggers a PNG download in the browser.
 *
 * Images are fetched through /api/proxy-image so that `drawImage` never
 * taints the canvas (same-origin fetch, no CORS headers needed on R2).
 */
export async function exportMoodboardAsPng(
  elements: CanvasElement[],
  background: string,
  title: string,
): Promise<void> {
  if (typeof window === "undefined") return;

  // ── Bounding box ──────────────────────────────────────────────────────────
  if (elements.length === 0) {
    const c = makeCanvas(800, 600);
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, 800, 600);
    triggerDownload(c, title);
    return;
  }

  const minX = Math.min(...elements.map((e) => e.x)) - PAD;
  const minY = Math.min(...elements.map((e) => e.y)) - PAD;
  const maxX = Math.max(...elements.map((e) => e.x + e.w)) + PAD;
  const maxY = Math.max(...elements.map((e) => e.y + e.h)) + PAD;
  const bw = maxX - minX;
  const bh = maxY - minY;

  // Scale: try PIXEL_RATIO but clamp so neither dimension exceeds MAX_DIM
  const scale = Math.min(PIXEL_RATIO, MAX_DIM / Math.max(bw, bh));

  const canvas = makeCanvas(Math.round(bw * scale), Math.round(bh * scale));
  const ctx = canvas.getContext("2d")!;

  // ── Background ────────────────────────────────────────────────────────────
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // ── Elements (sorted by effective z-order) ────────────────────────────────
  const sorted = [...elements].sort((a, b) => {
    const az = a.type === "sticky" ? a.zIndex + 100_000 : a.zIndex;
    const bz = b.type === "sticky" ? b.zIndex + 100_000 : b.zIndex;
    return az - bz;
  });

  for (const el of sorted) {
    const x  = (el.x - minX) * scale;
    const y  = (el.y - minY) * scale;
    const w  = el.w * scale;
    const h  = el.h * scale;
    const br = BORDER_R * scale;

    ctx.save();
    ctx.globalAlpha = el.opacity ?? 1;

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

/** Loads an image via the same-origin proxy to avoid canvas CORS tainting. */
function loadProxiedImage(storageKey: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload  = () => resolve(img);
    img.onerror = reject;
    img.src = `/api/proxy-image?key=${encodeURIComponent(storageKey)}`;
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
