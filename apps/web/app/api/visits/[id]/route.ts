import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { z } from "zod";

interface Params { params: Promise<{ id: string }> }

const patchSchema = z.object({
  place: z.string().min(1).max(255).optional(),
  exhibition: z.string().max(255).nullable().optional(),
  visitDate: z.string().optional(),
  notes: z.string().max(2000).nullable().optional(),
  // Rattacher / détacher des inspirations
  addInspirationIds: z.array(z.string()).max(500).optional(),
  removeInspirationIds: z.array(z.string()).max(500).optional(),
});

// PATCH /api/visits/[id]
export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { place, exhibition, visitDate, notes, addInspirationIds, removeInspirationIds } = parsed.data;

  const data: Record<string, unknown> = {};
  if (place !== undefined) data.place = place.trim();
  if (exhibition !== undefined) data.exhibition = exhibition?.trim() || null;
  if (notes !== undefined) data.notes = notes?.trim() || null;
  if (visitDate !== undefined) {
    const date = new Date(visitDate);
    if (isNaN(date.getTime())) {
      return NextResponse.json({ error: "Date invalide" }, { status: 400 });
    }
    data.visitDate = date;
  }

  const visit = Object.keys(data).length > 0
    ? await db.visit.update({ where: { id }, data })
    : await db.visit.findUnique({ where: { id } });

  if (!visit) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  if (addInspirationIds && addInspirationIds.length > 0) {
    await db.inspiration.updateMany({
      where: { id: { in: addInspirationIds } },
      data: { visitId: id },
    });
  }
  if (removeInspirationIds && removeInspirationIds.length > 0) {
    await db.inspiration.updateMany({
      where: { id: { in: removeInspirationIds }, visitId: id },
      data: { visitId: null },
    });
  }

  return NextResponse.json(visit);
}

// DELETE /api/visits/[id]
// Les inspirations rattachées ne sont pas supprimées (visitId → null via SetNull).
export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id } = await params;
  await db.visit.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
