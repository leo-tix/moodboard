import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { canEditResource } from "@/lib/access/resolve";
import { z } from "zod";

interface Params { params: Promise<{ id: string; timelineId: string }> }

const eventSchema = z.object({
  id: z.string().min(1),
  dateText: z.string().max(120),
  label: z.string().max(300),
  description: z.string().max(1000).optional(),
});
const patchSchema = z.object({
  title: z.string().max(200).nullable().optional(),
  events: z.array(eventSchema).max(100).optional(),
});

// PATCH /api/visits/[id]/timeline/[timelineId]
export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id, timelineId } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  if (!(await canEditResource("VISIT", id, session.user.id))) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const existing = await db.visitTimeline.findUnique({ where: { id: timelineId } });
  if (!existing || existing.visitId !== id) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const updated = await db.visitTimeline.update({ where: { id: timelineId }, data: parsed.data });
  return NextResponse.json(updated);
}

// DELETE /api/visits/[id]/timeline/[timelineId]
export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id, timelineId } = await params;
  if (!(await canEditResource("VISIT", id, session.user.id))) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const existing = await db.visitTimeline.findUnique({ where: { id: timelineId } });
  if (!existing || existing.visitId !== id) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  await db.visitTimeline.delete({ where: { id: timelineId } });
  return NextResponse.json({ ok: true });
}
