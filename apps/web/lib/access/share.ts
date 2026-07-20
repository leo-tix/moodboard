import { db } from "@/lib/db";
import { GrantResource, Visibility } from "@prisma/client";

// Correspondance segment d'URL ↔ type de ressource ACL. Les segments reprennent
// les routes existantes (/moodboards, /visites, /collections).
const SEGMENTS: Record<string, GrantResource> = {
  moodboards: "MOODBOARD",
  visits: "VISIT",
  collections: "COLLECTION",
};

export function segmentToResource(seg: string): GrantResource | null {
  return SEGMENTS[seg] ?? null;
}

/** La ressource appartient-elle à `userId` ? (gestion du partage = owner only). */
export async function isOwner(resource: GrantResource, id: string, userId: string): Promise<boolean> {
  const sel = { where: { id, userId }, select: { id: true } };
  const row =
    resource === "MOODBOARD"
      ? await db.moodboard.findFirst(sel)
      : resource === "VISIT"
        ? await db.visit.findFirst(sel)
        : await db.collection.findFirst(sel);
  return !!row;
}

export async function updateVisibility(resource: GrantResource, id: string, visibility: Visibility) {
  if (resource === "MOODBOARD") return db.moodboard.update({ where: { id }, data: { visibility } });
  if (resource === "VISIT") return db.visit.update({ where: { id }, data: { visibility } });
  return db.collection.update({ where: { id }, data: { visibility } });
}

/** Visibilité par défaut du propriétaire pour un type, appliquée à la création. */
export async function defaultVisibilityFor(userId: string, resource: GrantResource): Promise<Visibility> {
  const u = await db.user.findUnique({
    where: { id: userId },
    select: { defaultVisibilityMoodboard: true, defaultVisibilityVisit: true, defaultVisibilityCollection: true },
  });
  if (!u) return "PRIVATE";
  return resource === "MOODBOARD" ? u.defaultVisibilityMoodboard : resource === "VISIT" ? u.defaultVisibilityVisit : u.defaultVisibilityCollection;
}

/** Libellé lisible d'une ressource (pour les messages/chips de partage). */
export async function resourceLabel(resource: GrantResource, id: string): Promise<string> {
  if (resource === "MOODBOARD") return (await db.moodboard.findUnique({ where: { id }, select: { title: true } }))?.title ?? "Planche";
  if (resource === "VISIT") { const v = await db.visit.findUnique({ where: { id }, select: { place: true, exhibition: true } }); return v?.exhibition || v?.place || "Visite"; }
  return (await db.collection.findUnique({ where: { id }, select: { name: true } }))?.name ?? "Collection";
}

export async function getVisibility(resource: GrantResource, id: string): Promise<Visibility | null> {
  const sel = { where: { id }, select: { visibility: true } };
  const row =
    resource === "MOODBOARD"
      ? await db.moodboard.findUnique(sel)
      : resource === "VISIT"
        ? await db.visit.findUnique(sel)
        : await db.collection.findUnique(sel);
  return row?.visibility ?? null;
}
