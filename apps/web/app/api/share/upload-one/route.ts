import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { uploadToR2 } from "@/lib/storage/r2";
import { processImage } from "@/lib/image/process";
import { extractColors } from "@/lib/image/colors";
import { checkUploadAllowed, checkMimeType } from "@/lib/storage/quota";
import { randomUUID } from "crypto";

export const maxDuration = 30;

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"];

// Single-file counterpart to /api/share — called by the /share/upload
// client page once per file, so each request stays under Vercel's
// 4.5MB serverless payload limit even for multi-photo shares.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const formData = await req.formData();
  const file = formData.get("image") as File | null;
  const title = (formData.get("title") as string | null)?.trim() || "";

  if (!file || file.size === 0) {
    return NextResponse.json({ error: "no_file" }, { status: 400 });
  }

  if (!checkMimeType(file.type) && !ACCEPTED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: "type" }, { status: 400 });
  }

  const quotaCheck = await checkUploadAllowed(file.size);
  if (!quotaCheck.allowed) {
    return NextResponse.json({ error: "quota" }, { status: 400 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const processed = await processImage(buffer);

    const finalCheck = await checkUploadAllowed(processed.size);
    if (!finalCheck.allowed) {
      return NextResponse.json({ error: "quota" }, { status: 400 });
    }

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
        thumbnailSize: processed.thumbnail.length,
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

    return NextResponse.json({ ok: true, inspirationId: inspiration.id });
  } catch (err) {
    console.error("[SHARE UPLOAD-ONE ERROR]", err);
    return NextResponse.json({ error: "processing" }, { status: 500 });
  }
}
