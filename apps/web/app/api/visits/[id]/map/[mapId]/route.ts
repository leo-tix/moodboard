import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { z } from "zod";

interface Params { params: Promise<{ id: string; mapId: string }> }

// PATCH /api/visits/[id]/map/[mapId] — modifie le lieu (recherche Photon).
export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id, mapId } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = z
    .object({ locationName: z.string().min(1).max(200), latitude: z.number(), longitude: z.number() })
    .safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const owned = await db.visit.findFirst({ where: { id, userId: session.user.id }, select: { id: true } });
  if (!owned) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const map = await db.visitMapBlock.findUnique({ where: { id: mapId } });
  if (!map || map.visitId !== id) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const updated = await db.visitMapBlock.update({ where: { id: mapId }, data: parsed.data });
  return NextResponse.json(updated);
}

// DELETE /api/visits/[id]/map/[mapId]
export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id, mapId } = await params;
  const owned = await db.visit.findFirst({ where: { id, userId: session.user.id }, select: { id: true } });
  if (!owned) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const map = await db.visitMapBlock.findUnique({ where: { id: mapId } });
  if (!map || map.visitId !== id) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  await db.visitMapBlock.delete({ where: { id: mapId } });
  return NextResponse.json({ ok: true });
}
