import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { z } from "zod";

interface Params { params: Promise<{ id: string; columnsId: string }> }

const slotSchema = z.object({
  slot: z.enum(["left", "right"]),
  type: z.enum(["IMAGE", "TEXT", "TITLE", "QUOTE", "AUDIO"]).nullable(),
  id: z.string().nullable(),
}).refine((v) => (v.type === null) === (v.id === null), {
  message: "type et id doivent être fournis ensemble (ou tous deux null)",
});

// Vérifie que le bloc référencé appartient bien à cette visite avant de le
// laisser être réclamé par une colonne.
async function blockBelongsToVisit(visitId: string, type: "IMAGE" | "TEXT" | "TITLE" | "QUOTE" | "AUDIO", blockId: string) {
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

// PATCH /api/visits/[id]/columns/[columnsId] — assigne ou vide un slot
// (gauche/droite). Vider un slot "déréclame" le bloc : il redevient un bloc
// autonome de la séquence plate, il n'est jamais supprimé par cette route.
export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id, columnsId } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = slotSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const owned = await db.visit.findFirst({ where: { id, userId: session.user.id }, select: { id: true } });
  if (!owned) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const columns = await db.visitColumns.findUnique({ where: { id: columnsId } });
  if (!columns || columns.visitId !== id) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const { slot, type, id: blockId } = parsed.data;

  if (type && blockId) {
    if (!(await blockBelongsToVisit(id, type, blockId))) {
      return NextResponse.json({ error: "Bloc introuvable dans cette visite" }, { status: 400 });
    }
    // Un même bloc ne peut pas occuper les deux slots d'une même colonne.
    const otherType = slot === "left" ? columns.rightType : columns.leftType;
    const otherId = slot === "left" ? columns.rightId : columns.leftId;
    if (otherType === type && otherId === blockId) {
      return NextResponse.json({ error: "Ce bloc occupe déjà l'autre colonne" }, { status: 400 });
    }
  }

  const updated = await db.visitColumns.update({
    where: { id: columnsId },
    data:
      slot === "left"
        ? { leftType: type, leftId: blockId }
        : { rightType: type, rightId: blockId },
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
