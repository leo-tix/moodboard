import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { z } from "zod";

interface Params { params: Promise<{ id: string }> }

const createSchema = z.object({
  content: z.string().max(5000).default(""),
  // Position dans le carnet ; si absent → fin de séquence
  order: z.number().int().optional(),
});

// POST /api/visits/[id]/notes — crée un bloc de note dans le carnet
export async function POST(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const visit = await db.visit.findFirst({
    where: { id, userId: session.user.id },
    select: { id: true },
  });
  if (!visit) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  let order = parsed.data.order;
  if (order === undefined) {
    const [maxImg, maxNote] = await Promise.all([
      db.inspiration.aggregate({ where: { visitId: id }, _max: { visitOrder: true } }),
      db.visitNote.aggregate({ where: { visitId: id }, _max: { order: true } }),
    ]);
    order = Math.max(maxImg._max.visitOrder ?? -1, maxNote._max.order ?? -1) + 1;
  }

  const note = await db.visitNote.create({
    data: { visitId: id, content: parsed.data.content, order },
  });

  return NextResponse.json(note, { status: 201 });
}
