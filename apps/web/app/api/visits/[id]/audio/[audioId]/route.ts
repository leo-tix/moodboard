import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { canEditResource } from "@/lib/access/resolve";
import { z } from "zod";
import { deleteFromR2 } from "@/lib/storage/r2";
import { parseWordTimings } from "@/lib/audio/wordTimings";

interface Params { params: Promise<{ id: string; audioId: string }> }

// PATCH /api/visits/[id]/audio/[audioId] — édite la transcription.
export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id, audioId } = await params;
  const body = await req.json().catch(() => ({}));
  // `wordTimings` OPTIONNEL : présent → c'est le résultat de la transcription de
  // fond, on le stocke. ABSENT → édition manuelle du texte, on efface les
  // timings (l'alignement mot-à-mot ne correspond plus).
  const parsed = z
    .object({ transcript: z.string().max(4000).nullable(), wordTimings: z.array(z.unknown()).optional() })
    .safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  if (!(await canEditResource("VISIT", id, session.user.id))) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const audio = await db.visitAudio.findUnique({ where: { id: audioId } });
  if (!audio || audio.visitId !== id) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const timings = "wordTimings" in parsed.data ? parseWordTimings(parsed.data.wordTimings) : null;
  const updated = await db.visitAudio.update({
    where: { id: audioId },
    data: {
      transcript: parsed.data.transcript?.trim() || null,
      // Prisma : `DbNull` pour vider un champ Json (pas `undefined`).
      wordTimings: (timings ?? Prisma.DbNull) as Prisma.InputJsonValue | typeof Prisma.DbNull,
    },
  });
  return NextResponse.json(updated);
}

// DELETE /api/visits/[id]/audio/[audioId]
export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id, audioId } = await params;
  if (!(await canEditResource("VISIT", id, session.user.id))) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const audio = await db.visitAudio.findUnique({ where: { id: audioId } });
  if (!audio || audio.visitId !== id) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  await db.visitAudio.delete({ where: { id: audioId } });
  await deleteFromR2(audio.storageKey).catch(() => {});
  return NextResponse.json({ ok: true });
}
