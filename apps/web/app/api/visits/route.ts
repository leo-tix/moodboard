import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { z } from "zod";

// GET /api/visits — liste chronologique avec compte + 4 premières vignettes
export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const visits = await db.visit.findMany({
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
  // Optionnel : rattacher immédiatement des inspirations (batch upload)
  inspirationIds: z.array(z.string()).max(500).optional(),
});

// POST /api/visits — crée une visite, rattache éventuellement des images
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { place, exhibition, visitDate, notes, inspirationIds } = parsed.data;
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
        place: place.trim(),
        exhibition: exhibition?.trim() || null,
        visitDate: date,
        notes: notes?.trim() || null,
      },
    });
  }

  if (inspirationIds && inspirationIds.length > 0) {
    await db.inspiration.updateMany({
      where: { id: { in: inspirationIds } },
      data: { visitId: visit.id },
    });
  }

  return NextResponse.json(visit, { status: 201 });
}
