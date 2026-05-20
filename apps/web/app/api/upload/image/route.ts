import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { uploadToR2 } from "@/lib/storage/r2";
import { processImage } from "@/lib/image/process";
import { extractColors } from "@/lib/image/colors";
import { checkUploadAllowed, checkMimeType, QUOTA } from "@/lib/storage/quota";
import { randomUUID } from "crypto";

export async function POST(req: NextRequest) {
  // Auth
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const inspirationId = formData.get("inspirationId") as string | null;

  if (!file) return NextResponse.json({ error: "Fichier manquant" }, { status: 400 });

  // Vérification type MIME
  if (!checkMimeType(file.type)) {
    return NextResponse.json(
      { error: `Type non supporté. Acceptés : JPG, PNG, WebP, GIF, AVIF` },
      { status: 400 }
    );
  }

  // Vérification quota avant tout traitement
  const quotaCheck = await checkUploadAllowed(file.size);
  if (!quotaCheck.allowed) {
    return NextResponse.json({ error: quotaCheck.reason }, { status: 413 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());

    // Traitement : compression + thumbnail + blurHash
    const processed = await processImage(buffer);

    // Vérification quota avec la taille compressée (plus précis)
    const finalQuotaCheck = await checkUploadAllowed(processed.size);
    if (!finalQuotaCheck.allowed) {
      return NextResponse.json({ error: finalQuotaCheck.reason }, { status: 413 });
    }

    const uuid = randomUUID();
    const storageKey = `images/${uuid}.webp`;
    const thumbnailKey = `thumbs/${uuid}.webp`;

    // Upload vers R2
    await Promise.all([
      uploadToR2(storageKey, processed.original, "image/webp"),
      uploadToR2(thumbnailKey, processed.thumbnail, "image/webp"),
    ]);

    // Extraction couleurs dominantes
    const colors = await extractColors(processed.original);

    // Si une inspiration cible est fournie, on l'attache directement
    // Sinon on crée un enregistrement image standalone
    let imageRecord;

    if (inspirationId) {
      imageRecord = await db.image.create({
        data: {
          inspirationId,
          filename: `${uuid}.webp`,
          originalName: file.name,
          mimeType: "image/webp",
          size: processed.size,
          width: processed.width,
          height: processed.height,
          storageKey,
          thumbnailKey,
          blurHash: processed.blurHash,
          isMain: false,
        },
      });

      // Sauvegarde couleurs
      if (colors.length > 0) {
        await db.inspirationColor.createMany({
          data: colors.map((c, i) => ({
            inspirationId,
            hex: c.hex,
            r: c.r,
            g: c.g,
            b: c.b,
            percentage: c.percentage,
            order: i,
          })),
          skipDuplicates: true,
        });
      }
    }

    return NextResponse.json({
      success: true,
      image: {
        storageKey,
        thumbnailKey,
        blurHash: processed.blurHash,
        width: processed.width,
        height: processed.height,
        size: processed.size,
        colors,
      },
    });
  } catch (error) {
    console.error("[UPLOAD ERROR]", error);
    return NextResponse.json({ error: "Erreur lors du traitement" }, { status: 500 });
  }
}

// Limite la taille du body à MAX_FILE_SIZE_BYTES
export const config = {
  api: {
    bodyParser: false,
  },
};
