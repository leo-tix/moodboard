import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthUserId } from "@/lib/auth/withToken";
import { uploadToR2 } from "@/lib/storage/r2";
import { processImage } from "@/lib/image/process";
import { extractColors } from "@/lib/image/colors";
import { checkUploadAllowed } from "@/lib/storage/quota";
import { randomUUID } from "crypto";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function refererFor(imageUrl: string): string {
  if (imageUrl.includes("cdninstagram.com") || imageUrl.includes("fbcdn.net"))
    return "https://www.instagram.com/";
  if (imageUrl.includes("pinimg.com"))
    return "https://www.pinterest.com/";
  try {
    const u = new URL(imageUrl);
    return u.origin + "/";
  } catch {
    return "";
  }
}

export async function POST(req: NextRequest) {
  const userId = await getAuthUserId(req);
  if (!userId) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const body = await req.json() as {
    imageUrl: string;
    title?: string;
    author?: string;
    sourceUrl?: string;
    description?: string;
    year?: string;
    tags?: string[];
    categories?: { categoryId: string; subcategoryId: string | null }[];
  };

  const { imageUrl, title, author, sourceUrl, description, year, tags, categories } = body;

  if (!imageUrl || typeof imageUrl !== "string") {
    return NextResponse.json({ error: "imageUrl manquant" }, { status: 400 });
  }

  // Validate it looks like an image URL (basic check)
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(imageUrl);
    if (!["http:", "https:"].includes(parsedUrl.protocol)) throw new Error();
  } catch {
    return NextResponse.json({ error: "URL invalide" }, { status: 400 });
  }

  // Download the image
  let imageBuffer: Buffer;
  let mimeType: string;
  try {
    const res = await fetch(imageUrl, {
      headers: {
        "User-Agent": BROWSER_UA,
        "Referer": refererFor(imageUrl),
        "Accept": "image/*,*/*",
      },
      signal: AbortSignal.timeout(20_000),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const ct = res.headers.get("content-type") ?? "";
    if (!ct.startsWith("image/")) {
      throw new Error(`Type inattendu : ${ct}`);
    }
    mimeType = ct;
    imageBuffer = Buffer.from(await res.arrayBuffer());
  } catch (e) {
    return NextResponse.json(
      { error: `Impossible de télécharger l'image : ${(e as Error).message}` },
      { status: 422 }
    );
  }

  const quotaCheck = await checkUploadAllowed(imageBuffer.byteLength);
  if (!quotaCheck.allowed) {
    return NextResponse.json({ error: quotaCheck.reason }, { status: 413 });
  }

  try {
    const processed = await processImage(imageBuffer);
    const uuid = randomUUID();
    const storageKey = `images/${uuid}.webp`;
    const thumbnailKey = `thumbs/${uuid}.webp`;

    const defaultTitle = title?.trim() || parsedUrl.hostname;

    const [inspiration] = await Promise.all([
      db.inspiration.create({
        data: {
          title: defaultTitle,
          author: author?.trim() || undefined,
          description: description?.trim() || undefined,
          year: year?.trim() ? parseInt(year.trim(), 10) || undefined : undefined,
          sourceUrl: sourceUrl?.trim() || imageUrl,
          status: "PROCESSING",
          mediaType: "IMAGE",
        },
      }),
      uploadToR2(storageKey, processed.original, "image/webp"),
      uploadToR2(thumbnailKey, processed.thumbnail, "image/webp"),
    ]);

    const colors = await extractColors(processed.original);

    await db.image.create({
      data: {
        inspirationId: inspiration.id,
        filename: `${uuid}.webp`,
        originalName: `import-${uuid}.webp`,
        mimeType: processed.mimeType,
        size: processed.size,
        width: processed.width,
        height: processed.height,
        storageKey,
        thumbnailKey,
        blurHash: processed.blurHash,
        isMain: true,
        isAnimated: processed.isAnimated,
      },
    });

    if (colors.length > 0) {
      await db.inspirationColor.createMany({
        data: colors.map((c, i) => ({
          inspirationId: inspiration.id,
          hex: c.hex, r: c.r, g: c.g, b: c.b,
          percentage: c.percentage, order: i,
        })),
      });
    }

    // Apply tags
    if (tags && tags.length > 0) {
      for (const name of tags) {
        const tag = await db.tag.upsert({
          where: { name },
          update: {},
          create: { name, slug: name.toLowerCase().replace(/\s+/g, "-") },
        });
        await db.inspirationTag.create({
          data: { inspirationId: inspiration.id, tagId: tag.id },
        });
      }
    }

    // Apply categories
    if (categories && categories.length > 0) {
      await db.inspirationCategory.createMany({
        data: categories.map((c) => ({
          inspirationId: inspiration.id,
          categoryId: c.categoryId,
          subcategoryId: c.subcategoryId ?? null,
        })),
        skipDuplicates: true,
      });
    }

    await db.inspiration.update({
      where: { id: inspiration.id },
      data: { status: "READY" },
    });

    return NextResponse.json({
      success: true,
      inspirationId: inspiration.id,
      storageKey,
      thumbnailKey,
      width: processed.width,
      height: processed.height,
      title: defaultTitle,
    });
  } catch (error) {
    console.error("[IMPORT DIRECT ERROR]", error);
    return NextResponse.json({ error: "Erreur lors du traitement" }, { status: 500 });
  }
}
