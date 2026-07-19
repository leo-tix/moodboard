import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { connectionActionSchema } from "@/lib/validators/social";

type Params = { params: Promise<{ id: string }> };

// PATCH /api/connections/[id] — accepter/refuser une demande REÇUE (addressee only).
export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const me = session.user.id;
  const { id } = await params;

  const body = await req.json().catch(() => ({}));
  const parsed = connectionActionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Données invalides" }, { status: 400 });
  }

  const conn = await db.connection.findFirst({
    where: { id, addresseeId: me, status: "PENDING" },
    select: { id: true },
  });
  if (!conn) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  if (parsed.data.action === "accept") {
    await db.connection.update({ where: { id }, data: { status: "ACCEPTED", respondedAt: new Date() } });
    return NextResponse.json({ status: "connected" });
  }
  await db.connection.delete({ where: { id } });
  return NextResponse.json({ status: "declined" });
}

// DELETE /api/connections/[id] — retirer une connexion ou annuler une demande sortante
// (autorisé si l'utilisateur est partie prenante).
export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const me = session.user.id;
  const { id } = await params;

  const res = await db.connection.deleteMany({
    where: { id, OR: [{ requesterId: me }, { addresseeId: me }] },
  });
  if (res.count === 0) return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
