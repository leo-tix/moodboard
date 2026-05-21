import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import sharp from "sharp";

export const maxDuration = 30;

// Each mosaic tile is 480×270 (16:9). A 2×2 grid → 960×540 output.
const TILE_W = 480;
const TILE_H = 270;

// ─── Route ────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { frameUrls, frameLabels, mode } = (await req.json()) as {
    frameUrls: string[];
    frameLabels: string[];
    mode: "stills" | "mosaic";
  };

  if (!frameUrls?.length) {
    return NextResponse.json({ error: "Paramètres manquants" }, { status: 400 });
  }

  // ── Fetch + resize every frame to tile size ────────────────────────────────
  const tiles = await Promise.all(
    frameUrls.map(async (url, i) => {
      try {
        const res = await fetch(url);
        if (!res.ok) return null;
        const buf = Buffer.from(await res.arrayBuffer());
        const resized = await sharp(buf)
          .resize(TILE_W, TILE_H, { fit: "cover", position: "center" })
          .jpeg({ quality: 88 })
          .toBuffer();
        return { buffer: resized, label: frameLabels?.[i] ?? String(i) };
      } catch {
        return null;
      }
    })
  );

  const validTiles = tiles.filter(
    (t): t is { buffer: Buffer; label: string } => t !== null
  );

  if (!validTiles.length) {
    return NextResponse.json({ error: "Impossible de charger les images" }, { status: 500 });
  }

  // ── Mosaic: compose 2×2 grid with Sharp ───────────────────────────────────
  if (mode === "mosaic") {
    const cols = 2;
    const rows = Math.ceil(validTiles.length / cols);

    const composites = validTiles.map((tile, i) => ({
      input: tile.buffer,
      left: (i % cols) * TILE_W,
      top: Math.floor(i / cols) * TILE_H,
    }));

    const mosaicBuffer = await sharp({
      create: {
        width: TILE_W * cols,
        height: TILE_H * rows,
        channels: 3,
        background: { r: 10, g: 10, b: 10 },
      },
    })
      .composite(composites)
      .jpeg({ quality: 90 })
      .toBuffer();

    return NextResponse.json({
      dataUrl: `data:image/jpeg;base64,${mosaicBuffer.toString("base64")}`,
      resolution: { width: TILE_W * cols, height: TILE_H * rows },
    });
  }

  // ── Stills: return each frame individually ─────────────────────────────────
  return NextResponse.json({
    frames: validTiles.map((tile) => ({
      label: tile.label,
      dataUrl: `data:image/jpeg;base64,${tile.buffer.toString("base64")}`,
    })),
    resolution: { width: TILE_W, height: TILE_H },
  });
}
