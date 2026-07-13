import { db } from "@/lib/db";
import { deleteFromR2 } from "@/lib/storage/r2";

// Purge R2 pour TOUS les clips audio d'une visite (avant le delete cascade
// DB — le cascade nettoie les lignes, pas les objets R2).
export async function deleteAllAudioForVisit(visitId: string) {
  const rows = await db.visitAudio.findMany({ where: { visitId }, select: { storageKey: true } });
  await Promise.all(rows.map((r) => deleteFromR2(r.storageKey).catch(() => {})));
}
