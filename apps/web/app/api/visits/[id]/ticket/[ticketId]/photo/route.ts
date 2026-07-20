import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { canEditResource } from "@/lib/access/resolve";
import { deleteFromR2 } from "@/lib/storage/r2";
import { uploadTilePhoto } from "@/lib/visits/tilePhoto";

interface Params { params: Promise<{ id: string; ticketId: string }> }

// POST /api/visits/[id]/ticket/[ticketId]/photo — attache/remplace la photo du
// billet. Multipart { file }.
export async function POST(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const userId = session.user.id;

  const { id, ticketId } = await params;
  if (!(await canEditResource("VISIT", id, userId))) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const existing = await db.visitTicket.findUnique({ where: { id: ticketId } });
  if (!existing || existing.visitId !== id) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "Fichier manquant" }, { status: 400 });

  const result = await uploadTilePhoto(userId, file);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  const oldKeys = [existing.storageKey, existing.thumbnailKey].filter(Boolean) as string[];
  const updated = await db.visitTicket.update({
    where: { id: ticketId },
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
