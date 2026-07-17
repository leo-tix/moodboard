import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { z } from "zod";

interface Params { params: Promise<{ id: string }> }

const createSchema = z.object({
  locationName: z.string().min(1).max(200),
  latitude: z.number(),
  longitude: z.number(),
});

// POST /api/visits/[id]/map — crée un bloc carte (tuile bento), distinct de
// Visit.latitude/longitude (géoloc globale de la visite, carte de couverture).
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

  const map = await db.visitMapBlock.create({ data: { visitId: id, ...parsed.data } });
  return NextResponse.json(map, { status: 201 });
}
