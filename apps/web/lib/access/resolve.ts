import { cache } from "react";
import { db } from "@/lib/db";
import { GrantResource, Visibility } from "@prisma/client";
import { getConnectionIds, areConnected } from "@/lib/access/connections";

// Résolution d'accès partagé pour les ressources visibles/partageables
// (Moodboard, Visit, Collection). Les guards owner-only (`where:{id,userId}`)
// restent en place pour les mutations propriétaire ; ces helpers couvrent le
// NOUVEAU besoin : lecture/édition par un tiers autorisé.

export type AccessLevel = "owner" | "editor" | "viewer" | null;

async function ownerAndVisibility(
  resource: GrantResource,
  id: string,
): Promise<{ userId: string; visibility: Visibility } | null> {
  const sel = { select: { userId: true, visibility: true } };
  if (resource === "MOODBOARD") return db.moodboard.findUnique({ where: { id }, ...sel });
  if (resource === "VISIT") return db.visit.findUnique({ where: { id }, ...sel });
  return db.collection.findUnique({ where: { id }, ...sel });
}

/** Niveau d'accès d'un visiteur sur une ressource, ou null si aucun. */
export async function resolveAccess(
  resource: GrantResource,
  id: string,
  viewerId: string,
): Promise<AccessLevel> {
  const row = await ownerAndVisibility(resource, id);
  if (!row) return null;
  if (row.userId === viewerId) return "owner";

  const grant = await db.resourceGrant.findFirst({
    where: { resource, resourceId: id, userId: viewerId },
    select: { role: true },
  });
  if (grant) return grant.role === "EDITOR" ? "editor" : "viewer";

  if (row.visibility === "PUBLIC") return "viewer";
  if (row.visibility === "CONNECTIONS") {
    const conns = await getConnectionIds(viewerId);
    if (conns.includes(row.userId)) return "viewer";
  }
  return null;
}

export const canView = (a: AccessLevel) => a !== null;
export const canEdit = (a: AccessLevel) => a === "owner" || a === "editor";

/** Propriétaire OU éditeur (grant EDITOR) d'une ressource. Pour la co-édition. */
export async function canEditResource(resource: GrantResource, id: string, userId: string): Promise<boolean> {
  return canEdit(await resolveAccess(resource, id, userId));
}

/** Ids des ressources d'un type sur lesquelles le visiteur a un grant nominatif.
 * Mémoïsé par requête (React cache) : dédoublonne les appels multiples au sein
 * d'un même rendu (feed, profil…) — un aller-retour DB au lieu de N. */
export const grantedIds = cache(async (viewerId: string, resource: GrantResource): Promise<string[]> => {
  const rows = await db.resourceGrant.findMany({
    where: { userId: viewerId, resource },
    select: { resourceId: true },
  });
  return rows.map((r) => r.resourceId);
});

/**
 * Fragment Prisma `where` listant les ressources accessibles au visiteur :
 * les siennes, les publiques, celles en « Connexions » de ses connexions, et
 * celles partagées nominativement. À injecter dans un findMany sur le modèle
 * correspondant (Moodboard/Visit/Collection).
 */
export async function accessibleWhere(resource: GrantResource, viewerId: string) {
  const [connIds, grants] = await Promise.all([
    getConnectionIds(viewerId),
    grantedIds(viewerId, resource),
  ]);
  return {
    OR: [
      { userId: viewerId },
      { visibility: Visibility.PUBLIC },
      { visibility: Visibility.CONNECTIONS, userId: { in: connIds } },
      { id: { in: grants } },
    ],
  };
}

/**
 * Fragment `where` listant les ressources D'UN propriétaire donné visibles par le
 * visiteur (pour la page profil). Owner==viewer → tout ; sinon publiques +
 * connexions (si connecté) + partagées nominativement.
 */
export async function accessibleWhereForOwner(resource: GrantResource, viewerId: string, ownerId: string) {
  if (viewerId === ownerId) return { userId: ownerId };
  const [connected, grants] = await Promise.all([areConnected(viewerId, ownerId), grantedIds(viewerId, resource)]);
  const vis = connected ? [Visibility.PUBLIC, Visibility.CONNECTIONS] : [Visibility.PUBLIC];
  return { userId: ownerId, OR: [{ visibility: { in: vis } }, { id: { in: grants } }] };
}

/**
 * Version BATCH de `accessibleWhere` pour les pages qui filtrent PLUSIEURS types
 * (feed, onglets « partagé avec moi »). Précalcule connexions + grants des 3
 * types en UN SEUL wave parallèle, puis renvoie un builder synchrone par type.
 * Évite les ~6 allers-retours séquentiels de 3× `await accessibleWhere(...)`
 * (chaque RTT ≈ latence réseau vers la DB).
 */
export async function accessibleWhereBuilder(viewerId: string) {
  const [connIds, gBoard, gVisit, gColl] = await Promise.all([
    getConnectionIds(viewerId),
    grantedIds(viewerId, GrantResource.MOODBOARD),
    grantedIds(viewerId, GrantResource.VISIT),
    grantedIds(viewerId, GrantResource.COLLECTION),
  ]);
  const map: Record<GrantResource, string[]> = { MOODBOARD: gBoard, VISIT: gVisit, COLLECTION: gColl };
  return (resource: GrantResource) => ({
    OR: [
      { userId: viewerId },
      { visibility: Visibility.PUBLIC },
      { visibility: Visibility.CONNECTIONS, userId: { in: connIds } },
      { id: { in: map[resource] } },
    ],
  });
}

/** Version BATCH de `accessibleWhereForOwner` (page profil : 3 types d'un même
 * propriétaire) — 1 wave parallèle au lieu de 3× séquentiels. */
export async function accessibleWhereForOwnerBuilder(viewerId: string, ownerId: string) {
  if (viewerId === ownerId) return () => ({ userId: ownerId });
  const [connected, gBoard, gVisit, gColl] = await Promise.all([
    areConnected(viewerId, ownerId),
    grantedIds(viewerId, GrantResource.MOODBOARD),
    grantedIds(viewerId, GrantResource.VISIT),
    grantedIds(viewerId, GrantResource.COLLECTION),
  ]);
  const vis = connected ? [Visibility.PUBLIC, Visibility.CONNECTIONS] : [Visibility.PUBLIC];
  const map: Record<GrantResource, string[]> = { MOODBOARD: gBoard, VISIT: gVisit, COLLECTION: gColl };
  return (resource: GrantResource) => ({ userId: ownerId, OR: [{ visibility: { in: vis } }, { id: { in: map[resource] } }] });
}

/** Supprime les grants d'une ressource (à appeler quand elle est supprimée). */
export async function deleteGrantsFor(resource: GrantResource, id: string): Promise<void> {
  await db.resourceGrant.deleteMany({ where: { resource, resourceId: id } });
}
