import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { canEditResource } from "@/lib/access/resolve";
import { z } from "zod";

interface Params { params: Promise<{ id: string }> }

const eventSchema = z.object({
  id: z.string().min(1),
  dateText: z.string().max(120),
  label: z.string().max(300),
  description: z.string().max(1000).optional(),
});
const createSchema = z.object({
  title: z.string().max(200).nullable().optional(),
  events: z.array(eventSchema).max(100).optional(),
});

// POST /api/visits/[id]/timeline — crée une frise (vide par défaut).
export async function POST(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  if (!(await canEditResource("VISIT", id, session.user.id))) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const timeline = await db.visitTimeline.create({
    data: { visitId: id, title: parsed.data.title ?? null, events: parsed.data.events ?? [] },
  });
  return NextResponse.json(timeline, { status: 201 });
}
