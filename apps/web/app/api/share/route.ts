import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { uploadToR2 } from "@/lib/storage/r2";
import { processImage } from "@/lib/image/process";
import { extractColors } from "@/lib/image/colors";
import { checkUploadAllowed, checkMimeType } from "@/lib/storage/quota";
import { randomUUID } from "crypto";

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"];

// Web Share Target — called by Android/iOS when user shares to the PWA
// Manifest declares: POST /api/share with multipart/form-data
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) {
    // Redirect to login; the user will need to try again after auth
    return NextResponse.redirect(new URL("/login", req.url));
  }

  const formData = await req.formData();

  const file = formData.get("image") as File | null;
  const sharedUrl = (formData.get("url") as string | null)?.trim() || "";
  const sharedTitle = (formData.get("title") as string | null)?.trim() || "";

  // ── Case 1: file shared (long-press → share image in Instagram/etc.) ──────
  if (file && file.size > 0) {
    if (!checkMimeType(file.type) && !ACCEPTED_TYPES.includes(file.type)) {
      return NextResponse.redirect(new URL("/upload?error=type", req.url));
    }

    const quotaCheck = await checkUploadAllowed(file.size);
    if (!quotaCheck.allowed) {
      return NextResponse.redirect(new URL("/upload?error=quota", req.url));
    }

    try {
      const buffer = Buffer.from(await file.arrayBuffer());
      const processed = await processImage(buffer);

      const finalCheck = await checkUploadAllowed(processed.size);
      if (!finalCheck.allowed) {
        return NextResponse.redirect(new URL("/upload?error=quota", req.url));
      }

      const uuid = randomUUID();
      const storageKey = `images/${uuid}.webp`;
      const thumbnailKey = `thumbs/${uuid}.webp`;
      const defaultTitle = sharedTitle || file.name.replace(/\.\w+$/, "") || "Import";

      const [inspiration] = await Promise.all([
        db.inspiration.create({
          data: {
            title: defaultTitle,
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

      // Redirect to the newly created inspiration
      return NextResponse.redirect(new URL(`/library/${inspiration.id}?fresh=1`, req.url));
    } catch (err) {
      console.error("[SHARE UPLOAD ERROR]", err);
      return NextResponse.redirect(new URL("/upload?error=processing", req.url));
    }
  }

  // ── Case 2: URL shared (copy link from Instagram → share to Moodboard) ────
  if (sharedUrl) {
    const params = new URLSearchParams({ imageUrl: sharedUrl });
    if (sharedTitle) params.set("title", sharedTitle);
    // Redirect to bookmarklet import page which will attempt to import the URL
    return NextResponse.redirect(new URL(`/import/bookmarklet?${params}`, req.url));
  }

  // Nothing useful shared
  return NextResponse.redirect(new URL("/upload", req.url));
}
