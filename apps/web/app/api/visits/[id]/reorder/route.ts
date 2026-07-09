import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { z } from "zod";

interface Params { params: Promise<{ id: string }> }

const reorderSchema = z.object({
  items: z.array(
    z.object({
      type: z.enum(["image", "note"]),
      id: z.string(),
      order: z.number().int(),
    }),
  ).min(1).max(1000),
});

// POST /api/visits/[id]/reorder — persiste l'ordre du carnet en une transaction.
// Images (Inspiration.visitOrder) et notes (VisitNote.order) partagent le même
// espace de tri séquentiel.
export async function POST(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = reorderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const owned = await db.visit.findFirst({
    where: { id, userId: session.user.id },
    select: { id: true },
  });
  if (!owned) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  await db.$transaction(
    parsed.data.items.map((item) =>
      item.type === "image"
        ? db.inspiration.updateMany({
            where: { id: item.id, visitId: id },
            data: { visitOrder: item.order },
          })
        : db.visitNote.updateMany({
            where: { id: item.id, visitId: id },
            data: { order: item.order },
          }),
    ),
  );

  return NextResponse.json({ ok: true });
}
