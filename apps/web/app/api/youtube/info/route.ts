import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";

export const maxDuration = 30;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractVideoId(url: string): string | null {
  const patterns = [
    /[?&]v=([a-zA-Z0-9_-]{11})/,
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /\/embed\/([a-zA-Z0-9_-]{11})/,
    /\/shorts\/([a-zA-Z0-9_-]{11})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

// Extract ytInitialPlayerResponse JSON blob from page HTML
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractPlayerResponse(html: string): Record<string, any> | null {
  const match = html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\});\s*(?:var |const |let |\w+\.push)/s);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { url } = await req.json();
  const videoId = extractVideoId(url ?? "");
  if (!videoId) {
    return NextResponse.json({ error: "URL YouTube invalide" }, { status: 400 });
  }

  try {
    // ── 1. Basic metadata via oEmbed (no auth, no key, forever free) ──────────
    const oembedRes = await fetch(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`,
      { headers: BROWSER_HEADERS }
    );
    if (!oembedRes.ok) {
      return NextResponse.json(
        { error: "Vidéo introuvable ou privée" },
        { status: 404 }
      );
    }
    const oembed = await oembedRes.json() as { title: string; author_name: string };

    // ── 2. Storyboard spec + duration from the page HTML ──────────────────────
    const pageRes = await fetch(
      `https://www.youtube.com/watch?v=${videoId}`,
      { headers: BROWSER_HEADERS }
    );
    const html = await pageRes.text();

    // Primary: parse the full ytInitialPlayerResponse JSON blob
    const playerResponse = extractPlayerResponse(html);

    let storyboardSpec: string | null = null;
    let duration = 0;

    if (playerResponse) {
      // Duration
      const lengthSeconds = playerResponse?.videoDetails?.lengthSeconds;
      if (lengthSeconds) duration = parseInt(lengthSeconds, 10);

      // Storyboard spec — nested in storyboards.playerStoryboardSpecRenderer.spec
      const spec =
        playerResponse?.storyboards?.playerStoryboardSpecRenderer?.spec ??
        playerResponse?.storyboards?.playerLiveStoryboardSpecRenderer?.spec;

      if (typeof spec === "string" && spec.includes("i.ytimg.com")) {
        storyboardSpec = spec;
      }
    }

    // Fallback regex patterns if JSON parsing failed or was incomplete
    if (!duration) {
      const m = html.match(/"lengthSeconds"\s*:\s*"(\d+)"/);
      if (m) duration = parseInt(m[1], 10);
    }
    if (!duration) {
      // approxDurationMs fallback
      const m = html.match(/"approxDurationMs"\s*:\s*"(\d+)"/);
      if (m) duration = Math.round(parseInt(m[1], 10) / 1000);
    }

    if (!storyboardSpec) {
      const specMatch = html.match(/"spec"\s*:\s*"(https:\\?\/\\?\/i\.ytimg\.com\\?\/sb[^"]+)"/);
      if (specMatch) {
        storyboardSpec = specMatch[1]
          .replace(/\\u0026/g, "&")
          .replace(/\\\//g, "/")
          .replace(/\\"/g, '"');
      }
    }

    // maxresdefault is 1280×720 — best available thumbnail (may 404 on older videos)
    const thumbnailUrl = `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`;

    return NextResponse.json({
      videoId,
      title: oembed.title,
      author: oembed.author_name,
      duration,
      thumbnailUrl,
      storyboardSpec, // null if video has no storyboard (rare, very short videos)
    });
  } catch (error) {
    console.error("[YouTube info]", error);
    return NextResponse.json(
      { error: "Impossible de charger cette vidéo" },
      { status: 500 }
    );
  }
}
