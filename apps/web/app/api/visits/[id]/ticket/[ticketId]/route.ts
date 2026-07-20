import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { canEditResource } from "@/lib/access/resolve";
import { deleteFromR2 } from "@/lib/storage/r2";
import { z } from "zod";

interface Params { params: Promise<{ id: string; ticketId: string }> }

const patchSchema = z.object({
  eventName: z.string().max(300).optional(),
  place: z.string().max(200).nullable().optional(),
  dateText: z.string().max(120).nullable().optional(),
  price: z.string().max(60).nullable().optional(),
  category: z.string().max(120).nullable().optional(),
});

// PATCH /api/visits/[id]/ticket/[ticketId]
export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id, ticketId } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  if (!(await canEditResource("VISIT", id, session.user.id))) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const existing = await db.visitTicket.findUnique({ where: { id: ticketId } });
  if (!existing || existing.visitId !== id) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const updated = await db.visitTicket.update({ where: { id: ticketId }, data: parsed.data });
  return NextResponse.json(updated);
}

// DELETE /api/visits/[id]/ticket/[ticketId] — supprime + purge la photo R2.
export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id, ticketId } = await params;
  if (!(await canEditResource("VISIT", id, session.user.id))) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const existing = await db.visitTicket.findUnique({ where: { id: ticketId } });
  if (!existing || existing.visitId !== id) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  await db.visitTicket.delete({ where: { id: ticketId } });
  if (existing.storageKey) await deleteFromR2(existing.storageKey).catch(() => {});
  if (existing.thumbnailKey) await deleteFromR2(existing.thumbnailKey).catch(() => {});
  return NextResponse.json({ ok: true });
}
