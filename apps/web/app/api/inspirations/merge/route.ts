import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { deleteFromR2 } from "@/lib/storage/r2";
import type { CanvasElement, ImageElement } from "@/lib/moodboard/types";
import type { JournalTile } from "@/lib/visits/bentoSpans";

// POST /api/inspirations/merge — fusionne un doublon détecté par l'IA
// (point d'entrée : Archives, "comparer & supprimer"). `deleteId` doit être
// archivé (isArchived=true) : c'est la décision produit — jamais de
// suppression depuis la bibliothèque normale par ce chemin.
//
// Ordre obligatoire (voir plan) : fusionner tags/catégories/collections +
// repointer les références JSON (moodboards, carnets de visite) AVANT de
// supprimer `deleteId` — une fois la ligne supprimée, ses relations ne sont
// plus lisibles pour la fusion. Tout dans UNE transaction Prisma ; le
// nettoyage R2 (non transactionnel) a lieu après le commit, même pattern
// que DELETE /api/inspirations/[id].
//
// NOTE : VisitColumns.left/right (même forme {type,id} que journalLayout,
// cf. commentaire schema.prisma) n'est pas repointé ici — son chemin de
// lecture/écriture réel n'a pas été confirmé câblé dans l'UI au moment de
// l'implémentation (à vérifier via BentoGrid.tsx/TileContent.tsx avant de
// considérer la fusion complète si cette fonctionnalité s'avère utilisée).
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const userId = session.user.id;

  const body = await req.json();
  const keepId: unknown = body?.keepId;
  const deleteId: unknown = body?.deleteId;
  if (typeof keepId !== "string" || typeof deleteId !== "string" || keepId === deleteId) {
    return NextResponse.json({ error: "keepId/deleteId invalides" }, { status: 400 });
  }

  const [keep, toDelete] = await Promise.all([
    db.inspiration.findFirst({
      where: { id: keepId, userId },
      include: { images: { orderBy: [{ isMain: "desc" }, { order: "asc" }] } },
    }),
    db.inspiration.findFirst({
      where: { id: deleteId, userId },
      include: {
        tags: { select: { tagId: true } },
        categories: { select: { categoryId: true, subcategoryId: true } },
        collections: { select: { collectionId: true, order: true, addedById: true } },
        images: { select: { storageKey: true, thumbnailKey: true } },
      },
    }),
  ]);

  if (!keep) return NextResponse.json({ error: "Image à garder introuvable" }, { status: 404 });
  if (!toDelete) return NextResponse.json({ error: "Image à supprimer introuvable" }, { status: 404 });
  if (!toDelete.isArchived) {
    return NextResponse.json({ error: "L'image à supprimer doit être archivée au préalable" }, { status: 400 });
  }

  const keptMainImage = keep.images[0] ?? null;

  await db.$transaction(async (tx) => {
    // 1. Tags du supprimé absents du gardé
    const existingTagIds = new Set((await tx.inspirationTag.findMany({
      where: { inspirationId: keepId },
      select: { tagId: true },
    })).map((t) => t.tagId));
    const tagsToAdd = toDelete.tags.filter((t) => !existingTagIds.has(t.tagId));
    if (tagsToAdd.length > 0) {
      await tx.inspirationTag.createMany({
        data: tagsToAdd.map((t) => ({ inspirationId: keepId, tagId: t.tagId })),
        skipDuplicates: true,
      });
    }

    // 2. Catégories du supprimé absentes du gardé (par categoryId)
    const existingCategoryIds = new Set((await tx.inspirationCategory.findMany({
      where: { inspirationId: keepId },
      select: { categoryId: true },
    })).map((c) => c.categoryId));
    const categoriesToAdd = toDelete.categories.filter((c) => !existingCategoryIds.has(c.categoryId));
    if (categoriesToAdd.length > 0) {
      await tx.inspirationCategory.createMany({
        data: categoriesToAdd.map((c) => ({
          inspirationId: keepId,
          categoryId: c.categoryId,
          subcategoryId: c.subcategoryId,
        })),
        skipDuplicates: true,
      });
    }

    // 3. Collections : ajoute le gardé partout où le supprimé était, sauf s'il y est déjà
    const existingCollectionIds = new Set((await tx.collectionItem.findMany({
      where: { inspirationId: keepId },
      select: { collectionId: true },
    })).map((c) => c.collectionId));
    const collectionsToAdd = toDelete.collections.filter((c) => !existingCollectionIds.has(c.collectionId));
    if (collectionsToAdd.length > 0) {
      await tx.collectionItem.createMany({
        data: collectionsToAdd.map((c) => ({
          inspirationId: keepId,
          collectionId: c.collectionId,
          order: c.order,
          addedById: c.addedById,
        })),
        skipDuplicates: true,
      });
    }

    // 4. Repointer Moodboard.canvasData (éléments image référençant deleteId)
    const boards = await tx.moodboard.findMany({
      where: { userId },
      select: { id: true, canvasData: true },
    });
    for (const board of boards) {
      const elements = board.canvasData as unknown as CanvasElement[];
      if (!Array.isArray(elements)) continue;
      let changed = false;
      const next = elements.map((el) => {
        if (el.type === "image" && (el as ImageElement).inspirationId === deleteId) {
          changed = true;
          const img = el as ImageElement;
          return {
            ...img,
            inspirationId: keepId,
            storageKey: keptMainImage?.storageKey ?? img.storageKey,
            thumbnailKey: keptMainImage?.thumbnailKey ?? img.thumbnailKey,
            isAnimated: keptMainImage?.isAnimated ?? img.isAnimated,
          };
        }
        return el;
      });
      if (changed) {
        await tx.moodboard.update({ where: { id: board.id }, data: { canvasData: next as object } });
      }
    }

    // 5. Repointer Visit.journalLayout (tuiles image référençant deleteId)
    const visits = await tx.visit.findMany({
      where: { userId },
      select: { id: true, journalLayout: true },
    });
    for (const visit of visits) {
      const tiles = visit.journalLayout as unknown as JournalTile[];
      if (!Array.isArray(tiles)) continue;
      let changed = false;
      const next = tiles.map((tile) => {
        if (tile.type === "image" && tile.id === deleteId) {
          changed = true;
          return { ...tile, id: keepId };
        }
        return tile;
      });
      if (changed) {
        await tx.visit.update({ where: { id: visit.id }, data: { journalLayout: next as object } });
      }
      // VisitColumns.left/right non traité ici — voir commentaire en tête de fichier.
    }
    // Rattache aussi la relation directe Visit<->Inspiration (visitId sur
    // Inspiration) si le supprimé appartenait à une visite et que le gardé
    // n'y est pas déjà.
    if (toDelete.visitId && keep.visitId !== toDelete.visitId) {
      await tx.inspiration.update({ where: { id: keepId }, data: { visitId: toDelete.visitId } });
    }

    // 6. Doublon de la paire — nettoyage défensif (le cascade s'en chargerait sinon)
    await tx.duplicateCandidate.deleteMany({
      where: {
        OR: [
          { inspirationAId: deleteId },
          { inspirationBId: deleteId },
        ],
      },
    });

    // 7. Suppression définitive — même logique que DELETE /api/inspirations/[id]
    await tx.inspiration.delete({ where: { id: deleteId } });
  });

  const keysToDelete = toDelete.images.flatMap((img) =>
    [img.storageKey, img.thumbnailKey].filter(Boolean) as string[]
  );
  if (keysToDelete.length > 0) {
    await Promise.allSettled(keysToDelete.map((key) => deleteFromR2(key)));
  }

  return NextResponse.json({ success: true, keptId: keepId });
}
