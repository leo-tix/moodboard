import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";

// GET /api/members?q= — recherche de membres de l'instance (hors soi), annotés du
// statut relationnel (connected/incoming/outgoing/none) pour piloter les boutons.
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const me = session.user.id;

  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  const where = q
    ? {
        NOT: { id: me },
        OR: [
          { name: { contains: q, mode: "insensitive" as const } },
          { username: { contains: q.toLowerCase(), mode: "insensitive" as const } },
        ],
      }
    : { NOT: { id: me } };

  const [members, myConns] = await Promise.all([
    db.user.findMany({
      where,
      select: { id: true, name: true, username: true, image: true },
      take: 20,
      orderBy: { name: "asc" },
    }),
    db.connection.findMany({
      where: { OR: [{ requesterId: me }, { addresseeId: me }] },
      select: { status: true, requesterId: true, addresseeId: true },
    }),
  ]);

  const rel = new Map<string, "connected" | "incoming" | "outgoing">();
  for (const c of myConns) {
    const other = c.requesterId === me ? c.addresseeId : c.requesterId;
    rel.set(other, c.status === "ACCEPTED" ? "connected" : c.requesterId === me ? "outgoing" : "incoming");
  }

  return NextResponse.json({
    members: members.map((m) => ({ ...m, relation: rel.get(m.id) ?? "none" })),
  });
}
