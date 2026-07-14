import { db } from "@/lib/db";
import { listR2Keys, deleteFromR2 } from "@/lib/storage/r2";

// Filet de sécurité de stockage : `VisitAudio.visitId` est une FK NOT NULL
// avec ON DELETE CASCADE (schema.prisma), donc une ligne VisitAudio ne peut
// PAS exister sans visite valide — le vrai risque d'orphelin est côté R2, pas
// côté base : l'upload (visit-audio/<uuid>.<ext>) est écrit AVANT la création
// de la ligne VisitAudio (voir app/api/visits/[id]/audio/route.ts). Si cette
// création échoue après un upload réussi, l'objet R2 reste sans aucune ligne
// pour le référencer — un vrai "audio qui n'est dans aucune visite". Ce
// module compare les objets R2 réels sous `visit-audio/` aux storageKey
// connus en base et isole ceux qui n'ont plus de ligne correspondante.

const AUDIO_PREFIX = "visit-audio/";

export interface OrphanAudioObject {
  key: string;
  size: number;
}

export async function findOrphanedAudioObjects(): Promise<OrphanAudioObject[]> {
  const [r2Objects, dbKeys] = await Promise.all([
    listR2Keys(AUDIO_PREFIX),
    db.visitAudio.findMany({ select: { storageKey: true } }),
  ]);
  const known = new Set(dbKeys.map((r) => r.storageKey));
  return r2Objects.filter((o) => !known.has(o.key));
}

// Supprime les objets R2 orphelins détectés. Pas de ligne DB à effacer (par
// définition, ils n'en ont pas) — uniquement du nettoyage R2.
export async function deleteOrphanedAudioObjects(keys: string[]): Promise<{ deleted: number; failed: string[] }> {
  const results = await Promise.allSettled(keys.map((k) => deleteFromR2(k)));
  const failed: string[] = [];
  results.forEach((r, i) => {
    if (r.status === "rejected") failed.push(keys[i]);
  });
  return { deleted: keys.length - failed.length, failed };
}
