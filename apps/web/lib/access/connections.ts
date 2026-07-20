import { cache } from "react";
import { db } from "@/lib/db";

// Graphe social : helpers de lecture des connexions (mutuelles, ACCEPTED).
// Utilisés par les routes connexions, les profils, et (Phase 2) la résolution
// de visibilité « Connexions ».

/** Ids des utilisateurs connectés (ACCEPTED) à `userId`, dans les deux sens.
 * Mémoïsé par requête (React cache) : un seul aller-retour DB même si plusieurs
 * appelants le demandent dans le même rendu (feed, résolution d'accès…). */
export const getConnectionIds = cache(async (userId: string): Promise<string[]> => {
  const rows = await db.connection.findMany({
    where: { status: "ACCEPTED", OR: [{ requesterId: userId }, { addresseeId: userId }] },
    select: { requesterId: true, addresseeId: true },
  });
  return rows.map((r) => (r.requesterId === userId ? r.addresseeId : r.requesterId));
});

/** Deux utilisateurs sont-ils connectés (ACCEPTED, peu importe le sens) ? */
export async function areConnected(a: string, b: string): Promise<boolean> {
  if (a === b) return true;
  const row = await db.connection.findFirst({
    where: {
      status: "ACCEPTED",
      OR: [
        { requesterId: a, addresseeId: b },
        { requesterId: b, addresseeId: a },
      ],
    },
    select: { id: true },
  });
  return !!row;
}

export type RelationStatus = "self" | "connected" | "incoming" | "outgoing" | "none";

/**
 * Statut relationnel de `viewer` vis-à-vis de `target` (pour piloter le bouton de
 * connexion sur un profil) + l'id de la ligne Connection concernée s'il existe.
 */
export async function relationStatus(
  viewerId: string,
  targetId: string,
): Promise<{ status: RelationStatus; connectionId?: string }> {
  if (viewerId === targetId) return { status: "self" };
  const row = await db.connection.findFirst({
    where: {
      OR: [
        { requesterId: viewerId, addresseeId: targetId },
        { requesterId: targetId, addresseeId: viewerId },
      ],
    },
    select: { id: true, status: true, requesterId: true },
  });
  if (!row) return { status: "none" };
  if (row.status === "ACCEPTED") return { status: "connected", connectionId: row.id };
  return { status: row.requesterId === viewerId ? "outgoing" : "incoming", connectionId: row.id };
}
