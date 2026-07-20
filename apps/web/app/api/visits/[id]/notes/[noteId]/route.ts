import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { canEditResource } from "@/lib/access/resolve";
import { z } from "zod";

interface Params { params: Promise<{ id: string; noteId: string }> }

// PATCH /api/visits/[id]/notes/[noteId]
export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id, noteId } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = z.object({ content: z.string().max(20000) }).safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  if (!(await canEditResource("VISIT", id, session.user.id))) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const note = await db.visitNote.findUnique({ where: { id: noteId } });
  if (!note || note.visitId !== id) {
    return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  }

  const updated = await db.visitNote.update({
    where: { id: noteId },
    data: { content: parsed.data.content },
  });
  return NextResponse.json(updated);
}

// DELETE /api/visits/[id]/notes/[noteId]
export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id, noteId } = await params;
  if (!(await canEditResource("VISIT", id, session.user.id))) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const note = await db.visitNote.findUnique({ where: { id: noteId } });
  if (!note || note.visitId !== id) {
    return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  }

  await db.visitNote.delete({ where: { id: noteId } });
  return NextResponse.json({ ok: true });
}
