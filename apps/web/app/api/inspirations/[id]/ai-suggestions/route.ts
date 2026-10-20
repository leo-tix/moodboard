import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";

// GET /api/inspirations/[id]/ai-suggestions — route légère dédiée à
// AiSuggestPanel (polling tant que l'analyse n'est pas DONE). Séparée de
// GET /api/inspirations/[id] pour ne pas resélectionner tags/catégories/
// images à chaque poll alors que seuls ces 3 champs nous intéressent ici.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const { id } = await params;

  const inspiration = await db.inspiration.findFirst({
    where: { id, userId: session.user.id },
    select: { aiStatus: true, aiSuggestedTags: true, aiSuggestedCategories: true },
  });
  if (!inspiration) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  return NextResponse.json(inspiration);
}
