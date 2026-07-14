import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { deleteFromR2 } from "@/lib/storage/r2";

interface Params { params: Promise<{ id: string; audioId: string }> }

// DELETE /api/moodboards/[id]/audio/[audioId] — appelée quand un bloc audio
// est retiré du canvas (voir MoodboardEditor.tsx) : supprime la ligne
// MoodboardAudio ET l'objet R2. Sans cet appel explicite, retirer le bloc de
// `canvasData` (simple tableau JSON) ne nettoierait jamais le stockage —
// même filet anti-orphelins que le carnet de visite.
export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id, audioId } = await params;
  const owned = await db.moodboard.findFirst({ where: { id, userId: session.user.id }, select: { id: true } });
  if (!owned) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const audio = await db.moodboardAudio.findFirst({ where: { id: audioId, moodboardId: id } });
  if (!audio) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  await db.moodboardAudio.delete({ where: { id: audioId } });
  await deleteFromR2(audio.storageKey).catch(() => {});

  return NextResponse.json({ ok: true });
}

// PATCH /api/moodboards/[id]/audio/[audioId] — édite la transcription.
export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id, audioId } = await params;
  const owned = await db.moodboard.findFirst({ where: { id, userId: session.user.id }, select: { id: true } });
  if (!owned) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const transcript = typeof body.transcript === "string" ? body.transcript.trim() || null : undefined;
  if (transcript === undefined) return NextResponse.json({ error: "transcript requis" }, { status: 400 });

  const updated = await db.moodboardAudio.updateMany({ where: { id: audioId, moodboardId: id }, data: { transcript } });
  if (updated.count === 0) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  return NextResponse.json({ ok: true });
}
