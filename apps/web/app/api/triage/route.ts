import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";

// GET /api/triage — images en attente de triage (pas encore acceptées ni archivées)
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const items = await db.inspiration.findMany({
    where: {
      userId:     session.user.id,
      status:     "READY",
      isAccepted: false,
      isArchived: false,
    },
    // Sélection minimale : le client (TriageClient/itemToLocal) n'utilise que
    // les FK de catégorie, les noms de tags et l'image principale. Inutile de
    // joindre les objets category/subcategory complets pour chaque item (ni de
    // ramener country/source/description/sourceUrl non affichés) — allège la
    // requête ET le payload, surtout avec une grosse file d'attente.
    select: {
      id:     true,
      title:  true,
      author: true,
      year:   true,
      categories: { select: { categoryId: true, subcategoryId: true } },
      tags: { select: { tag: { select: { name: true } } } },
      images: {
        where:   { isMain: true },
        select:  { storageKey: true, thumbnailKey: true, width: true, height: true },
        take: 1,
      },
    },
    orderBy: { createdAt: "asc" }, // plus vieilles en premier
  });

  return NextResponse.json({ items });
}
