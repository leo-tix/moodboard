import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { deleteFromR2 } from "@/lib/storage/r2";
import { resolveAccess, canEdit, canView, deleteGrantsFor } from "@/lib/access/resolve";

interface Params { params: Promise<{ id: string }> }

// GET /api/moodboards/[id] — accessible à quiconque a un accès (lecture partagée).
export async function GET(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id } = await params;
  if (!canView(await resolveAccess("MOODBOARD", id, session.user.id))) {
    return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  }
  const moodboard = await db.moodboard.findUnique({ where: { id } });
  if (!moodboard) return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  return NextResponse.json(moodboard);
}

// PATCH /api/moodboards/[id] — propriétaire OU éditeur (co-édition planche).
export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();

  if (!canEdit(await resolveAccess("MOODBOARD", id, session.user.id))) {
    return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  }

  const data: Record<string, unknown> = {};
  if (body.title !== undefined) data.title = body.title;
  if (body.canvasData !== undefined) data.canvasData = body.canvasData;
  if (body.pencilStrokes !== undefined) data.pencilStrokes = body.pencilStrokes;
  if (body.background !== undefined) data.background = body.background;

  const moodboard = await db.moodboard.update({ where: { id }, data });
  return NextResponse.json(moodboard);
}

// DELETE /api/moodboards/[id]
export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id } = await params;
  // Récupère les storageKey des mémos audio AVANT la suppression — le
  // cascade delete Prisma nettoie les lignes MoodboardAudio mais jamais les
  // objets R2 sous-jacents (même filet que la suppression d'une visite,
  // voir deleteAllAudioForVisit).
  const audioClips = await db.moodboardAudio.findMany({
    where: { moodboardId: id, moodboard: { userId: session.user.id } },
    select: { storageKey: true },
  });

  const res = await db.moodboard.deleteMany({ where: { id, userId: session.user.id } });
  if (res.count === 0) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  await deleteGrantsFor("MOODBOARD", id); // ACL polymorphe : pas de cascade DB
  await Promise.allSettled(audioClips.map((a) => deleteFromR2(a.storageKey)));
  return NextResponse.json({ ok: true });
}
