import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { canEditResource } from "@/lib/access/resolve";
import { deleteFromR2 } from "@/lib/storage/r2";
import { z } from "zod";

interface Params { params: Promise<{ id: string; cartelId: string }> }

// Plafonds volontairement TRÈS hauts : ce ne sont plus des limites d'usage mais
// de simples garde-fous anti-abus. Les colonnes Postgres sont en `text` (aucun
// @db.VarChar au schéma) donc rien ne bride côté base. Un cartel recopié in
// extenso dépassait les 2000 caractères et était rejeté en 400 — silencieusement,
// car l'UI n'inspectait pas la réponse (retour utilisateur 2026-08-05).
const patchSchema = z.object({
  artworkTitle: z.string().max(2000).optional(),
  artist: z.string().max(1000).nullable().optional(),
  dateText: z.string().max(500).nullable().optional(),
  medium: z.string().max(2000).nullable().optional(),
  dimensions: z.string().max(1000).nullable().optional(),
  room: z.string().max(1000).nullable().optional(),
  notes: z.string().max(50_000).nullable().optional(),
});

// PATCH /api/visits/[id]/cartel/[cartelId] — met à jour les champs texte.
export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id, cartelId } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  if (!(await canEditResource("VISIT", id, session.user.id))) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const existing = await db.visitCartel.findUnique({ where: { id: cartelId } });
  if (!existing || existing.visitId !== id) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const updated = await db.visitCartel.update({ where: { id: cartelId }, data: parsed.data });
  return NextResponse.json(updated);
}

// DELETE /api/visits/[id]/cartel/[cartelId] — supprime + purge la photo R2.
export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id, cartelId } = await params;
  if (!(await canEditResource("VISIT", id, session.user.id))) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const existing = await db.visitCartel.findUnique({ where: { id: cartelId } });
  if (!existing || existing.visitId !== id) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  await db.visitCartel.delete({ where: { id: cartelId } });
  // Purge la photo R2 (best-effort) après suppression DB.
  if (existing.storageKey) await deleteFromR2(existing.storageKey).catch(() => {});
  if (existing.thumbnailKey) await deleteFromR2(existing.thumbnailKey).catch(() => {});
  return NextResponse.json({ ok: true });
}
