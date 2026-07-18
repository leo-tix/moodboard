import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { z } from "zod";

interface Params { params: Promise<{ id: string }> }

// Coup de cœur / notation — carte mettant en avant une œuvre favorite.
const createSchema = z.object({
  title: z.string().max(200).optional(),
  rating: z.number().int().min(0).max(5).optional(),
  note: z.string().max(2000).optional(),
});

// POST /api/visits/[id]/highlight — crée une tuile coup de cœur (vide par
// défaut, éditée ensuite via le pop-up de réglages).
export async function POST(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const visit = await db.visit.findFirst({ where: { id, userId: session.user.id }, select: { id: true } });
  if (!visit) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const highlight = await db.visitHighlight.create({
    data: {
      visitId: id,
      title: parsed.data.title ?? "",
      rating: parsed.data.rating ?? 0,
      note: parsed.data.note ?? null,
    },
  });
  return NextResponse.json(highlight, { status: 201 });
}
