import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";

interface Params { params: Promise<{ id: string }> }

// PATCH /api/moodboard-folders/[id]
export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const owned = await db.moodboardFolder.findFirst({
    where: { id, userId: session.user.id },
    select: { id: true },
  });
  if (!owned) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const data: Record<string, unknown> = {};
  if (typeof body.name === "string") data.name = body.name.trim() || "Sans titre";
  if (typeof body.order === "number") data.order = body.order;

  const folder = await db.moodboardFolder.update({ where: { id }, data });
  return NextResponse.json(folder);
}

// DELETE /api/moodboard-folders/[id]
// Boards inside are not deleted — folderId is cleared (onDelete: SetNull).
export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id } = await params;
  const res = await db.moodboardFolder.deleteMany({ where: { id, userId: session.user.id } });
  if (res.count === 0) return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
