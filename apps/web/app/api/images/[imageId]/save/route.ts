import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { uploadToR2 } from "@/lib/storage/r2";
import { getImageUrl } from "@/lib/storage/urls";
import { checkUploadAllowed } from "@/lib/storage/quota";

type Params = { params: Promise<{ imageId: string }> };

// POST /api/images/[imageId]/save — enregistre dans MA galerie une image reçue en
// message (copie R2 indépendante → chacun a la sienne, pas de comptage partagé).
export async function POST(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const me = session.user.id;
  const { imageId } = await params;

  // L'image doit m'avoir été partagée dans une de mes conversations.
  const shared = await db.message.findFirst({
    where: { sharedImageId: imageId, conversation: { OR: [{ userAId: me }, { userBId: me }] } },
    select: { id: true },
  });
  if (!shared) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const img = await db.image.findUnique({
    where: { id: imageId },
    include: { inspiration: { select: { title: true, author: true, year: true } } },
  });
  if (!img) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const bytes = img.size + img.thumbnailSize;
  const check = await checkUploadAllowed(me, bytes);
  if (!check.allowed) return NextResponse.json({ error: check.reason }, { status: 413 });

  // Copie les octets R2 (bucket public) sous de nouvelles clés.
  const origBuf = Buffer.from(await (await fetch(getImageUrl(img.storageKey))).arrayBuffer());
  const thumbBuf = img.thumbnailKey ? Buffer.from(await (await fetch(getImageUrl(img.thumbnailKey))).arrayBuffer()) : null;
  const uuid = randomUUID();
  const storageKey = `images/${uuid}.webp`;
  const thumbnailKey = `thumbs/${uuid}.webp`;
  await uploadToR2(storageKey, origBuf, img.mimeType || "image/webp");
  if (thumbBuf) await uploadToR2(thumbnailKey, thumbBuf, "image/webp");

  const inspiration = await db.inspiration.create({
    data: { userId: me, title: img.inspiration.title, author: img.inspiration.author, year: img.inspiration.year, status: "READY", isAccepted: true, mediaType: "IMAGE" },
  });
  await db.image.create({
    data: {
      inspirationId: inspiration.id,
      filename: `${uuid}.webp`,
      originalName: img.originalName,
      mimeType: img.mimeType,
      size: img.size,
      thumbnailSize: thumbBuf ? img.thumbnailSize : 0,
      width: img.width,
      height: img.height,
      storageKey,
      thumbnailKey: thumbBuf ? thumbnailKey : null,
      blurHash: img.blurHash,
      isMain: true,
      isAnimated: img.isAnimated,
    },
  });

  return NextResponse.json({ ok: true, inspirationId: inspiration.id });
}
