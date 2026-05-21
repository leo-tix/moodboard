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

// ─── InnerTube clients to try in order ───────────────────────────────────────

interface InnerTubeClient {
  label: string;
  url: string;
  headers: Record<string, string>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: Record<string, any>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchPlayerData(videoId: string): Promise<Record<string, any> | null> {
  const CLIENTS: InnerTubeClient[] = [
    // ANDROID — most permissive from server IPs, no key required
    {
      label: "ANDROID",
      url: "https://www.youtube.com/youtubei/v1/player",
      headers: {
        "Content-Type": "application/json",
        "User-Agent":
          "com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip",
      },
      body: {
        videoId,
        context: {
          client: {
            clientName: "ANDROID",
            clientVersion: "19.09.37",
            androidSdkVersion: 30,
            hl: "en",
            gl: "US",
          },
        },
      },
    },
    // TVHTML5 — another server-friendly client
    {
      label: "TVHTML5",
      url: "https://www.youtube.com/youtubei/v1/player",
      headers: {
        "Content-Type": "application/json",
        "User-Agent":
          "Mozilla/5.0 (SMART-TV; Linux; Tizen 5.0) AppleWebKit/538.1 (KHTML, like Gecko) Version/5.0 TV Safari/538.1",
      },
      body: {
        videoId,
        context: {
          client: {
            clientName: "TVHTML5",
            clientVersion: "7.20240101.00.00",
            hl: "en",
            gl: "US",
          },
        },
      },
    },
    // WEB — standard browser client
    {
      label: "WEB",
      url: "https://www.youtube.com/youtubei/v1/player?key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8",
      headers: {
        "Content-Type": "application/json",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
      body: {
        videoId,
        context: {
          client: {
            clientName: "WEB",
            clientVersion: "2.20240101.00.00",
            hl: "en",
            gl: "US",
          },
        },
      },
    },
  ];

  for (const client of CLIENTS) {
    try {
      const res = await fetch(client.url, {
        method: "POST",
        headers: client.headers,
        body: JSON.stringify(client.body),
      });

      const text = await res.text();
      console.log(`[YouTube info] ${client.label} → HTTP ${res.status}, body[:200]: ${text.slice(0, 200)}`);

      if (!res.ok) continue;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = JSON.parse(text) as Record<string, any>;

      const spec =
        data?.storyboards?.playerStoryboardSpecRenderer?.spec ??
        data?.storyboards?.playerLiveStoryboardSpecRenderer?.spec;
      const duration = data?.videoDetails?.lengthSeconds;

      console.log(
        `[YouTube info] ${client.label} → keys: [${Object.keys(data).join(", ")}]` +
        ` | playability: ${data?.playabilityStatus?.status}` +
        ` | reason: ${data?.playabilityStatus?.reason ?? data?.playabilityStatus?.messages?.[0] ?? "—"}` +
        ` | spec: ${spec ? "✓" : "null"}, duration: ${duration ?? "null"}`
      );

      // Accept this client's response if it has at least duration
      if (duration || spec) return data;
    } catch (err) {
      console.warn(`[YouTube info] ${client.label} failed:`, err);
    }
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
    // ── 1. Basic metadata via oEmbed (no auth, no key, forever free) ──────────
    const oembedRes = await fetch(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          "Accept-Language": "en-US,en;q=0.9",
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

    // ── 2. Player data via InnerTube (tries multiple clients) ─────────────────
    const playerData = await fetchPlayerData(videoId);

    const duration = playerData?.videoDetails?.lengthSeconds
      ? parseInt(playerData.videoDetails.lengthSeconds, 10)
      : 0;

    const rawSpec: string | undefined =
      playerData?.storyboards?.playerStoryboardSpecRenderer?.spec ??
      playerData?.storyboards?.playerLiveStoryboardSpecRenderer?.spec;

    const storyboardSpec =
      typeof rawSpec === "string" && rawSpec.includes("i.ytimg.com")
        ? rawSpec
        : null;

    const thumbnailUrl = `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`;

    return NextResponse.json({
      videoId,
      title: oembed.title,
      author: oembed.author_name,
      duration,
      thumbnailUrl,
      storyboardSpec,
    });
  } catch (error) {
    console.error("[YouTube info]", error);
    return NextResponse.json(
      { error: "Impossible de charger cette vidéo" },
      { status: 500 }
    );
  }
}
