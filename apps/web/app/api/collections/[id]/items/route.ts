import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { canEditResource } from "@/lib/access/resolve";

type Params = { params: Promise<{ id: string }> };

// POST /api/collections/[id]/items — ajouter des images
export async function POST(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const userId = session.user.id;

  const { id } = await params;
  const { inspirationIds } = (await req.json()) as { inspirationIds: string[] };

  if (!inspirationIds?.length)
    return NextResponse.json({ error: "inspirationIds requis" }, { status: 400 });

  // Propriétaire OU éditeur (co-édition : ajout d'images à la collection).
  if (!(await canEditResource("COLLECTION", id, userId))) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  // Ne rattache que des inspirations possédées par le même profil (anti-IDOR)
  const ownedInsp = await db.inspiration.findMany({
    where: { id: { in: inspirationIds }, userId },
    select: { id: true },
  });
  const validIds = ownedInsp.map((i) => i.id);
  if (validIds.length === 0) return NextResponse.json({ success: true, added: 0 });

  // Déterminer l'ordre de départ
  const agg = await db.collectionItem.aggregate({
    where: { collectionId: id },
    _max: { order: true },
  });
  const baseOrder = (agg._max.order ?? -1) + 1;

  await db.collectionItem.createMany({
    data: validIds.map((inspirationId, i) => ({
      collectionId: id,
      inspirationId,
      order: baseOrder + i,
    })),
    skipDuplicates: true,
  });

  return NextResponse.json({ success: true });
}

// DELETE /api/collections/[id]/items — retirer des images
export async function DELETE(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id } = await params;
  const { inspirationIds } = (await req.json()) as { inspirationIds: string[] };

  // Propriétaire OU éditeur (co-édition : retrait d'images de la collection).
  if (!(await canEditResource("COLLECTION", id, session.user.id))) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  await db.collectionItem.deleteMany({
    where: { collectionId: id, inspirationId: { in: inspirationIds } },
  });

  return NextResponse.json({ success: true });
}
