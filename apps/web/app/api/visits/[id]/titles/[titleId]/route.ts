import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { canEditResource } from "@/lib/access/resolve";
import { z } from "zod";

interface Params { params: Promise<{ id: string; titleId: string }> }

// PATCH /api/visits/[id]/titles/[titleId]
export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id, titleId } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = z.object({ content: z.string().max(500) }).safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  if (!(await canEditResource("VISIT", id, session.user.id))) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const title = await db.visitTitle.findUnique({ where: { id: titleId } });
  if (!title || title.visitId !== id) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const updated = await db.visitTitle.update({ where: { id: titleId }, data: { content: parsed.data.content } });
  return NextResponse.json(updated);
}

// DELETE /api/visits/[id]/titles/[titleId]
export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id, titleId } = await params;
  if (!(await canEditResource("VISIT", id, session.user.id))) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const title = await db.visitTitle.findUnique({ where: { id: titleId } });
  if (!title || title.visitId !== id) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  await db.visitTitle.delete({ where: { id: titleId } });
  return NextResponse.json({ ok: true });
}
