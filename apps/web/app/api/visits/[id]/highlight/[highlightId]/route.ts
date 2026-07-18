import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { z } from "zod";

interface Params { params: Promise<{ id: string; highlightId: string }> }

const patchSchema = z.object({
  title: z.string().max(200).optional(),
  rating: z.number().int().min(0).max(5).optional(),
  note: z.string().max(2000).nullable().optional(),
});

// PATCH /api/visits/[id]/highlight/[highlightId]
export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id, highlightId } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const owned = await db.visit.findFirst({ where: { id, userId: session.user.id }, select: { id: true } });
  if (!owned) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const existing = await db.visitHighlight.findUnique({ where: { id: highlightId } });
  if (!existing || existing.visitId !== id) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const updated = await db.visitHighlight.update({ where: { id: highlightId }, data: parsed.data });
  return NextResponse.json(updated);
}

// DELETE /api/visits/[id]/highlight/[highlightId]
export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id, highlightId } = await params;
  const owned = await db.visit.findFirst({ where: { id, userId: session.user.id }, select: { id: true } });
  if (!owned) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const existing = await db.visitHighlight.findUnique({ where: { id: highlightId } });
  if (!existing || existing.visitId !== id) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  await db.visitHighlight.delete({ where: { id: highlightId } });
  return NextResponse.json({ ok: true });
}
