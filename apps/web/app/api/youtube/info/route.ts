import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";

export const maxDuration = 20;

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
    // oEmbed — no auth, no key, works from any IP
    const oembedRes = await fetch(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        },
      }
    );
    if (!oembedRes.ok) {
      return NextResponse.json(
        { error: "Vidéo introuvable ou privée" },
        { status: 404 }
      );
    }
    const oembed = (await oembedRes.json()) as {
      title: string;
      author_name: string;
    };

    // YouTube auto-generates 4 thumbnail frames for every public video:
    //   maxresdefault → main thumbnail (high quality)
    //   1.jpg / 2.jpg / 3.jpg → auto-captures at ~25 / 50 / 75% of the video
    // These are public, require no auth, and work from any server IP.
    const frameUrls = [
      `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
      `https://i.ytimg.com/vi/${videoId}/1.jpg`,
      `https://i.ytimg.com/vi/${videoId}/2.jpg`,
      `https://i.ytimg.com/vi/${videoId}/3.jpg`,
    ];
    const frameLabels = ["Thumbnail", "~25%", "~50%", "~75%"];

    return NextResponse.json({
      videoId,
      title: oembed.title,
      author: oembed.author_name,
      thumbnailUrl: frameUrls[0],
      frameUrls,
      frameLabels,
    });
  } catch (error) {
    console.error("[YouTube info]", error);
    return NextResponse.json(
      { error: "Impossible de charger cette vidéo" },
      { status: 500 }
    );
  }
}
