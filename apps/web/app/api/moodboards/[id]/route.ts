import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";

interface Params { params: Promise<{ id: string }> }

// GET /api/moodboards/[id]
export async function GET(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id } = await params;
  const moodboard = await db.moodboard.findUnique({ where: { id } });
  if (!moodboard) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  return NextResponse.json(moodboard);
}

// PATCH /api/moodboards/[id]
export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();

  const data: Record<string, unknown> = {};
  if (body.title !== undefined) data.title = body.title;
  if (body.canvasData !== undefined) data.canvasData = body.canvasData;
  if (body.pencilStrokes !== undefined) data.pencilStrokes = body.pencilStrokes;
  if (body.background !== undefined) data.background = body.background;

  const moodboard = await db.moodboard.update({ where: { id }, data });
  return NextResponse.json(moodboard);
}

// DELETE /api/moodboards/[id]
export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id } = await params;
  await db.moodboard.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
