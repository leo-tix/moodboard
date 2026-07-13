import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { z } from "zod";
import { deleteAllAudioForVisit } from "@/lib/visits/audioCleanup";
import { nextBlockOrder } from "@/lib/visits/blockOrder";

interface Params { params: Promise<{ id: string }> }

const patchSchema = z.object({
  place: z.string().min(1).max(255).optional(),
  exhibition: z.string().max(255).nullable().optional(),
  visitDate: z.string().optional(),
  notes: z.string().max(2000).nullable().optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  address: z.string().max(500).nullable().optional(),
  // Rattacher / détacher des inspirations
  addInspirationIds: z.array(z.string()).max(500).optional(),
  removeInspirationIds: z.array(z.string()).max(500).optional(),
});

// PATCH /api/visits/[id]
export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const userId = session.user.id;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // La visite doit appartenir au profil
  const ownedVisit = await db.visit.findFirst({ where: { id, userId }, select: { id: true } });
  if (!ownedVisit) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const { place, exhibition, visitDate, notes, latitude, longitude, address, addInspirationIds, removeInspirationIds } = parsed.data;

  const data: Record<string, unknown> = {};
  if (place !== undefined) data.place = place.trim();
  if (exhibition !== undefined) data.exhibition = exhibition?.trim() || null;
  if (notes !== undefined) data.notes = notes?.trim() || null;
  if (latitude !== undefined) data.latitude = latitude;
  if (longitude !== undefined) data.longitude = longitude;
  if (address !== undefined) data.address = address?.trim() || null;
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
    // Append en fin de carnet (même logique que POST /api/visits)
    const nextOrder = await nextBlockOrder(id);
    await db.inspiration.updateMany({
      where: { id: { in: addInspirationIds }, userId },
      data: { visitId: id, visitOrder: nextOrder },
    });
  }
  if (removeInspirationIds && removeInspirationIds.length > 0) {
    await db.inspiration.updateMany({
      where: { id: { in: removeInspirationIds }, visitId: id, userId },
      data: { visitId: null },
    });
    // Une image détachée de la visite ne peut plus rester réclamée par une
    // colonne de son carnet (sans ça la colonne pointerait vers une image
    // qui n'appartient plus à cette visite).
    await db.visitColumns.updateMany({
      where: { visitId: id, leftType: "IMAGE", leftId: { in: removeInspirationIds } },
      data: { leftType: null, leftId: null },
    });
    await db.visitColumns.updateMany({
      where: { visitId: id, rightType: "IMAGE", rightId: { in: removeInspirationIds } },
      data: { rightType: null, rightId: null },
    });
  }

  return NextResponse.json(visit);
}

// DELETE /api/visits/[id]
// Les inspirations rattachées ne sont pas supprimées (visitId → null via SetNull).
export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id } = await params;
  const owned = await db.visit.findFirst({ where: { id, userId: session.user.id }, select: { id: true } });
  if (!owned) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  // Le cascade Prisma nettoie les lignes VisitAudio, pas les objets R2 —
  // purger AVANT le delete (après, on n'a plus les storageKey).
  await deleteAllAudioForVisit(id).catch(() => {});
  await db.visit.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
