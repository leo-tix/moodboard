import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";

export const maxDuration = 20;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface YouTubeMetadata {
  director: string | null;
  year: number | null;
  studio: string | null;
  dop: string | null;
  music: string | null;
  cast: string[];
  country: string | null;
  notes: string | null;
  tags: string[];
}

// ─── Regex parser ─────────────────────────────────────────────────────────────
//
// Covers the most common patterns in YouTube descriptions:
//   "Director: John Smith", "Directed by Jane Doe", "Réalisateur : …"
//   "DOP: …", "Director of Photography: …", "Image: …"
//   "Music by …", "Musique : …"
//   "Production: …", "A X Production", "Label: …"
//   "Cast: A, B, C", "Starring: …", "Avec: …"
//   "#hashtag" → tags
//   "© 2024" / "(2024)" → year
// ─────────────────────────────────────────────────────────────────────────────

function first(text: string, patterns: RegExp[]): string | null {
  for (const p of patterns) {
    const m = text.match(p);
    if (m?.[1]) return m[1].trim().replace(/\s+/g, " ");
  }
  return null;
}

function parseDescription(
  description: string,
  publishedYear: number | null
): YouTubeMetadata {
  // Normalise line endings and HTML entities
  const raw = description
    .replace(/\r\n/g, "\n")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');

  // ── Director ──────────────────────────────────────────────────────────────
  const director = first(raw, [
    /(?:director|directed\s+by|réalisateur(?:\s*\/\s*réalisatrice)?|réalisé(?:e)?\s+par|direction)\s*[:\-–—]\s*([^\n,•|]+)/i,
    /^([^\n]{2,60})\s*[-–—]\s*(?:director|réalisateur)/im,
  ]);

  // ── DoP / Cinematography ──────────────────────────────────────────────────
  const dop = first(raw, [
    /(?:director\s+of\s+photography|d(?:irecteur)?\.?\s*o\.?\s*p\.?|cinematography|cinematographer|chef[- ]opérateur|directeur\s+de\s+la\s+photographie|image)\s*[:\-–—]\s*([^\n,•|]+)/i,
  ]);

  // ── Music ─────────────────────────────────────────────────────────────────
  const music = first(raw, [
    /(?:original\s+(?:score|music|soundtrack)|music\s+(?:by|:)|musique\s*[:\-–—]|composed\s+by|bande\s+originale\s*[:\-–—])\s*([^\n,•|]+)/i,
    /(?:music|musique)\s*[:\-–—]\s*([^\n,•|]+)/i,
  ]);

  // ── Studio / Production ───────────────────────────────────────────────────
  const studio = first(raw, [
    /(?:production(?:\s+company)?|produced\s+by|société\s+de\s+production|label|studio)\s*[:\-–—]\s*([^\n,•|]+)/i,
    /^a\s+([^\n]{2,50}?)\s+(?:production|films?)$/im,
  ]);

  // ── Cast ─────────────────────────────────────────────────────────────────
  const castRaw = first(raw, [
    /(?:cast|starring|avec|featuring|interprètes?)\s*[:\-–—]\s*([^\n]+)/i,
  ]);
  const cast = castRaw
    ? castRaw
        .split(/[,\/&+]/)
        .map((s) => s.trim())
        .filter((s) => s.length > 1 && s.length < 60)
        .slice(0, 8)
    : [];

  // ── Country ───────────────────────────────────────────────────────────────
  const country = first(raw, [
    /(?:country|pays|origine)\s*[:\-–—]\s*([^\n,•|]+)/i,
  ]);

  // ── Year ─────────────────────────────────────────────────────────────────
  // Priority: explicit in description → published date
  const yearFromText = (() => {
    const m =
      raw.match(/©\s*(20\d{2}|19\d{2})/) ||
      raw.match(/\b(20\d{2}|19\d{2})\b/);
    if (!m) return null;
    const y = parseInt(m[1]);
    return y >= 1900 && y <= new Date().getFullYear() + 1 ? y : null;
  })();
  const year = yearFromText ?? publishedYear;

  // ── Hashtag tags ──────────────────────────────────────────────────────────
  const tags = [...new Set(
    (raw.match(/#([a-zA-ZÀ-ÿ0-9_]{2,30})/g) ?? [])
      .map((t) => t.slice(1).toLowerCase())
  )].slice(0, 12);

  // ── Notes: remaining credit lines not already captured ────────────────────
  const captured = [director, dop, music, studio, castRaw, country]
    .filter(Boolean)
    .map((s) => s!.toLowerCase().slice(0, 20));

  const noteLines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter(
      (l) =>
        l.length > 5 &&
        l.length < 120 &&
        /[:\-–—]/.test(l) &&
        !/(https?:\/\/|www\.|@|#)/i.test(l) &&
        !captured.some((c) => l.toLowerCase().includes(c))
    )
    .slice(0, 4);
  const notes = noteLines.length > 0 ? noteLines.join(" · ") : null;

  return { director, year, studio, dop, music, cast, country, notes, tags };
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session)
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { videoId, title, author } = (await req.json()) as {
    videoId: string;
    title: string;
    author: string;
  };

  if (!videoId)
    return NextResponse.json({ error: "videoId manquant" }, { status: 400 });

  let description = "";
  let publishedYear: number | null = null;
  let ytTags: string[] = [];

  // ── Fetch description via YouTube Data API v3 (free, no billing) ──────────
  const ytKey = process.env.YOUTUBE_API_KEY;
  if (ytKey) {
    try {
      const ytRes = await fetch(
        `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}&key=${ytKey}`
      );
      if (ytRes.ok) {
        const ytData = (await ytRes.json()) as {
          items?: {
            snippet?: {
              description?: string;
              publishedAt?: string;
              tags?: string[];
            };
          }[];
        };
        const snippet = ytData.items?.[0]?.snippet;
        if (snippet) {
          description = snippet.description ?? "";
          if (snippet.publishedAt)
            publishedYear = new Date(snippet.publishedAt).getFullYear();
          ytTags = snippet.tags ?? [];
        }
      }
    } catch (err) {
      console.warn("[YouTube metadata] Data API failed:", err);
    }
  }

  // Fallback: at least try the title (year extraction still works)
  if (!description) {
    description = `${title}\n${author}`;
  }

  const metadata = parseDescription(description, publishedYear);

  // Merge YouTube's own tags (from Data API) with hashtags from description
  const allTags = [...new Set([...metadata.tags, ...ytTags.map((t) => t.toLowerCase())])].slice(0, 15);

  return NextResponse.json({
    available: true,
    ...metadata,
    tags: allTags,
    // Let the client know if description was empty (no key) — for display hint
    descriptionAvailable: description.length > (title + author).length + 5,
  });
}
