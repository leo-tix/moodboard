import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";

const LIMIT = 12;
// Seuil LARGE "images proches" — lecture seule, découverte stylistique.
// Distinct du seuil STRICT de doublon (DUPLICATE_THRESHOLD=0.97 côté worker,
// voir apps/ai-worker/worker.py) : ici on veut de la proximité, pas de la
// quasi-identité. Pas persisté — calculé à la lecture à chaque appel.
const SIMILARITY_THRESHOLD = 0.75;

// GET /api/inspirations/[id]/similar — panneau "images proches" (fiche
// détail), lecture seule, jamais appliqué. Utilise le même embedding que la
// détection stricte de doublons (DuplicateCandidate), un seuil juste plus
// permissif.
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

  const rows = await db.$queryRaw<
    { id: string; title: string; thumbnailKey: string | null; width: number | null; height: number | null; similarity: number }[]
  >(
    Prisma.sql`
      SELECT
        i.id,
        i.title,
        img."thumbnailKey",
        img.width,
        img.height,
        1 - (i.embedding <=> self.embedding) AS similarity
      FROM inspirations i
      JOIN inspirations self ON self.id = ${id}
      LEFT JOIN LATERAL (
        SELECT "thumbnailKey", width, height
        FROM images
        WHERE "inspirationId" = i.id
        ORDER BY "isMain" DESC, "order" ASC
        LIMIT 1
      ) img ON true
      WHERE i."userId" = ${userId}
        AND i.id != ${id}
        AND i.embedding IS NOT NULL
        AND self.embedding IS NOT NULL
        AND i."isArchived" = false
        AND 1 - (i.embedding <=> self.embedding) >= ${SIMILARITY_THRESHOLD}
      ORDER BY i.embedding <=> self.embedding
      LIMIT ${LIMIT}
    `
  );

  return NextResponse.json({ items: rows });
}
