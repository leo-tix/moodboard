import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { z } from "zod";
import { deleteFromR2 } from "@/lib/storage/r2";

interface Params { params: Promise<{ id: string; audioId: string }> }

// PATCH /api/visits/[id]/audio/[audioId] — édite la transcription.
export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id, audioId } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = z.object({ transcript: z.string().max(4000).nullable() }).safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const owned = await db.visit.findFirst({ where: { id, userId: session.user.id }, select: { id: true } });
  if (!owned) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const audio = await db.visitAudio.findUnique({ where: { id: audioId } });
  if (!audio || audio.visitId !== id) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  // Éditer le transcript invalide l'alignement mot-à-mot de Whisper (les mots
  // ne correspondent plus) → on efface les timings, l'UI retombe sur
  // l'estimation. Prisma: `null` (pas `undefined`) pour vider un champ Json.
  const updated = await db.visitAudio.update({
    where: { id: audioId },
    data: { transcript: parsed.data.transcript?.trim() || null, wordTimings: Prisma.DbNull },
  });
  return NextResponse.json(updated);
}

// DELETE /api/visits/[id]/audio/[audioId]
export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id, audioId } = await params;
  const owned = await db.visit.findFirst({ where: { id, userId: session.user.id }, select: { id: true } });
  if (!owned) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const audio = await db.visitAudio.findUnique({ where: { id: audioId } });
  if (!audio || audio.visitId !== id) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  await db.visitAudio.delete({ where: { id: audioId } });
  await deleteFromR2(audio.storageKey).catch(() => {});
  return NextResponse.json({ ok: true });
}
