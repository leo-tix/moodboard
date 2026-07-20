import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { canEditResource } from "@/lib/access/resolve";
import { deleteFromR2 } from "@/lib/storage/r2";
import { uploadTilePhoto } from "@/lib/visits/tilePhoto";

interface Params { params: Promise<{ id: string; sketchId: string }> }

// POST /api/visits/[id]/sketch/[sketchId] — remplace le dessin (« Redessiner »).
// Multipart { file }.
export async function POST(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const userId = session.user.id;

  const { id, sketchId } = await params;
  if (!(await canEditResource("VISIT", id, userId))) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const existing = await db.visitSketch.findUnique({ where: { id: sketchId } });
  if (!existing || existing.visitId !== id) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "Fichier manquant" }, { status: 400 });

  const result = await uploadTilePhoto(userId, file);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  const oldKeys = [existing.storageKey, existing.thumbnailKey].filter(Boolean) as string[];
  const updated = await db.visitSketch.update({
    where: { id: sketchId },
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

// DELETE /api/visits/[id]/sketch/[sketchId] — supprime + purge R2.
export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id, sketchId } = await params;
  if (!(await canEditResource("VISIT", id, session.user.id))) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const existing = await db.visitSketch.findUnique({ where: { id: sketchId } });
  if (!existing || existing.visitId !== id) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  await db.visitSketch.delete({ where: { id: sketchId } });
  if (existing.storageKey) await deleteFromR2(existing.storageKey).catch(() => {});
  if (existing.thumbnailKey) await deleteFromR2(existing.thumbnailKey).catch(() => {});
  return NextResponse.json({ ok: true });
}
