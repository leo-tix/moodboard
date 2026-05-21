import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";

// GET /api/moodboards
export async function GET(_req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const moodboards = await db.moodboard.findMany({
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
export async function POST(_req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const moodboard = await db.moodboard.create({
    data: { title: "Sans titre", canvasData: [], background: "#0a0a0a" },
  });

  return NextResponse.json(moodboard, { status: 201 });
}
