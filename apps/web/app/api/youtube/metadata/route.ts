import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { GoogleGenAI } from "@google/genai";

export const maxDuration = 30;

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

// ─── Gemini text parser ───────────────────────────────────────────────────────

async function parseWithGemini(
  description: string,
  title: string,
  author: string
): Promise<YouTubeMetadata> {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

  const prompt = `Tu es un assistant spécialisé dans l'analyse de descriptions YouTube pour en extraire des métadonnées créatives.

Titre de la vidéo : "${title}"
Chaîne : "${author}"

Description :
---
${description.slice(0, 3000)}
---

Extrait les informations ci-dessous. Mets null si une donnée est absente du texte. Réponds UNIQUEMENT en JSON valide :
{
  "director": "nom du réalisateur/réalisatrice ou null",
  "year": 2024,
  "studio": "société de production, label, agence ou null",
  "dop": "directeur/directrice de la photographie ou null",
  "music": "compositeur ou titre musical ou null",
  "cast": ["acteur1", "acteur2"],
  "country": "pays de production ou null",
  "notes": "autres crédits pertinents (montage, VFX, chorégraphie…) en une phrase courte ou null",
  "tags": ["tag1", "tag2", "tag3", "tag4", "tag5"]
}`;

  const raw = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [{ parts: [{ text: prompt }] }],
    config: { temperature: 0.2, maxOutputTokens: 1024 },
  });

  const text = raw.text ?? "";
  const codeBlock = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  const rawJson = text.match(/\{[\s\S]*\}/);
  const jsonStr = codeBlock ? codeBlock[1] : rawJson ? rawJson[0] : null;
  if (!jsonStr) throw new Error("Gemini response not parseable");
  return JSON.parse(jsonStr) as YouTubeMetadata;
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json({ available: false, reason: "no_gemini_key" });
  }

  const { videoId, title, author } = (await req.json()) as {
    videoId: string;
    title: string;
    author: string;
  };

  if (!videoId) {
    return NextResponse.json({ error: "videoId manquant" }, { status: 400 });
  }

  let description = "";
  let publishedYear: number | null = null;

  // ── Fetch description via YouTube Data API v3 (if key is configured) ──────
  const ytKey = process.env.YOUTUBE_API_KEY;
  if (ytKey) {
    try {
      const ytRes = await fetch(
        `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}&key=${ytKey}`
      );
      if (ytRes.ok) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ytData = await ytRes.json() as { items?: { snippet?: any }[] };
        const snippet = ytData.items?.[0]?.snippet;
        if (snippet?.description) {
          description = snippet.description;
          if (snippet.publishedAt) {
            publishedYear = new Date(snippet.publishedAt as string).getFullYear();
          }
        }
      }
    } catch (err) {
      console.warn("[YouTube metadata] Data API failed:", err);
    }
  }

  // ── Fallback: parse from title + author alone (limited but better than nothing)
  if (!description) {
    description = `${title}\nChaîne: ${author}`;
  }

  try {
    const metadata = await parseWithGemini(description, title, author);

    // If Gemini couldn't find a year but we have the published date, use it
    if (!metadata.year && publishedYear) {
      metadata.year = publishedYear;
    }

    return NextResponse.json({ available: true, ...metadata });
  } catch (err) {
    console.error("[YouTube metadata] Gemini parse error:", err);
    return NextResponse.json({ available: false, reason: "parse_error" });
  }
}
