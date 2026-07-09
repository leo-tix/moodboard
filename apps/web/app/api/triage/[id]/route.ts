import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";

// PATCH /api/triage/[id] — accepter, archiver, ou annuler (rewind) une décision
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id } = await params;
  const { action } = (await req.json()) as { action: "accept" | "archive" | "undo" };

  if (action !== "accept" && action !== "archive" && action !== "undo") {
    return NextResponse.json({ error: "action invalide" }, { status: 400 });
  }

  // "undo" remet l'image en attente de triage (isAccepted/isArchived à false).
  // updateMany scoped par userId = garde d'appartenance (0 ligne si pas le propriétaire).
  const res = await db.inspiration.updateMany({
    where: { id, userId: session.user.id },
    data: {
      isAccepted: action === "accept",
      isArchived: action === "archive",
    },
  });
  if (res.count === 0) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  return NextResponse.json({ ok: true });
}
