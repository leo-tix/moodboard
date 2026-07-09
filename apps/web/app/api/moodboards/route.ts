import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthUserId } from "@/lib/auth/withToken";

// GET /api/moodboards
export async function GET(req: NextRequest) {
  const userId = await getAuthUserId(req);
  if (!userId) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const moodboards = await db.moodboard.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      title: true,
      background: true,
      canvasData: true,
      shareToken: true,
      shareExpiry: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return NextResponse.json(moodboards);
}

// POST /api/moodboards
export async function POST(req: NextRequest) {
  const userId = await getAuthUserId(req);
  if (!userId) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const moodboard = await db.moodboard.create({
    data: { userId, title: "Sans titre", canvasData: [], background: "#0a0a0a" },
  });

  return NextResponse.json(moodboard, { status: 201 });
}
