import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import sharp from "sharp";

export const maxDuration = 60;

// ─── Storyboard parsing ───────────────────────────────────────────────────────
//
// YouTube embeds a "storyboard spec" in every page — it's the source of the
// frame previews you see when hovering the seek bar.
//
// Spec format (pipe-separated, levels separated by #):
//   URL_TEMPLATE|w|h|count|cols|rows|sheetCount|extra#w2|h2|count2|cols2|rows2|...
//
// URL_TEMPLATE contains:
//   $L → level index (0, 1, 2 …)
//   $M → sprite sheet index (0, 1, 2 …)
//
// Each sprite sheet is a cols×rows grid of w×h pixel frames.
// ─────────────────────────────────────────────────────────────────────────────

interface StoryboardLevel {
  urlTemplate: string;
  width: number;
  height: number;
  cols: number;
  rows: number;
  sheetCount: number;
  framesPerSheet: number;
  totalFrames: number;
}

function parseStoryboardSpec(spec: string): StoryboardLevel[] {
  const hashParts = spec.split("#");
  const levels: StoryboardLevel[] = [];

  // First hash-part holds the URL template + level-0 params
  const pipeParts = hashParts[0].split("|");
  const urlTemplate = pipeParts[0]; // contains $L and $M

  for (let level = 0; level < hashParts.length; level++) {
    const params = level === 0 ? pipeParts.slice(1) : hashParts[level].split("|");

    const width = parseInt(params[0]);
    const height = parseInt(params[1]);
    // params[2] = count per sheet (== cols*rows, redundant but included)
    const cols = parseInt(params[3]);
    const rows = parseInt(params[4]);
    const sheetCount = parseInt(params[5]) || 1;

    if (!width || !height || !cols || !rows) continue;

    const framesPerSheet = cols * rows;
    levels.push({
      urlTemplate: urlTemplate.replace("$L", String(level)),
      width,
      height,
      cols,
      rows,
      sheetCount,
      framesPerSheet,
      totalFrames: framesPerSheet * sheetCount,
    });
  }

  // Sort best quality (largest frame) first
  return levels.sort((a, b) => b.width - a.width);
}

function getFrameCoords(
  level: StoryboardLevel,
  timestamp: number,
  duration: number
) {
  const frameInterval = duration / level.totalFrames;
  const frameIndex = Math.min(
    Math.floor(timestamp / frameInterval),
    level.totalFrames - 1
  );
  const sheetIndex = Math.floor(frameIndex / level.framesPerSheet);
  const indexInSheet = frameIndex % level.framesPerSheet;
  const col = indexInSheet % level.cols;
  const row = Math.floor(indexInSheet / level.cols);

  return {
    spriteUrl: level.urlTemplate.replace("$M", String(sheetIndex)),
    cropX: col * level.width,
    cropY: row * level.height,
    width: level.width,
    height: level.height,
  };
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { storyboardSpec, duration, timestamps } = (await req.json()) as {
    storyboardSpec: string;
    duration: number;
    timestamps: number[];
  };

  if (!storyboardSpec || !duration || !timestamps?.length) {
    return NextResponse.json({ error: "Paramètres manquants" }, { status: 400 });
  }

  const levels = parseStoryboardSpec(storyboardSpec);
  if (!levels.length) {
    return NextResponse.json(
      { error: "Storyboard non disponible pour cette vidéo" },
      { status: 400 }
    );
  }

  const level = levels[0]; // Best quality available

  // ── Group timestamps by sprite sheet to minimize fetches ──────────────────
  const sheetGroups = new Map<
    string,
    { url: string; items: { ts: number; cropX: number; cropY: number }[] }
  >();

  for (const ts of timestamps) {
    const coords = getFrameCoords(level, ts, duration);
    if (!sheetGroups.has(coords.spriteUrl)) {
      sheetGroups.set(coords.spriteUrl, { url: coords.spriteUrl, items: [] });
    }
    sheetGroups.get(coords.spriteUrl)!.items.push({
      ts,
      cropX: coords.cropX,
      cropY: coords.cropY,
    });
  }

  // ── Download sprite sheets and crop individual frames ─────────────────────
  const frames: { timestamp: number; dataUrl: string }[] = [];

  for (const [, sheet] of sheetGroups) {
    const spriteRes = await fetch(sheet.url);
    if (!spriteRes.ok) {
      console.warn("[YouTube frames] Failed to fetch sprite:", sheet.url, spriteRes.status);
      continue;
    }
    const spriteBuffer = Buffer.from(await spriteRes.arrayBuffer());

    for (const item of sheet.items) {
      try {
        const frameBuffer = await sharp(spriteBuffer)
          .extract({
            left: item.cropX,
            top: item.cropY,
            width: level.width,
            height: level.height,
          })
          .jpeg({ quality: 88 })
          .toBuffer();

        frames.push({
          timestamp: item.ts,
          dataUrl: `data:image/jpeg;base64,${frameBuffer.toString("base64")}`,
        });
      } catch (err) {
        console.error("[YouTube frames] Crop error at", item.ts, err);
      }
    }
  }

  frames.sort((a, b) => a.timestamp - b.timestamp);

  return NextResponse.json({
    frames,
    resolution: { width: level.width, height: level.height },
  });
}
