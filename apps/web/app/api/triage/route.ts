import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";

// GET /api/triage — images en attente de triage (pas encore acceptées ni archivées)
export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const items = await db.inspiration.findMany({
    where: {
      status:     "READY",
      isAccepted: false,
      isArchived: false,
    },
    select: {
      id:          true,
      title:       true,
      author:      true,
      studio:      true,
      year:        true,
      country:     true,
      notes:       true,
      sourceUrl:   true,
      source:      true,
      description: true,
      createdAt:   true,
      categories: {
        include: {
          category:    { select: { id: true, name: true, icon: true } },
          subcategory: { select: { id: true, name: true } },
        },
      },
      tags: { include: { tag: { select: { name: true } } } },
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
