import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { canEditResource } from "@/lib/access/resolve";
import { z } from "zod";

interface Params { params: Promise<{ id: string; checklistId: string }> }

const itemSchema = z.object({ id: z.string().min(1), text: z.string().max(500), done: z.boolean() });
const patchSchema = z.object({
  title: z.string().max(200).nullable().optional(),
  items: z.array(itemSchema).max(100).optional(),
});

// PATCH /api/visits/[id]/checklist/[checklistId]
export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id, checklistId } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  if (!(await canEditResource("VISIT", id, session.user.id))) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const existing = await db.visitChecklist.findUnique({ where: { id: checklistId } });
  if (!existing || existing.visitId !== id) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const updated = await db.visitChecklist.update({ where: { id: checklistId }, data: parsed.data });
  return NextResponse.json(updated);
}

// DELETE /api/visits/[id]/checklist/[checklistId]
export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id, checklistId } = await params;
  if (!(await canEditResource("VISIT", id, session.user.id))) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const existing = await db.visitChecklist.findUnique({ where: { id: checklistId } });
  if (!existing || existing.visitId !== id) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  await db.visitChecklist.delete({ where: { id: checklistId } });
  return NextResponse.json({ ok: true });
}
