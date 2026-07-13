import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { z } from "zod";
import { nextBlockOrder } from "@/lib/visits/blockOrder";

interface Params { params: Promise<{ id: string }> }

const createSchema = z.object({
  content: z.string().max(4000).default(""),
  order: z.number().int().optional(),
});

// POST /api/visits/[id]/quotes — crée un bloc citation autonome du carnet.
export async function POST(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const visit = await db.visit.findFirst({ where: { id, userId: session.user.id }, select: { id: true } });
  if (!visit) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const order = parsed.data.order ?? (await nextBlockOrder(id));
  const quote = await db.visitQuote.create({
    data: { visitId: id, content: parsed.data.content, order },
  });

  return NextResponse.json(quote, { status: 201 });
}
