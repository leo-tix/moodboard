import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { z } from "zod";

interface Params { params: Promise<{ id: string }> }

const itemSchema = z.object({ id: z.string().min(1), text: z.string().max(500), done: z.boolean() });
const createSchema = z.object({
  title: z.string().max(200).nullable().optional(),
  items: z.array(itemSchema).max(100).optional(),
});

// POST /api/visits/[id]/checklist — crée une checklist (vide par défaut).
export async function POST(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const visit = await db.visit.findFirst({ where: { id, userId: session.user.id }, select: { id: true } });
  if (!visit) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const checklist = await db.visitChecklist.create({
    data: { visitId: id, title: parsed.data.title ?? null, items: parsed.data.items ?? [] },
  });
  return NextResponse.json(checklist, { status: 201 });
}
