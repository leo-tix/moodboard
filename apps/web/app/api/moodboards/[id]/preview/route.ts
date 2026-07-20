import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { canEditResource } from "@/lib/access/resolve";
import { regenerateMoodboardPreview } from "@/lib/moodboard/savePreview";

type Params = { params: Promise<{ id: string }> };

// POST /api/moodboards/[id]/preview — régénère la vignette R2 de la planche.
// Appelé par l'éditeur (débouncé) ; propriétaire ou éditeur uniquement.
export async function POST(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const { id } = await params;
  if (!(await canEditResource("MOODBOARD", id, session.user.id))) {
    return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  }
  const key = await regenerateMoodboardPreview(id);
  return NextResponse.json({ ok: true, previewKey: key });
}
