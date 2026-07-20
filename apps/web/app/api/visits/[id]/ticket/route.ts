import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { canEditResource } from "@/lib/access/resolve";
import { z } from "zod";

interface Params { params: Promise<{ id: string }> }

const createSchema = z.object({
  eventName: z.string().max(300).optional(),
  place: z.string().max(200).nullable().optional(),
  dateText: z.string().max(120).nullable().optional(),
  price: z.string().max(60).nullable().optional(),
  category: z.string().max(120).nullable().optional(),
});

// POST /api/visits/[id]/ticket — crée un billet (vide par défaut).
export async function POST(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  if (!(await canEditResource("VISIT", id, session.user.id))) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const ticket = await db.visitTicket.create({
    data: {
      visitId: id,
      eventName: parsed.data.eventName ?? "",
      place: parsed.data.place ?? null,
      dateText: parsed.data.dateText ?? null,
      price: parsed.data.price ?? null,
      category: parsed.data.category ?? null,
    },
  });
  return NextResponse.json(ticket, { status: 201 });
}
