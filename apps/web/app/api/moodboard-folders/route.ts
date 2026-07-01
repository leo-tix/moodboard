import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";

// GET /api/moodboard-folders
export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const folders = await db.moodboardFolder.findMany({
    orderBy: { order: "asc" },
  });
  return NextResponse.json(folders);
}

// POST /api/moodboard-folders
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const name = (body.name as string | undefined)?.trim() || "Sans titre";

  const maxOrder = await db.moodboardFolder.aggregate({ _max: { order: true } });
  const folder = await db.moodboardFolder.create({
    data: { name, order: (maxOrder._max.order ?? -1) + 1 },
  });

  return NextResponse.json(folder, { status: 201 });
}
