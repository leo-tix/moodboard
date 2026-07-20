import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { canEditResource } from "@/lib/access/resolve";

interface Params { params: Promise<{ id: string; inspirationId: string }> }

// DELETE /api/visits/[id]/inspirations/[inspirationId] — DÉTACHE une image du
// carnet sans la supprimer : visitId=null, elle réapparaît dans la
// bibliothèque (non destructif, choix produit 2026-07-14). L'inspiration et
// ses objets R2 restent intacts.
export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id, inspirationId } = await params;
  if (!(await canEditResource("VISIT", id, session.user.id))) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const inspiration = await db.inspiration.findFirst({
    where: { id: inspirationId, visitId: id, userId: session.user.id },
    select: { id: true },
  });
  if (!inspiration) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  await db.inspiration.update({ where: { id: inspirationId }, data: { visitId: null, visitOrder: 0 } });

  return NextResponse.json({ ok: true, detached: true });
}
