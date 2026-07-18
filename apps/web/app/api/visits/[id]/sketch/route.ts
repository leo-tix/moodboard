import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { deleteFromR2 } from "@/lib/storage/r2";
import { uploadTilePhoto } from "@/lib/visits/tilePhoto";

interface Params { params: Promise<{ id: string }> }

// POST /api/visits/[id]/sketch — crée un croquis depuis un PNG dessiné côté
// client (multipart { file }). L'image est traitée + stockée comme les autres
// (sharp → webp + vignette, quota).
export async function POST(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const userId = session.user.id;

  const { id } = await params;
  const visit = await db.visit.findFirst({ where: { id, userId }, select: { id: true } });
  if (!visit) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "Fichier manquant" }, { status: 400 });

  const result = await uploadTilePhoto(userId, file);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  const sketch = await db.visitSketch.create({
    data: {
      visitId: id,
      storageKey: result.photo.storageKey,
      thumbnailKey: result.photo.thumbnailKey,
      width: result.photo.width,
      height: result.photo.height,
    },
  });

  // Si la création DB échoue, l'objet R2 serait orphelin — mais create() ci-dessus
  // est la dernière étape ; en cas d'échec on purge.
  if (!sketch) {
    await deleteFromR2(result.photo.storageKey).catch(() => {});
    await deleteFromR2(result.photo.thumbnailKey).catch(() => {});
    return NextResponse.json({ error: "Erreur" }, { status: 500 });
  }
  return NextResponse.json(sketch, { status: 201 });
}
