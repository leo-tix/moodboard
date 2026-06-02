import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { uploadToR2 } from "@/lib/storage/r2";
import { processImage } from "@/lib/image/process";
import { extractColors } from "@/lib/image/colors";
import { checkUploadAllowed } from "@/lib/storage/quota";
import { randomUUID } from "crypto";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Replace Pinterest CDN size segment with 736x for best quality */
function upgradePinterestUrl(url: string): string {
  // e.g. https://i.pinimg.com/236x/aa/bb/cc.jpg → /736x/
  return url.replace(/\/\d+x\//, "/736x/");
}


const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// ── Route ────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { url } = (await req.json()) as { url: string };
  if (!url || typeof url !== "string") {
    return NextResponse.json({ error: "URL manquante" }, { status: 400 });
  }

  let imageUrl: string | null = null;
  let title    = "";
  let author   = "";
  let source   = "";
  let sourceUrl = url;

  // ── Pinterest ─────────────────────────────────────────────────────────────
  if (url.includes("pinterest.com") || url.includes("pin.it")) {
    try {
      const oembedUrl = `https://www.pinterest.com/oembed.json?url=${encodeURIComponent(url)}`;
      const res = await fetch(oembedUrl, {
        headers: { "User-Agent": BROWSER_UA },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`oEmbed ${res.status}`);
      const data = await res.json() as {
        thumbnail_url?: string;
        title?: string;
        author_name?: string;
      };
      if (data.thumbnail_url) imageUrl = upgradePinterestUrl(data.thumbnail_url);
      if (data.title)       title  = data.title;
      if (data.author_name) author = data.author_name;
      source = "Pinterest";
    } catch (e) {
      return NextResponse.json(
        { error: `Impossible de récupérer l'épingle Pinterest : ${(e as Error).message}` },
        { status: 422 }
      );
    }
  }

  // ── Instagram (Meta oEmbed API officielle) ───────────────────────────────
  else if (url.includes("instagram.com")) {
    const appId     = process.env.META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;

    if (!appId || !appSecret) {
      return NextResponse.json(
        { error: "META_APP_ID / META_APP_SECRET manquants dans les variables d'environnement" },
        { status: 500 }
      );
    }

    try {
      const token     = `${appId}|${appSecret}`;
      const oembedUrl = `https://graph.facebook.com/v19.0/instagram_oembed?url=${encodeURIComponent(url)}&access_token=${token}&fields=thumbnail_url,author_name,title,thumbnail_width,thumbnail_height`;

      const res = await fetch(oembedUrl, { signal: AbortSignal.timeout(12_000) });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: { message?: string } };
        throw new Error(err.error?.message ?? `HTTP ${res.status}`);
      }

      const data = await res.json() as {
        thumbnail_url?: string;
        author_name?:   string;
        title?:         string;
      };

      if (!data.thumbnail_url) throw new Error("Aucune image retournée par l'API Meta");
      imageUrl = data.thumbnail_url;
      if (data.author_name) author = data.author_name;
      if (data.title)       title  = data.title.replace(/ on Instagram$/, "").trim();
      source = "Instagram";
    } catch (e) {
      return NextResponse.json(
        { error: `Import Instagram échoué : ${(e as Error).message}` },
        { status: 422 }
      );
    }
  }

  // ── Unsupported ───────────────────────────────────────────────────────────
  else {
    return NextResponse.json(
      { error: "URL non reconnue. Collez un lien Pinterest (pinterest.com/pin/…) ou Instagram (instagram.com/p/…)" },
      { status: 400 }
    );
  }

  if (!imageUrl) {
    return NextResponse.json({ error: "Image introuvable sur cette page" }, { status: 422 });
  }

  // ── Download image ────────────────────────────────────────────────────────
  let imageBuffer: Buffer;
  try {
    const dlRes = await fetch(imageUrl, {
      headers: {
        "User-Agent": BROWSER_UA,
        "Referer":    source === "Pinterest" ? "https://www.pinterest.com/" : "https://www.instagram.com/",
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!dlRes.ok) throw new Error(`Download ${dlRes.status}`);
    const ct = dlRes.headers.get("content-type") ?? "";
    if (!ct.startsWith("image/")) {
      // 736x fallback → try original oEmbed URL
      if (source === "Pinterest" && imageUrl !== imageUrl.replace(/\/736x\//, "/564x/")) {
        const fallback = imageUrl.replace(/\/736x\//, "/564x/");
        const fb = await fetch(fallback, { headers: { "User-Agent": BROWSER_UA, "Referer": "https://www.pinterest.com/" }, signal: AbortSignal.timeout(15_000) });
        if (!fb.ok) throw new Error(`Fallback download ${fb.status}`);
        imageBuffer = Buffer.from(await fb.arrayBuffer());
      } else {
        throw new Error("L'URL ne pointe pas vers une image");
      }
    } else {
      imageBuffer = Buffer.from(await dlRes.arrayBuffer());
    }
  } catch (e) {
    return NextResponse.json(
      { error: `Téléchargement de l'image échoué : ${(e as Error).message}` },
      { status: 422 }
    );
  }

  // ── Quota check ───────────────────────────────────────────────────────────
  const quotaCheck = await checkUploadAllowed(imageBuffer.byteLength);
  if (!quotaCheck.allowed) {
    return NextResponse.json({ error: quotaCheck.reason }, { status: 413 });
  }

  // ── Process + upload ──────────────────────────────────────────────────────
  try {
    const processed = await processImage(imageBuffer);
    const uuid = randomUUID();
    const storageKey  = `images/${uuid}.webp`;
    const thumbnailKey = `thumbs/${uuid}.webp`;

    const defaultTitle = title || source;

    const [inspiration] = await Promise.all([
      db.inspiration.create({
        data: {
          title:     defaultTitle,
          author:    author || undefined,
          source:    source || undefined,
          sourceUrl: sourceUrl || undefined,
          status:    "PROCESSING",
          mediaType: "IMAGE",
        },
      }),
      uploadToR2(storageKey,   processed.original,  "image/webp"),
      uploadToR2(thumbnailKey, processed.thumbnail,  "image/webp"),
    ]);

    const colors = await extractColors(processed.original);

    await db.image.create({
      data: {
        inspirationId: inspiration.id,
        filename:      `${uuid}.webp`,
        originalName:  `${source.toLowerCase()}-import.webp`,
        mimeType:      processed.mimeType,
        size:          processed.size,
        width:         processed.width,
        height:        processed.height,
        storageKey,
        thumbnailKey,
        blurHash:      processed.blurHash,
        isMain:        true,
        isAnimated:    processed.isAnimated,
      },
    });

    if (colors.length > 0) {
      await db.inspirationColor.createMany({
        data: colors.map((c, i) => ({
          inspirationId: inspiration.id,
          hex:        c.hex, r: c.r, g: c.g, b: c.b,
          percentage: c.percentage, order: i,
        })),
      });
    }

    await db.inspiration.update({
      where: { id: inspiration.id },
      data:  { status: "READY" },
    });

    return NextResponse.json({
      success:       true,
      inspirationId: inspiration.id,
      title:         defaultTitle,
      author,
      source,
      image:         { storageKey, thumbnailKey, blurHash: processed.blurHash },
    });
  } catch (error) {
    console.error("[IMPORT URL ERROR]", error);
    return NextResponse.json({ error: "Erreur lors du traitement de l'image" }, { status: 500 });
  }
}
