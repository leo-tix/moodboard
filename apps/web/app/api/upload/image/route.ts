import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { uploadToR2 } from "@/lib/storage/r2";
import { processImage } from "@/lib/image/process";
import { extractColors } from "@/lib/image/colors";
import { checkUploadAllowed, checkMimeType, QUOTA } from "@/lib/storage/quota";
import { randomUUID } from "crypto";
import path from "path";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const userId = session.user.id;

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

  // Contrôle d'ENTRÉE large : l'image est recompressée juste après (WebP
  // redimensionné), donc la taille brute n'a pas à être jugée avec le plafond
  // de stockage. Seul le plafond d'entrée (RAM/bande passante) s'applique ici ;
  // le vrai contrôle de quota se fait plus bas, sur la taille APRÈS traitement.
  const quotaCheck = await checkUploadAllowed(userId, file.size, QUOTA.MAX_UPLOAD_SIZE_BYTES);
  if (!quotaCheck.allowed) {
    return NextResponse.json({ error: quotaCheck.reason }, { status: 413 });
  }

  let processed;
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    processed = await processImage(buffer);
  } catch (error) {
    // Décodage impossible : format exotique (HEIC non converti par le client,
    // RAW…) ou fichier corrompu. Message EXPLICITE — un 500 générique laissait
    // l'utilisateur sans piste (retour 2026-08-05).
    console.error("[UPLOAD ERROR] decode", error);
    return NextResponse.json(
      { error: "Image illisible ou format non pris en charge (HEIC, RAW…). Réessaie en JPG ou PNG." },
      { status: 400 }
    );
  }

  try {
    // Vrai contrôle de quota : taille réelle après compression.
    const finalCheck = await checkUploadAllowed(userId, processed.size);
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
          userId,
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
    return NextResponse.json(
      { error: "Erreur serveur pendant l'enregistrement de l'image. Réessaie." },
      { status: 500 }
    );
  }
}
