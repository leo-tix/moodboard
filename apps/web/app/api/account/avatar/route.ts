import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { randomUUID } from "crypto";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { uploadToR2, deleteFromR2 } from "@/lib/storage/r2";
import { checkMimeType } from "@/lib/storage/quota";

const AVATAR_SIZE = 400;
const MAX_INPUT_BYTES = 8 * 1024 * 1024; // 8 MB en entrée (avant recadrage)

// POST /api/account/avatar — recadre en carré, upload R2, remplace l'ancien
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "Aucun fichier" }, { status: 400 });
  }
  if (file.size > MAX_INPUT_BYTES) {
    return NextResponse.json({ error: "Image trop lourde (max 8 Mo)" }, { status: 400 });
  }
  if (!checkMimeType(file.type)) {
    return NextResponse.json({ error: "Format non supporté" }, { status: 400 });
  }

  try {
    const input = Buffer.from(await file.arrayBuffer());
    // Recadrage carré centré sur le sujet, sortie WebP compacte
    const output = await sharp(input, { failOn: "none" })
      .rotate() // respecte l'orientation EXIF
      .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: "cover", position: "attention" })
      .webp({ quality: 82 })
      .toBuffer();

    // Clé horodatée → contourne le cache CDN sur l'URL publique lors d'un remplacement
    const key = `avatars/${session.user.id}-${randomUUID()}.webp`;
    await uploadToR2(key, output, "image/webp");

    // Récupère l'ancienne clé pour la supprimer ensuite (best-effort)
    const prev = await db.user.findUnique({
      where: { id: session.user.id },
      select: { image: true },
    });

    await db.user.update({
      where: { id: session.user.id },
      data: { image: key, imageSize: output.length },
    });

    if (prev?.image && prev.image !== key) {
      deleteFromR2(prev.image).catch(() => {});
    }

    return NextResponse.json({ ok: true, image: key });
  } catch (err) {
    console.error("[AVATAR UPLOAD ERROR]", err);
    return NextResponse.json({ error: "Traitement de l'image échoué" }, { status: 500 });
  }
}

// DELETE /api/account/avatar — retire la photo de profil
export async function DELETE() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { image: true },
  });

  if (user?.image) {
    deleteFromR2(user.image).catch(() => {});
    await db.user.update({
      where: { id: session.user.id },
      data: { image: null, imageSize: 0 },
    });
  }

  return NextResponse.json({ ok: true });
}
