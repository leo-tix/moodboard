import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";

// GET /api/triage/count — nombre d'images en attente de triage
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ count: 0 }, { status: 401 });

  const count = await db.inspiration.count({
    where: { userId: session.user.id, status: "READY", isAccepted: false, isArchived: false },
  });

  return NextResponse.json({ count });
}
