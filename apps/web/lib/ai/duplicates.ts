import { db } from "@/lib/db";

// Résout quels ids (parmi une liste déjà scopée au profil courant) ont au
// moins un DuplicateCandidate PENDING les impliquant — alimente le badge
// "quasi-doublon" (InspirationCard/TriageClient/fiche détail). Pas de
// colonne userId sur DuplicateCandidate : le scoping vient entièrement du
// fait que `ids` est déjà filtré par profil côté appelant.
export async function getDuplicateIdSet(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db.duplicateCandidate.findMany({
    where: {
      status: "PENDING",
      OR: [
        { inspirationAId: { in: ids } },
        { inspirationBId: { in: ids } },
      ],
    },
    select: { inspirationAId: true, inspirationBId: true },
  });
  const idSet = new Set(ids);
  const result = new Set<string>();
  for (const r of rows) {
    if (idSet.has(r.inspirationAId)) result.add(r.inspirationAId);
    if (idSet.has(r.inspirationBId)) result.add(r.inspirationBId);
  }
  return result;
}
