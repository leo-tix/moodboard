import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { resolveAccess, canView } from "@/lib/access/resolve";
import { saveImageToLibrary } from "@/lib/images/saveToLibrary";

type Params = { params: Promise<{ id: string }> };

// POST /api/collections/[id]/save — enregistre dans MA bibliothèque une image
// vue dans une collection à laquelle j'ai accès (copie R2 indépendante). Utile
// quand l'image n'est pas la mienne (collection partagée).
export async function POST(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const me = session.user.id;
  const { id } = await params;
  const { imageId } = (await req.json().catch(() => ({}))) as { imageId?: string };
  if (!imageId) return NextResponse.json({ error: "imageId requis" }, { status: 400 });

  // Il faut avoir accès à la collection…
  if (!canView(await resolveAccess("COLLECTION", id, me))) {
    return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  }
  // …ET l'image doit réellement appartenir à un item de CETTE collection
  // (anti-abus : pas d'enregistrement d'une image arbitraire via une collection).
  const item = await db.collectionItem.findFirst({
    where: { collectionId: id, inspiration: { images: { some: { id: imageId } } } },
    select: { collectionId: true },
  });
  if (!item) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const res = await saveImageToLibrary(imageId, me);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  return NextResponse.json({ ok: true, inspirationId: res.inspirationId });
}
