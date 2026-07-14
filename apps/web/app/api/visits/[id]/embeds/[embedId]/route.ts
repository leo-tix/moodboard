import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { z } from "zod";

interface Params { params: Promise<{ id: string; embedId: string }> }

// PATCH /api/visits/[id]/embeds/[embedId] — édition manuelle du titre/description
// d'une carte de lien (l'aperçu Open Graph n'est pas toujours parfait).
export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id, embedId } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = z
    .object({
      title: z.string().max(300).nullable().optional(),
      description: z.string().max(1000).nullable().optional(),
    })
    .safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const owned = await db.visit.findFirst({ where: { id, userId: session.user.id }, select: { id: true } });
  if (!owned) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const embed = await db.visitEmbed.findUnique({ where: { id: embedId } });
  if (!embed || embed.visitId !== id) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const updated = await db.visitEmbed.update({ where: { id: embedId }, data: parsed.data });
  return NextResponse.json(updated);
}

// DELETE /api/visits/[id]/embeds/[embedId] — supprime le bloc lien/embed.
// (Bloc top-level uniquement, jamais réclamé par une colonne — pas d'unclaim.)
export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id, embedId } = await params;
  const owned = await db.visit.findFirst({ where: { id, userId: session.user.id }, select: { id: true } });
  if (!owned) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const embed = await db.visitEmbed.findUnique({ where: { id: embedId } });
  if (!embed || embed.visitId !== id) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  await db.visitEmbed.delete({ where: { id: embedId } });
  return NextResponse.json({ ok: true });
}
