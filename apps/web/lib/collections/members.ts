import { db } from "@/lib/db";

export type CollectionMember = {
  id: string;
  name: string | null;
  username: string | null;
  image: string | null;
  role: "OWNER" | "EDITOR" | "VIEWER";
};

// Membres d'une collection : propriétaire (en premier) + toute personne ayant un
// grant (éditeur/lecteur). Pour la rangée d'avatars « qui a accès ».
export async function getCollectionMembers(collectionId: string): Promise<CollectionMember[]> {
  const [col, grants] = await Promise.all([
    db.collection.findUnique({ where: { id: collectionId }, select: { user: { select: { id: true, name: true, username: true, image: true } } } }),
    db.resourceGrant.findMany({ where: { resource: "COLLECTION", resourceId: collectionId }, select: { role: true, user: { select: { id: true, name: true, username: true, image: true } } } }),
  ]);
  const members: CollectionMember[] = [];
  if (col?.user) members.push({ ...col.user, role: "OWNER" });
  for (const g of grants) members.push({ ...g.user, role: g.role });
  return members;
}
