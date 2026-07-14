import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";

// GET /api/tags/popular — tags les plus utilisés du profil, avec compte
// d'inspirations. Même requête que celle en dur dans /search (page.tsx),
// extraite ici pour être appelable depuis un composant client (le picker
// bibliothèque du canvas moodboard).
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const tags = await db.tag.findMany({
    where: { userId: session.user.id },
    include: { _count: { select: { inspirations: true } } },
    orderBy: { inspirations: { _count: "desc" } },
    take: 20,
  });

  return NextResponse.json(
    tags
      .filter((t) => t._count.inspirations > 0)
      .map((t) => ({ name: t.name, slug: t.slug, count: t._count.inspirations }))
  );
}
