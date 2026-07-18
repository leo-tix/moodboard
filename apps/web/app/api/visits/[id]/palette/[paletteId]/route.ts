import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { deleteFromR2 } from "@/lib/storage/r2";
import { z } from "zod";

interface Params { params: Promise<{ id: string; paletteId: string }> }

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const patchSchema = z.object({
  title: z.string().max(200).nullable().optional(),
  colors: z.array(hex).max(12).optional(),
});

// PATCH /api/visits/[id]/palette/[paletteId]
export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id, paletteId } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const owned = await db.visit.findFirst({ where: { id, userId: session.user.id }, select: { id: true } });
  if (!owned) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const existing = await db.visitPalette.findUnique({ where: { id: paletteId } });
  if (!existing || existing.visitId !== id) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const updated = await db.visitPalette.update({ where: { id: paletteId }, data: parsed.data });
  return NextResponse.json(updated);
}

// DELETE /api/visits/[id]/palette/[paletteId] — supprime + purge la vignette R2.
export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id, paletteId } = await params;
  const owned = await db.visit.findFirst({ where: { id, userId: session.user.id }, select: { id: true } });
  if (!owned) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const existing = await db.visitPalette.findUnique({ where: { id: paletteId } });
  if (!existing || existing.visitId !== id) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  await db.visitPalette.delete({ where: { id: paletteId } });
  if (existing.sourceKey) await deleteFromR2(existing.sourceKey).catch(() => {});
  return NextResponse.json({ ok: true });
}
