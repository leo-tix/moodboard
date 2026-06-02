import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";

// PATCH /api/triage/[id] — accepter ou archiver une image
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id } = await params;
  const { action } = (await req.json()) as { action: "accept" | "archive" };

  if (action !== "accept" && action !== "archive") {
    return NextResponse.json({ error: "action invalide" }, { status: 400 });
  }

  await db.inspiration.update({
    where: { id },
    data: {
      isAccepted: action === "accept",
      isArchived: action === "archive",
    },
  });

  return NextResponse.json({ ok: true });
}
