import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import type { Stroke } from "@/lib/moodboard/types";

interface Params { params: Promise<{ id: string }> }

/**
 * POST /api/moodboards/[id]/strokes
 * Body: { append: Stroke[] }
 *
 * Appends only the new strokes to pencilStrokes — avoids sending the full
 * array on every autosave (delta saves). The client uses this for additive
 * operations (new stroke drawn).
 *
 * Full replace (undo / erase / clear) still goes through PATCH /api/moodboards/[id].
 */
export async function POST(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id } = await params;
  const body = await req.json() as { append?: Stroke[] };
  const append = body.append;

  if (!Array.isArray(append) || append.length === 0) {
    return NextResponse.json({ ok: true });
  }

  const existing = await db.moodboard.findFirst({
    where: { id, userId: session.user.id },
    select: { pencilStrokes: true },
  });

  if (!existing) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const merged = [...(existing.pencilStrokes as unknown as Stroke[]), ...append];

  await db.moodboard.update({
    where: { id },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: { pencilStrokes: merged as any },
  });

  return NextResponse.json({ ok: true });
}
