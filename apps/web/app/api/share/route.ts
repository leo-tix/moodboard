import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { uploadToR2 } from "@/lib/storage/r2";
import { processImage } from "@/lib/image/process";
import { extractColors } from "@/lib/image/colors";
import { checkUploadAllowed, checkMimeType } from "@/lib/storage/quota";
import { randomUUID } from "crypto";

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"];

async function processOneFile(
  file: File,
  title: string,
  req: NextRequest,
): Promise<string | null> {
  if (!checkMimeType(file.type) && !ACCEPTED_TYPES.includes(file.type)) return null;

  const quotaCheck = await checkUploadAllowed(file.size);
  if (!quotaCheck.allowed) return null;

  const buffer = Buffer.from(await file.arrayBuffer());
  const processed = await processImage(buffer);

  const finalCheck = await checkUploadAllowed(processed.size);
  if (!finalCheck.allowed) return null;

  const uuid = randomUUID();
  const storageKey = `images/${uuid}.webp`;
  const thumbnailKey = `thumbs/${uuid}.webp`;
  const defaultTitle = title || file.name.replace(/\.\w+$/, "") || "Import";

  const [inspiration] = await Promise.all([
    db.inspiration.create({
      data: { title: defaultTitle, status: "PROCESSING", mediaType: "IMAGE" },
    }),
    uploadToR2(storageKey, processed.original, "image/webp"),
    uploadToR2(thumbnailKey, processed.thumbnail, "image/webp"),
  ]);

  const colors = await extractColors(processed.original);

  await db.image.create({
    data: {
      inspirationId: inspiration.id,
      filename: `${uuid}.webp`,
      originalName: file.name,
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

  await db.inspiration.update({
    where: { id: inspiration.id },
    data: { status: "READY" },
  });

  return inspiration.id;
}

// Web Share Target — called by Android/iOS when user shares to the PWA
// Manifest declares: POST /api/share with multipart/form-data
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  const formData = await req.formData();
  const sharedTitle = (formData.get("title") as string | null)?.trim() || "";
  const sharedText = (formData.get("text") as string | null)?.trim() || "";
  // Instagram/Pinterest "Share to" sends the link as plain text (ACTION_SEND),
  // not the structured 'url' param — fall back to extracting it from text.
  const sharedUrl =
    (formData.get("url") as string | null)?.trim() ||
    sharedText.match(/https?:\/\/\S+/i)?.[0] ||
    "";

  // ── Case 1: files shared (image or carousel) ─────────────────────────────
  const files = formData.getAll("image").filter(
    (f): f is File => f instanceof File && f.size > 0,
  );

  if (files.length > 0) {
    try {
      const results = await Promise.all(
        files.map((f) => processOneFile(f, sharedTitle, req).catch(() => null)),
      );
      const saved = results.filter(Boolean).length;
      if (saved > 0) {
        return NextResponse.redirect(new URL(`/share/done?count=${saved}`, req.url));
      }
    } catch (err) {
      console.error("[SHARE UPLOAD ERROR]", err);
    }
    return NextResponse.redirect(new URL("/upload?error=processing", req.url));
  }

  // ── Case 2: Instagram link — automatic import unavailable (Meta API not
  // approved), invite the user to screenshot instead ───────────────────────
  if (sharedUrl && /instagram\.com/i.test(sharedUrl)) {
    return NextResponse.redirect(new URL("/share/instagram", req.url));
  }

  // ── Case 3: Pinterest link ─────────────────────────────────────────────
  if (sharedUrl && /pinterest\.[a-z.]+|pin\.it/i.test(sharedUrl)) {
    return NextResponse.redirect(
      new URL(`/share/social?url=${encodeURIComponent(sharedUrl)}`, req.url),
    );
  }

  // ── Case 4: YouTube link — send to the stills/mosaic import module ────────
  if (sharedUrl && /youtube\.com|youtu\.be/i.test(sharedUrl)) {
    return NextResponse.redirect(
      new URL(`/import/youtube?url=${encodeURIComponent(sharedUrl)}`, req.url),
    );
  }

  // ── Case 5: other URL (assume direct image link) ──────────────────────────
  if (sharedUrl) {
    const params = new URLSearchParams({ imageUrl: sharedUrl });
    if (sharedTitle) params.set("title", sharedTitle);
    return NextResponse.redirect(new URL(`/import/bookmarklet?${params}`, req.url));
  }

  return NextResponse.redirect(new URL("/upload", req.url));
}
