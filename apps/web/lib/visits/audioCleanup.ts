import { db } from "@/lib/db";
import { deleteFromR2 } from "@/lib/storage/r2";

// Les notes stockent le HTML Tiptap tel quel — un bloc audio y apparaît comme
// `<div data-type="audio-block" audioid="...">` (le DOM lowercase les noms
// d'attributs custom au sérialisation, d'où `audioid` et non `audioId`).
// Extraire les ids par regex évite de reparser tout Tiptap côté serveur.
function extractAudioIds(html: string): string[] {
  return [...html.matchAll(/audioid="([^"]+)"/gi)].map((m) => m[1]);
}

// Supprime en base + sur R2 les VisitAudio dont l'id disparaît entre l'ancien
// et le nouveau contenu d'une note (édité pour retirer le bloc audio).
export async function cleanupRemovedAudio(oldHtml: string, newHtml: string) {
  const before = extractAudioIds(oldHtml);
  const after = new Set(extractAudioIds(newHtml));
  // Set.prototype.difference nécessite Node 22+ (V8 12.4) — ce projet tourne
  // sur Node 20, filter() reste compatible partout.
  const removed = before.filter((id) => !after.has(id));
  if (removed.length > 0) await deleteAudioByIds(removed);
}

export async function deleteAudioByIds(ids: string[]) {
  if (ids.length === 0) return;
  const rows = await db.visitAudio.findMany({
    where: { id: { in: ids } },
    select: { id: true, storageKey: true },
  });
  await Promise.all(rows.map((r) => deleteFromR2(r.storageKey).catch(() => {})));
  await db.visitAudio.deleteMany({ where: { id: { in: ids } } });
}

// Purge R2 pour TOUS les clips audio d'une visite (avant le delete cascade
// DB — le cascade nettoie les lignes, pas les objets R2).
export async function deleteAllAudioForVisit(visitId: string) {
  const rows = await db.visitAudio.findMany({ where: { visitId }, select: { storageKey: true } });
  await Promise.all(rows.map((r) => deleteFromR2(r.storageKey).catch(() => {})));
}
