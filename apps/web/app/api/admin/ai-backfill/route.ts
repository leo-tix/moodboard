import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/current";
import { db } from "@/lib/db";

// GET /api/admin/ai-backfill — comptage par statut, pour un indicateur de
// progression simple (admin only — porte sur toute la base, tous profils).
export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Réservé à l'administrateur" }, { status: 403 });

  const rows = await db.inspiration.groupBy({
    by: ["aiStatus"],
    _count: { _all: true },
  });
  const counts = Object.fromEntries(rows.map((r) => [r.aiStatus, r._count._all]));
  return NextResponse.json({ counts });
}

// POST /api/admin/ai-backfill — remet en file (aiStatus='PENDING') toute
// inspiration pas encore pleinement traitée. Condition sur
// aiSuggestedTags (pas sur embedding) : le worker peut avoir déjà posé un
// embedding lors d'un test antérieur sans encore poser de tags/catégories
// (voir plan Phase 2/3) — on veut reprendre CES lignes-là aussi, pas
// seulement celles jamais touchées. Idempotent : relancer ne fait jamais de
// mal, le worker traite la même file pour le neuf et le rattrapage.
export async function POST() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Réservé à l'administrateur" }, { status: 403 });

  const result = await db.$executeRawUnsafe(`
    UPDATE inspirations
    SET "aiStatus" = 'PENDING', "updatedAt" = now()
    WHERE "aiStatus" = 'ERROR' OR "aiSuggestedTags" IS NULL
  `);

  return NextResponse.json({ queued: result });
}
