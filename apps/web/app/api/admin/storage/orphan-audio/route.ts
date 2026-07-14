import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/current";
import { findOrphanedAudioObjects, deleteOrphanedAudioObjects } from "@/lib/storage/orphanAudio";

// GET /api/admin/storage/orphan-audio — liste les objets R2 audio
// (visit-audio/*) qui n'ont plus aucune ligne VisitAudio pour les référencer
// (admin only — porte sur le bucket entier, tous profils confondus, l'objet
// R2 ne portant pas d'identifiant de profil).
export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Réservé à l'administrateur" }, { status: 403 });

  const orphans = await findOrphanedAudioObjects();
  const totalBytes = orphans.reduce((s, o) => s + o.size, 0);
  return NextResponse.json({ count: orphans.length, totalBytes, items: orphans });
}

// DELETE /api/admin/storage/orphan-audio — supprime tous les objets R2
// orphelins actuellement détectés (recalculés côté serveur, pas de payload
// client — évite de supprimer une clé qui serait redevenue valide entre
// l'affichage et le clic).
export async function DELETE() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Réservé à l'administrateur" }, { status: 403 });

  const orphans = await findOrphanedAudioObjects();
  if (orphans.length === 0) return NextResponse.json({ deleted: 0, failed: [], freedBytes: 0 });

  const freedBytes = orphans.reduce((s, o) => s + o.size, 0);
  const { deleted, failed } = await deleteOrphanedAudioObjects(orphans.map((o) => o.key));
  return NextResponse.json({ deleted, failed, freedBytes });
}
