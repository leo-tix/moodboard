import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { saveImageToLibrary } from "@/lib/images/saveToLibrary";

type Params = { params: Promise<{ imageId: string }> };

// POST /api/images/[imageId]/save — enregistre dans MA galerie une image reçue en
// message (copie R2 indépendante → chacun a la sienne, pas de comptage partagé).
export async function POST(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const me = session.user.id;
  const { imageId } = await params;

  // L'image doit m'avoir été partagée dans une de mes conversations.
  const shared = await db.message.findFirst({
    where: { sharedImageId: imageId, conversation: { OR: [{ userAId: me }, { userBId: me }] } },
    select: { id: true },
  });
  if (!shared) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const res = await saveImageToLibrary(imageId, me);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  return NextResponse.json({ ok: true, inspirationId: res.inspirationId });
}
