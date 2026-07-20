import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { uploadToR2, deleteFromR2 } from "@/lib/storage/r2";
import { generateBoardPreview } from "@/lib/moodboard/generatePreview";
import type { CanvasElement } from "@/lib/moodboard/types";

// Régénère la vignette R2 d'une planche depuis son contenu courant et met à jour
// previewKey (supprime l'ancienne). Best-effort : renvoie la clé ou null.
export async function regenerateMoodboardPreview(id: string): Promise<string | null> {
  const board = await db.moodboard.findUnique({ where: { id }, select: { canvasData: true, background: true, previewKey: true, updatedAt: true } });
  if (!board) return null;

  const buf = await generateBoardPreview(board.canvasData as CanvasElement[], board.background);
  const old = board.previewKey;
  // Régénérer la vignette n'est PAS une modif de contenu → on préserve updatedAt
  // (sinon la date « modifié le » saute à chaque régénération / backfill).
  const keepDate = { updatedAt: board.updatedAt };

  if (!buf) {
    if (old) {
      await deleteFromR2(old).catch(() => {});
      await db.moodboard.update({ where: { id }, data: { previewKey: null, ...keepDate } });
    }
    return null;
  }

  const key = `previews/${id}-${randomUUID().slice(0, 8)}.webp`;
  await uploadToR2(key, buf, "image/webp");
  await db.moodboard.update({ where: { id }, data: { previewKey: key, ...keepDate } });
  if (old && old !== key) await deleteFromR2(old).catch(() => {});
  return key;
}
