import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";

// GET /api/inspirations/[id]/duplicates — paires de quasi-doublons
// (DuplicateCandidate, statut PENDING) impliquant cette inspiration, avec
// assez de métadonnées côté client pour afficher la comparaison côte à
// côte (CompareDuplicateModal, page Archives).
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const userId = session.user.id;
  const { id } = await params;

  const owned = await db.inspiration.findFirst({ where: { id, userId }, select: { id: true } });
  if (!owned) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const candidates = await db.duplicateCandidate.findMany({
    where: {
      status: "PENDING",
      OR: [{ inspirationAId: id }, { inspirationBId: id }],
    },
    orderBy: { similarity: "desc" },
  });

  const otherIds = candidates.map((c) => (c.inspirationAId === id ? c.inspirationBId : c.inspirationAId));
  const others = await db.inspiration.findMany({
    where: { id: { in: otherIds }, userId },
    select: {
      id: true,
      title: true,
      createdAt: true,
      isArchived: true,
      images: { where: { isMain: true }, select: { storageKey: true, thumbnailKey: true }, take: 1 },
    },
  });
  const byId = new Map(others.map((o) => [o.id, o]));

  const pairs = candidates
    .map((c) => {
      const otherId = c.inspirationAId === id ? c.inspirationBId : c.inspirationAId;
      const other = byId.get(otherId);
      if (!other) return null;
      return { candidateId: c.id, similarity: c.similarity, other };
    })
    .filter((p) => p !== null);

  return NextResponse.json({ pairs });
}
