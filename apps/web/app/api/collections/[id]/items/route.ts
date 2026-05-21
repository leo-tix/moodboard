import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

// POST /api/collections/[id]/items — ajouter des images
export async function POST(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id } = await params;
  const { inspirationIds } = (await req.json()) as { inspirationIds: string[] };

  if (!inspirationIds?.length)
    return NextResponse.json({ error: "inspirationIds requis" }, { status: 400 });

  // Déterminer l'ordre de départ
  const agg = await db.collectionItem.aggregate({
    where: { collectionId: id },
    _max: { order: true },
  });
  const baseOrder = (agg._max.order ?? -1) + 1;

  await db.collectionItem.createMany({
    data: inspirationIds.map((inspirationId, i) => ({
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
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id } = await params;
  const { inspirationIds } = (await req.json()) as { inspirationIds: string[] };

  await db.collectionItem.deleteMany({
    where: { collectionId: id, inspirationId: { in: inspirationIds } },
  });

  return NextResponse.json({ success: true });
}
