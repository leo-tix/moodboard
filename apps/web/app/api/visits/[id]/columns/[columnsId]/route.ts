import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { z } from "zod";

interface Params { params: Promise<{ id: string; columnsId: string }> }

const blockRefSchema = z.object({
  type: z.enum(["IMAGE", "TEXT", "TITLE", "QUOTE", "AUDIO"]),
  id: z.string(),
});
export type BlockRef = z.infer<typeof blockRefSchema>;

// Un côté est une PILE ordonnée de blocs (ex. Titre puis Texte puis Audio
// dans une même colonne) — remplacement complet à chaque PATCH, le client
// envoie l'état final voulu pour le(s) côté(s) modifié(s).
const bodySchema = z.object({
  left: z.array(blockRefSchema).max(20).optional(),
  right: z.array(blockRefSchema).max(20).optional(),
});

// Vérifie que le bloc référencé appartient bien à cette visite avant de le
// laisser être réclamé par une colonne.
async function blockBelongsToVisit(visitId: string, type: BlockRef["type"], blockId: string) {
  switch (type) {
    case "IMAGE":
      return Boolean(await db.inspiration.findFirst({ where: { id: blockId, visitId }, select: { id: true } }));
    case "TEXT":
      return Boolean(await db.visitNote.findFirst({ where: { id: blockId, visitId }, select: { id: true } }));
    case "TITLE":
      return Boolean(await db.visitTitle.findFirst({ where: { id: blockId, visitId }, select: { id: true } }));
    case "QUOTE":
      return Boolean(await db.visitQuote.findFirst({ where: { id: blockId, visitId }, select: { id: true } }));
    case "AUDIO":
      return Boolean(await db.visitAudio.findFirst({ where: { id: blockId, visitId }, select: { id: true } }));
  }
}

// PATCH /api/visits/[id]/columns/[columnsId] — remplace la pile gauche et/ou
// droite. Retirer un bloc d'une pile (en l'omettant du tableau envoyé) le
// "déréclame" : il redevient un bloc autonome de la séquence plate, jamais
// supprimé par cette route.
export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id, columnsId } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  if (parsed.data.left === undefined && parsed.data.right === undefined) {
    return NextResponse.json({ error: "left ou right requis" }, { status: 400 });
  }

  const owned = await db.visit.findFirst({ where: { id, userId: session.user.id }, select: { id: true } });
  if (!owned) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const columns = await db.visitColumns.findUnique({ where: { id: columnsId } });
  if (!columns || columns.visitId !== id) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const { left, right } = parsed.data;
  const combined = [...(left ?? []), ...(right ?? [])];

  // Pas de doublon (même bloc deux fois, même côté ou entre les deux côtés).
  const keys = combined.map((b) => `${b.type}:${b.id}`);
  if (new Set(keys).size !== keys.length) {
    return NextResponse.json({ error: "Un même bloc ne peut pas apparaître deux fois" }, { status: 400 });
  }

  for (const block of combined) {
    if (!(await blockBelongsToVisit(id, block.type, block.id))) {
      return NextResponse.json({ error: `Bloc ${block.type}:${block.id} introuvable dans cette visite` }, { status: 400 });
    }
  }

  const updated = await db.visitColumns.update({
    where: { id: columnsId },
    data: {
      ...(left !== undefined && { left }),
      ...(right !== undefined && { right }),
    },
  });

  return NextResponse.json(updated);
}

// DELETE /api/visits/[id]/columns/[columnsId] — supprime le bloc colonnes.
// Les blocs qu'il réclamait ne sont PAS supprimés : ils redeviennent
// autonomes dans la séquence plate du carnet (déréclamage automatique, la
// colonne qui les référençait n'existe plus).
export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id, columnsId } = await params;
  const owned = await db.visit.findFirst({ where: { id, userId: session.user.id }, select: { id: true } });
  if (!owned) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const columns = await db.visitColumns.findUnique({ where: { id: columnsId } });
  if (!columns || columns.visitId !== id) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  await db.visitColumns.delete({ where: { id: columnsId } });
  return NextResponse.json({ ok: true });
}
