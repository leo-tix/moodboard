import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { defaultVisibilityFor } from "@/lib/access/share";
import { z } from "zod";

// GET /api/visits — liste chronologique avec compte + 4 premières vignettes
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const visits = await db.visit.findMany({
    where: { userId: session.user.id },
    orderBy: { visitDate: "desc" },
    include: {
      _count: { select: { inspirations: true } },
      inspirations: {
        take: 4,
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          images: {
            where: { isMain: true },
            take: 1,
            select: { thumbnailKey: true, blurHash: true },
          },
        },
      },
    },
  });

  return NextResponse.json(visits);
}

const createSchema = z.object({
  place: z.string().min(1).max(255),
  exhibition: z.string().max(255).optional(),
  visitDate: z.string(), // ISO date
  notes: z.string().max(2000).optional(),
  // Géolocalisation (autocomplétion OpenStreetMap/Photon)
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  address: z.string().max(500).optional(),
  // Optionnel : rattacher immédiatement des inspirations (batch upload)
  inspirationIds: z.array(z.string()).max(500).optional(),
});

// POST /api/visits — crée une visite, rattache éventuellement des images
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const userId = session.user.id;

  const body = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { place, exhibition, visitDate, notes, latitude, longitude, address, inspirationIds } = parsed.data;
  const date = new Date(visitDate);
  if (isNaN(date.getTime())) {
    return NextResponse.json({ error: "Date invalide" }, { status: 400 });
  }

  // Réutilise une visite identique (même lieu + expo + jour) plutôt que de
  // créer un doublon si l'utilisateur fait plusieurs imports pour la même visite.
  const dayStart = new Date(date); dayStart.setHours(0, 0, 0, 0);
  const dayEnd   = new Date(date); dayEnd.setHours(23, 59, 59, 999);

  let visit = await db.visit.findFirst({
    where: {
      userId,
      place: { equals: place.trim(), mode: "insensitive" },
      exhibition: exhibition?.trim()
        ? { equals: exhibition.trim(), mode: "insensitive" }
        : null,
      visitDate: { gte: dayStart, lte: dayEnd },
    },
  });

  if (!visit) {
    visit = await db.visit.create({
      data: {
        userId,
        place: place.trim(),
        exhibition: exhibition?.trim() || null,
        visitDate: date,
        notes: notes?.trim() || null,
        latitude: latitude ?? null,
        longitude: longitude ?? null,
        address: address?.trim() || null,
        visibility: await defaultVisibilityFor(userId, "VISIT"),
      },
    });
  } else if (latitude !== undefined && longitude !== undefined && visit.latitude === null) {
    // Visite dédupliquée sans geo : enrichir avec la position fournie
    visit = await db.visit.update({
      where: { id: visit.id },
      data: { latitude, longitude, address: address?.trim() || null },
    });
  }

  if (inspirationIds && inspirationIds.length > 0) {
    // Append en fin de carnet : après le plus grand ordre existant (images + notes),
    // les ex æquo se départagent par createdAt (ordre chrono naturel).
    const [maxImg, maxNote] = await Promise.all([
      db.inspiration.aggregate({ where: { visitId: visit.id }, _max: { visitOrder: true } }),
      db.visitNote.aggregate({ where: { visitId: visit.id }, _max: { order: true } }),
    ]);
    const nextOrder = Math.max(maxImg._max.visitOrder ?? -1, maxNote._max.order ?? -1) + 1;
    await db.inspiration.updateMany({
      where: { id: { in: inspirationIds }, userId },
      data: { visitId: visit.id, visitOrder: nextOrder },
    });
  }

  return NextResponse.json(visit, { status: 201 });
}
