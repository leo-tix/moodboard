import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { connectionRequestSchema } from "@/lib/validators/social";

const userSummary = { id: true, name: true, username: true, image: true } as const;

// GET /api/connections — mes connexions acceptées + demandes entrantes/sortantes.
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const me = session.user.id;

  const rows = await db.connection.findMany({
    where: { OR: [{ requesterId: me }, { addresseeId: me }] },
    select: {
      id: true,
      status: true,
      requesterId: true,
      createdAt: true,
      requester: { select: userSummary },
      addressee: { select: userSummary },
    },
    orderBy: { createdAt: "desc" },
  });

  const connections: unknown[] = [];
  const incoming: unknown[] = [];
  const outgoing: unknown[] = [];
  for (const r of rows) {
    const other = r.requesterId === me ? r.addressee : r.requester;
    const entry = { connectionId: r.id, user: other, since: r.createdAt };
    if (r.status === "ACCEPTED") connections.push(entry);
    else if (r.requesterId === me) outgoing.push(entry);
    else incoming.push(entry);
  }
  return NextResponse.json({ connections, incoming, outgoing });
}

// POST /api/connections — envoyer une demande (par userId ou username).
// Si une demande INVERSE est déjà en attente, on l'accepte (les deux veulent se connecter).
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const me = session.user.id;

  const body = await req.json().catch(() => ({}));
  const parsed = connectionRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Données invalides" }, { status: 400 });
  }
  const { userId, username } = parsed.data;

  const target = await db.user.findFirst({
    where: userId ? { id: userId } : { username: username!.toLowerCase() },
    select: { id: true },
  });
  if (!target) return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  if (target.id === me) return NextResponse.json({ error: "Impossible de se connecter à soi-même" }, { status: 400 });

  const existing = await db.connection.findFirst({
    where: {
      OR: [
        { requesterId: me, addresseeId: target.id },
        { requesterId: target.id, addresseeId: me },
      ],
    },
  });
  if (existing) {
    if (existing.status === "ACCEPTED") return NextResponse.json({ status: "connected", connectionId: existing.id });
    if (existing.requesterId === me) return NextResponse.json({ status: "outgoing", connectionId: existing.id });
    // Demande inverse en attente → acceptation mutuelle.
    const acc = await db.connection.update({
      where: { id: existing.id },
      data: { status: "ACCEPTED", respondedAt: new Date() },
    });
    return NextResponse.json({ status: "connected", connectionId: acc.id });
  }

  const created = await db.connection.create({ data: { requesterId: me, addresseeId: target.id } });
  return NextResponse.json({ status: "outgoing", connectionId: created.id }, { status: 201 });
}
