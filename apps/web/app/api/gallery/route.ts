import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { getImageUrl, getThumbnailUrl } from "@/lib/storage/urls";

// GET /api/gallery?q= — mes images (image principale par inspiration) pour les
// joindre en message. Renvoie l'id d'IMAGE (= Message.sharedImageId).
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";

  const rows = await db.inspiration.findMany({
    where: { userId: session.user.id, status: "READY", isAccepted: true, isArchived: false, images: { some: {} }, ...(q ? { title: { contains: q, mode: "insensitive" as const } } : {}) },
    select: { title: true, images: { orderBy: [{ isMain: "desc" }, { order: "asc" }], take: 1, select: { id: true, thumbnailKey: true, storageKey: true } } },
    orderBy: { createdAt: "desc" },
    take: 60,
  });

  const images = rows
    .map((r) => { const img = r.images[0]; return img ? { imageId: img.id, title: r.title, url: img.thumbnailKey ? getThumbnailUrl(img.thumbnailKey) : getImageUrl(img.storageKey) } : null; })
    .filter(Boolean);
  return NextResponse.json({ images });
}
