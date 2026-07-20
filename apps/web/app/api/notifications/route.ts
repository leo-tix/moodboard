import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import type { GrantResource } from "@prisma/client";

const userSummary = { id: true, name: true, username: true, image: true } as const;
type Actor = { name: string | null; username: string | null; image: string | null };
type Notif = {
  id: string;
  type: "connect_request" | "connect_accepted" | "shared";
  ts: string; // ISO
  actor: Actor;
  href: string;
  resourceLabel?: string;
  resourceKind?: GrantResource;
  role?: string;
};

const resourceHref = (r: GrantResource, id: string) => (r === "MOODBOARD" ? `/moodboards/${id}/edit` : r === "VISIT" ? `/visites/${id}` : `/collections/${id}`);

// GET /api/notifications — activité récente agrégée : demandes de connexion
// entrantes, mes demandes acceptées, ressources partagées avec moi (grants).
// Calcul à la volée (pas de table Notification) ; l'état « lu » est géré côté
// client via un timestamp localStorage comparé à `ts`.
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const me = session.user.id;

  const [requests, accepted, grants] = await Promise.all([
    db.connection.findMany({ where: { addresseeId: me, status: "PENDING" }, select: { id: true, createdAt: true, requester: { select: userSummary } }, orderBy: { createdAt: "desc" }, take: 50 }),
    db.connection.findMany({ where: { requesterId: me, status: "ACCEPTED" }, select: { id: true, respondedAt: true, createdAt: true, addressee: { select: userSummary } }, orderBy: { respondedAt: "desc" }, take: 50 }),
    db.resourceGrant.findMany({ where: { userId: me }, select: { id: true, resource: true, resourceId: true, role: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 50 }),
  ]);

  // Résout titre + propriétaire de chaque ressource grantée (batch par type).
  const byType = { MOODBOARD: [] as string[], VISIT: [] as string[], COLLECTION: [] as string[] };
  for (const g of grants) byType[g.resource].push(g.resourceId);
  const [boards, visits, collections] = await Promise.all([
    byType.MOODBOARD.length ? db.moodboard.findMany({ where: { id: { in: byType.MOODBOARD } }, select: { id: true, title: true, user: { select: userSummary } } }) : [],
    byType.VISIT.length ? db.visit.findMany({ where: { id: { in: byType.VISIT } }, select: { id: true, place: true, exhibition: true, user: { select: userSummary } } }) : [],
    byType.COLLECTION.length ? db.collection.findMany({ where: { id: { in: byType.COLLECTION } }, select: { id: true, name: true, user: { select: userSummary } } }) : [],
  ]);
  const boardMap = new Map(boards.map((b) => [b.id, { label: b.title, owner: b.user }]));
  const visitMap = new Map(visits.map((v) => [v.id, { label: v.exhibition || v.place, owner: v.user }]));
  const collMap = new Map(collections.map((c) => [c.id, { label: c.name, owner: c.user }]));
  const resolveGrant = (r: GrantResource, id: string) => (r === "MOODBOARD" ? boardMap.get(id) : r === "VISIT" ? visitMap.get(id) : collMap.get(id));

  const items: Notif[] = [];
  for (const c of requests) {
    items.push({ id: `req:${c.id}`, type: "connect_request", ts: c.createdAt.toISOString(), actor: c.requester, href: "/reseau" });
  }
  for (const c of accepted) {
    items.push({ id: `acc:${c.id}`, type: "connect_accepted", ts: (c.respondedAt ?? c.createdAt).toISOString(), actor: c.addressee, href: c.addressee.username ? `/u/${c.addressee.username}` : "/reseau" });
  }
  for (const g of grants) {
    const info = resolveGrant(g.resource, g.resourceId);
    if (!info) continue; // ressource supprimée
    items.push({ id: `grant:${g.id}`, type: "shared", ts: g.createdAt.toISOString(), actor: info.owner, href: resourceHref(g.resource, g.resourceId), resourceLabel: info.label, resourceKind: g.resource, role: g.role });
  }

  items.sort((a, b) => (a.ts < b.ts ? 1 : -1));
  return NextResponse.json({ notifications: items.slice(0, 60) });
}
