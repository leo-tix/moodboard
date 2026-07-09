import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { randomUUID } from "crypto";

interface Params { params: Promise<{ id: string }> }

// POST /api/moodboards/[id]/share
// body: { expiry: "7d" | "30d" | "never" | null }  — null = révoquer
export async function POST(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id } = await params;
  const { expiry } = await req.json() as { expiry: "7d" | "30d" | "never" | null };

  const owned = await db.moodboard.findFirst({
    where: { id, userId: session.user.id },
    select: { id: true },
  });
  if (!owned) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  let shareToken: string | null = null;
  let shareExpiry: Date | null = null;

  if (expiry !== null) {
    shareToken = randomUUID();
    if (expiry === "7d") {
      shareExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    } else if (expiry === "30d") {
      shareExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    }
    // "never" → shareExpiry reste null
  }

  const moodboard = await db.moodboard.update({
    where: { id },
    data: { shareToken, shareExpiry },
    select: { shareToken: true, shareExpiry: true },
  });

  return NextResponse.json(moodboard);
}
