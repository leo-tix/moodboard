import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { canEditResource } from "@/lib/access/resolve";

type Params = { params: Promise<{ id: string }> };

// POST /api/collections/[id]/items/reorder — persiste l'ordre des images.
// Body: { order: string[] } (inspirationIds dans le nouvel ordre).
export async function POST(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const { id } = await params;

  // Propriétaire OU éditeur (co-édition).
  if (!(await canEditResource("COLLECTION", id, session.user.id))) {
    return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const order = body.order as string[] | undefined;
  if (!Array.isArray(order) || order.length === 0) {
    return NextResponse.json({ error: "order manquant" }, { status: 400 });
  }

  await db.$transaction(
    order.map((inspirationId, i) =>
      db.collectionItem.updateMany({
        where: { collectionId: id, inspirationId },
        data: { order: i },
      }),
    ),
  );

  return NextResponse.json({ ok: true });
}
