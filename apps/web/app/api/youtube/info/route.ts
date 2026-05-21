import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import ytdl from "@distube/ytdl-core";

export const maxDuration = 30;

/**
 * Build a ytdl agent with browser cookies if YOUTUBE_COOKIE is set.
 * Expected format: JSON array of { name, value } objects exported from the browser.
 * See /import/youtube for setup instructions.
 */
function buildAgent() {
  const raw = process.env.YOUTUBE_COOKIE;
  if (!raw) return undefined;
  try {
    const cookies = JSON.parse(raw) as { name: string; value: string }[];
    return ytdl.createAgent(cookies);
  } catch {
    console.warn("[YouTube] YOUTUBE_COOKIE is set but could not be parsed as JSON");
    return undefined;
  }
}

const AGENT = buildAgent();

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { url } = await req.json();

  if (!url || !ytdl.validateURL(url)) {
    return NextResponse.json({ error: "URL YouTube invalide" }, { status: 400 });
  }

  try {
    const info = await ytdl.getInfo(url, AGENT ? { agent: AGENT } : {});
    const { videoDetails } = info;

    // Prefer lowest-quality combined (audio+video) mp4 — broadest browser compatibility
    // Combined streams are larger than video-only but always seekable in <video>
    const combined = info.formats
      .filter((f) => f.hasVideo && f.hasAudio && f.container === "mp4")
      .sort((a, b) => (a.height ?? 9999) - (b.height ?? 9999));

    // Fallback: any combined stream
    const fallback = info.formats
      .filter((f) => f.hasVideo && f.hasAudio)
      .sort((a, b) => (a.height ?? 9999) - (b.height ?? 9999));

    const format = combined[0] ?? fallback[0];

    if (!format?.url) {
      return NextResponse.json({ error: "Aucun format vidéo compatible trouvé" }, { status: 400 });
    }

    return NextResponse.json({
      videoId: videoDetails.videoId,
      title: videoDetails.title,
      author: videoDetails.author.name,
      duration: parseInt(videoDetails.lengthSeconds, 10),
      thumbnailUrl: videoDetails.thumbnails.at(-1)?.url ?? null,
      streamUrl: format.url,
      width: format.width ?? 640,
      height: format.height ?? 360,
    });
  } catch (error) {
    console.error("[YouTube info]", error);
    const msg = error instanceof Error ? error.message : "Erreur inconnue";
    return NextResponse.json({ error: `Impossible de charger cette vidéo : ${msg}` }, { status: 500 });
  }
}
