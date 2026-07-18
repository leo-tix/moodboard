import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { deleteFromR2 } from "@/lib/storage/r2";
import { uploadTilePhoto } from "@/lib/visits/tilePhoto";

interface Params { params: Promise<{ id: string; cartelId: string }> }

// POST /api/visits/[id]/cartel/[cartelId]/photo — attache (ou remplace) la
// photo du cartel. Multipart { file }.
export async function POST(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const userId = session.user.id;

  const { id, cartelId } = await params;
  const owned = await db.visit.findFirst({ where: { id, userId }, select: { id: true } });
  if (!owned) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const existing = await db.visitCartel.findUnique({ where: { id: cartelId } });
  if (!existing || existing.visitId !== id) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "Fichier manquant" }, { status: 400 });

  const result = await uploadTilePhoto(userId, file);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  // Remplacement : purge l'ancienne photo après avoir posé la nouvelle.
  const oldKeys = [existing.storageKey, existing.thumbnailKey].filter(Boolean) as string[];

  const updated = await db.visitCartel.update({
    where: { id: cartelId },
    data: {
      storageKey: result.photo.storageKey,
      thumbnailKey: result.photo.thumbnailKey,
      width: result.photo.width,
      height: result.photo.height,
    },
  });
  for (const k of oldKeys) await deleteFromR2(k).catch(() => {});

  return NextResponse.json(updated);
}
