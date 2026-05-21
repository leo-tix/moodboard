import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import sharp from "sharp";

export const maxDuration = 60;

// ─── Storyboard parsing ───────────────────────────────────────────────────────
//
// YouTube embeds a "storyboard spec" in every page — it's the source of the
// frame previews you see when hovering the seek bar.
//
// Spec format (pipe-separated):
//   URL_TEMPLATE|w#h#totalFrames#cols#rows#intervalMs#sheetTemplate#sig|w2#h2#...
//
// URL_TEMPLATE contains:
//   $L → level index (0, 1, 2 …)
//   $N → sheet name (e.g. "default", "M0", "M1" …)
//
// Each level's params are separated by "#":
//   [0] width   [1] height   [2] totalFrames   [3] cols   [4] rows
//   [5] intervalMs (ms between frames)   [6] sheetTemplate (e.g. "M$M")
//   [7] signature (rs$TOKEN)
//
// Each sprite sheet is a cols×rows grid of w×h pixel frames.
// ─────────────────────────────────────────────────────────────────────────────

interface StoryboardLevel {
  urlTemplate: string;   // URL with $N replaced ready for sheet substitution
  width: number;
  height: number;
  cols: number;
  rows: number;
  totalFrames: number;
  framesPerSheet: number;
  sheetCount: number;
  intervalMs: number;
  sheetTemplate: string; // e.g. "M$M" or "default"
}

function parseStoryboardSpec(spec: string): StoryboardLevel[] {
  // Levels are separated by "|"; first token is the URL template
  const pipeParts = spec.split("|");
  const urlTemplate = pipeParts[0]; // contains $L and $N
  const levels: StoryboardLevel[] = [];

  for (let i = 1; i < pipeParts.length; i++) {
    const params = pipeParts[i].split("#");

    const width        = parseInt(params[0]);
    const height       = parseInt(params[1]);
    const totalFrames  = parseInt(params[2]);
    const cols         = parseInt(params[3]);
    const rows         = parseInt(params[4]);
    const intervalMs   = parseInt(params[5]) || 5000;
    const sheetTemplate = params[6] ?? "M$M";

    if (!width || !height || !cols || !rows) continue;

    const levelIndex   = i - 1;
    const framesPerSheet = cols * rows;

    levels.push({
      urlTemplate: urlTemplate.replace("$L", String(levelIndex)),
      width,
      height,
      totalFrames,
      cols,
      rows,
      intervalMs,
      sheetTemplate,
      framesPerSheet,
      sheetCount: Math.ceil(totalFrames / framesPerSheet),
    });
  }

  // Sort best quality (largest frame) first
  return levels.sort((a, b) => b.width - a.width);
}

function getFrameCoords(level: StoryboardLevel, timestamp: number) {
  // timestamp is in seconds; intervalMs is ms per frame
  const frameIndex = Math.min(
    Math.floor((timestamp * 1000) / level.intervalMs),
    level.totalFrames - 1
  );
  const sheetIndex    = Math.floor(frameIndex / level.framesPerSheet);
  const indexInSheet  = frameIndex % level.framesPerSheet;
  const col           = indexInSheet % level.cols;
  const row           = Math.floor(indexInSheet / level.cols);

  // "M$M" → "M0", "M1", …; "default" stays "default"
  const sheetName = level.sheetTemplate.replace("$M", String(sheetIndex));

  return {
    spriteUrl: level.urlTemplate.replace("$N", sheetName),
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
    const coords = getFrameCoords(level, ts);
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
