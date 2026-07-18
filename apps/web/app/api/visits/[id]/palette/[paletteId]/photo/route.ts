import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { deleteFromR2 } from "@/lib/storage/r2";
import { uploadTileThumbnailOnly } from "@/lib/visits/tilePhoto";

interface Params { params: Promise<{ id: string; paletteId: string }> }

// POST /api/visits/[id]/palette/[paletteId]/photo — stocke une vignette de
// l'image source (illustration). Les couleurs, elles, sont extraites côté
// client. Multipart { file }.
export async function POST(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const userId = session.user.id;

  const { id, paletteId } = await params;
  const owned = await db.visit.findFirst({ where: { id, userId }, select: { id: true } });
  if (!owned) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const existing = await db.visitPalette.findUnique({ where: { id: paletteId } });
  if (!existing || existing.visitId !== id) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "Fichier manquant" }, { status: 400 });

  const result = await uploadTileThumbnailOnly(userId, file);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  const oldKey = existing.sourceKey;
  const updated = await db.visitPalette.update({ where: { id: paletteId }, data: { sourceKey: result.sourceKey } });
  if (oldKey) await deleteFromR2(oldKey).catch(() => {});

  return NextResponse.json(updated);
}
