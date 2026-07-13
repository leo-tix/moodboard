import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { z } from "zod";

interface Params { params: Promise<{ id: string }> }

const reorderSchema = z.object({
  items: z.array(
    z.object({
      type: z.enum(["image", "note", "title", "quote", "audio", "columns"]),
      id: z.string(),
      order: z.number().int(),
    }),
  ).min(1).max(1000),
});

// POST /api/visits/[id]/reorder — persiste l'ordre du carnet en une transaction.
// Les 6 types de blocs (image/note/titre/citation/audio/colonnes) partagent le
// même espace de tri séquentiel — seule l'image utilise `visitOrder`, les autres `order`.
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
    parsed.data.items.map((item) => {
      if (item.type === "image") {
        return db.inspiration.updateMany({ where: { id: item.id, visitId: id }, data: { visitOrder: item.order } });
      }
      if (item.type === "note") {
        return db.visitNote.updateMany({ where: { id: item.id, visitId: id }, data: { order: item.order } });
      }
      if (item.type === "title") {
        return db.visitTitle.updateMany({ where: { id: item.id, visitId: id }, data: { order: item.order } });
      }
      if (item.type === "quote") {
        return db.visitQuote.updateMany({ where: { id: item.id, visitId: id }, data: { order: item.order } });
      }
      if (item.type === "audio") {
        return db.visitAudio.updateMany({ where: { id: item.id, visitId: id }, data: { order: item.order } });
      }
      return db.visitColumns.updateMany({ where: { id: item.id, visitId: id }, data: { order: item.order } });
    }),
  );

  return NextResponse.json({ ok: true });
}
