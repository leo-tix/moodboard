import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";

export interface BlockRef {
  type: "IMAGE" | "TEXT" | "TITLE" | "QUOTE" | "AUDIO";
  id: string;
}

// Retire un ou plusieurs blocs supprimés/détachés de TOUTES les colonnes de
// la visite qui les réclamaient (n'importe où dans une pile gauche/droite, à
// n'importe quelle position) — appelé par les routes DELETE des blocs purs
// (notes, titres, citations, audio) et par le détachement d'image. Un
// tableau JSON ne peut pas être filtré au niveau SQL via Prisma, d'où le
// lire-filtrer-réécrire (peu de lignes par visite).
export async function unclaimBlocksFromAllColumns(visitId: string, type: BlockRef["type"], blockIds: string[]) {
  if (blockIds.length === 0) return;
  const ids = new Set(blockIds);
  const rows = await db.visitColumns.findMany({ where: { visitId } });
  for (const row of rows) {
    const left = (row.left as unknown as BlockRef[]) ?? [];
    const right = (row.right as unknown as BlockRef[]) ?? [];
    const nextLeft = left.filter((b) => !(b.type === type && ids.has(b.id)));
    const nextRight = right.filter((b) => !(b.type === type && ids.has(b.id)));
    if (nextLeft.length !== left.length || nextRight.length !== right.length) {
      await db.visitColumns.update({
        where: { id: row.id },
        data: { left: nextLeft as unknown as Prisma.InputJsonValue, right: nextRight as unknown as Prisma.InputJsonValue },
      });
    }
  }
}

export async function unclaimBlockFromAllColumns(visitId: string, type: BlockRef["type"], blockId: string) {
  await unclaimBlocksFromAllColumns(visitId, type, [blockId]);
}
