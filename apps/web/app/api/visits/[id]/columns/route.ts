import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { z } from "zod";
import { nextBlockOrder } from "@/lib/visits/blockOrder";

interface Params { params: Promise<{ id: string }> }

const createSchema = z.object({ order: z.number().int().optional() });

// POST /api/visits/[id]/columns — crée un bloc "2 colonnes" vide ; les slots
// (gauche/droite) sont assignés ensuite via PATCH.
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
  const columns = await db.visitColumns.create({ data: { visitId: id, order } });

  return NextResponse.json(columns, { status: 201 });
}
