import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { canEditResource } from "@/lib/access/resolve";
import { z } from "zod";

interface Params { params: Promise<{ id: string }> }

const createSchema = z.object({
  artworkTitle: z.string().max(300).optional(),
  artist: z.string().max(200).nullable().optional(),
  dateText: z.string().max(120).nullable().optional(),
  medium: z.string().max(300).nullable().optional(),
  dimensions: z.string().max(200).nullable().optional(),
  room: z.string().max(200).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

// POST /api/visits/[id]/cartel — crée un cartel (vide par défaut, la photo et
// les champs sont ajoutés ensuite via le pop-up).
export async function POST(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  if (!(await canEditResource("VISIT", id, session.user.id))) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const cartel = await db.visitCartel.create({
    data: {
      visitId: id,
      artworkTitle: parsed.data.artworkTitle ?? "",
      artist: parsed.data.artist ?? null,
      dateText: parsed.data.dateText ?? null,
      medium: parsed.data.medium ?? null,
      dimensions: parsed.data.dimensions ?? null,
      room: parsed.data.room ?? null,
      notes: parsed.data.notes ?? null,
    },
  });
  return NextResponse.json(cartel, { status: 201 });
}
