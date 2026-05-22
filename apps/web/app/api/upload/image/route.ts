import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { uploadToR2 } from "@/lib/storage/r2";
import { processImage } from "@/lib/image/process";
import { extractColors } from "@/lib/image/colors";
import { checkUploadAllowed, checkMimeType } from "@/lib/storage/quota";
import { randomUUID } from "crypto";
import path from "path";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const title = (formData.get("title") as string | null) ?? "";

  if (!file) return NextResponse.json({ error: "Fichier manquant" }, { status: 400 });

  if (!checkMimeType(file.type)) {
    return NextResponse.json(
      { error: "Type non supporté. Acceptés : JPG, PNG, WebP, GIF, AVIF" },
      { status: 400 }
    );
  }

  const quotaCheck = await checkUploadAllowed(file.size);
  if (!quotaCheck.allowed) {
    return NextResponse.json({ error: quotaCheck.reason }, { status: 413 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const processed = await processImage(buffer);

    // Re-vérifie avec la taille réelle après compression
    const finalCheck = await checkUploadAllowed(processed.size);
    if (!finalCheck.allowed) {
      return NextResponse.json({ error: finalCheck.reason }, { status: 413 });
    }

    const uuid = randomUUID();
    const storageKey = `images/${uuid}.webp`;
    const thumbnailKey = `thumbs/${uuid}.webp`;

    // Titre par défaut = nom du fichier sans extension
    const defaultTitle =
      title.trim() ||
      path.basename(file.name, path.extname(file.name)).replace(/[-_]/g, " ");

    // Upload vers R2 et création en DB en parallèle
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

    // Couleurs extraites en parallèle avec création de l'image
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
          hex: c.hex,
          r: c.r,
          g: c.g,
          b: c.b,
          percentage: c.percentage,
          order: i,
        })),
      });
    }

    // Passe en READY
    await db.inspiration.update({
      where: { id: inspiration.id },
      data: { status: "READY" },
    });

    return NextResponse.json({
      success: true,
      inspirationId: inspiration.id,
      image: { storageKey, thumbnailKey, blurHash: processed.blurHash },
    });
  } catch (error) {
    console.error("[UPLOAD ERROR]", error);
    return NextResponse.json({ error: "Erreur lors du traitement" }, { status: 500 });
  }
}
