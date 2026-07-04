import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";

// PATCH /api/triage/[id] — accepter, archiver, ou annuler (rewind) une décision
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id } = await params;
  const { action } = (await req.json()) as { action: "accept" | "archive" | "undo" };

  if (action !== "accept" && action !== "archive" && action !== "undo") {
    return NextResponse.json({ error: "action invalide" }, { status: 400 });
  }

  // "undo" remet l'image en attente de triage (isAccepted/isArchived à false)
  await db.inspiration.update({
    where: { id },
    data: {
      isAccepted: action === "accept",
      isArchived: action === "archive",
    },
  });

  return NextResponse.json({ ok: true });
}
