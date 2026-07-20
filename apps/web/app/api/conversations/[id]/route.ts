import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { getImageUrl } from "@/lib/storage/urls";
import { conversationForParticipant, otherParticipant } from "@/lib/messaging/conversation";
import { visitCoverUrl, collectionCoverUrl } from "@/lib/social/previewCover";
import type { GrantResource } from "@prisma/client";

type Params = { params: Promise<{ id: string }> };
const userSummary = { id: true, name: true, username: true, image: true } as const;

const resourceHref = (r: GrantResource, id: string) => (r === "MOODBOARD" ? `/moodboards/${id}/edit` : r === "VISIT" ? `/visites/${id}` : `/collections/${id}`);

// Aperçu riche d'une ressource partagée en message (label + lien + cover/preview).
async function resourcePreview(resource: GrantResource, id: string) {
  const href = resourceHref(resource, id);
  if (resource === "MOODBOARD") {
    const m = await db.moodboard.findUnique({ where: { id }, select: { title: true, background: true, previewKey: true } });
    return { label: m?.title ?? "Planche", href, kind: resource, cover: null as string | null, board: m ? { previewKey: m.previewKey, background: m.background } : null };
  }
  if (resource === "VISIT") {
    const v = await db.visit.findUnique({ where: { id }, select: { place: true, exhibition: true, coverKey: true } });
    return { label: v?.exhibition || v?.place || "Visite", href, kind: resource, cover: v ? await visitCoverUrl(id, v.coverKey) : null, board: null };
  }
  const c = await db.collection.findUnique({ where: { id }, select: { name: true, coverImageKey: true } });
  return { label: c?.name ?? "Collection", href, kind: resource, cover: c ? await collectionCoverUrl(id, c.coverImageKey) : null, board: null };
}

// GET /api/conversations/[id] — fil complet + marque les entrants comme lus.
export async function GET(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const me = session.user.id;
  const { id } = await params;

  const convo = await conversationForParticipant(id, me);
  if (!convo) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const [other, rawMessages] = await Promise.all([
    db.user.findUnique({ where: { id: otherParticipant(convo, me) }, select: userSummary }),
    db.message.findMany({ where: { conversationId: id }, orderBy: { createdAt: "asc" } }),
  ]);

  // Marque les messages reçus comme lus.
  await db.message.updateMany({ where: { conversationId: id, senderId: { not: me }, readAt: null }, data: { readAt: new Date() } });

  // Enrichit les partages (image → URL ; ressource → libellé + lien).
  const imageIds = rawMessages.map((m) => m.sharedImageId).filter((x): x is string => !!x);
  const images = imageIds.length
    ? await db.image.findMany({ where: { id: { in: imageIds } }, select: { id: true, thumbnailKey: true, storageKey: true } })
    : [];
  const imageMap = new Map(images.map((i) => [i.id, getImageUrl(i.thumbnailKey ?? i.storageKey)]));

  const messages = await Promise.all(
    rawMessages.map(async (m) => ({
      id: m.id,
      senderId: m.senderId,
      mine: m.senderId === me,
      body: m.body,
      createdAt: m.createdAt,
      image: m.sharedImageId ? imageMap.get(m.sharedImageId) ?? null : null,
      imageId: m.sharedImageId ?? null,
      resource: m.sharedResource && m.sharedResourceId
        ? await resourcePreview(m.sharedResource, m.sharedResourceId)
        : null,
    })),
  );

  return NextResponse.json({
    conversation: { id: convo.id, status: convo.status, isRequest: convo.status === "PENDING" && convo.initiatorId !== me, other },
    messages,
  });
}

// PATCH /api/conversations/[id] — accepter une demande (le destinataire non-initiateur).
export async function PATCH(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const me = session.user.id;
  const { id } = await params;

  const convo = await conversationForParticipant(id, me);
  if (!convo) return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  if (convo.status === "PENDING" && convo.initiatorId !== me) {
    await db.conversation.update({ where: { id }, data: { status: "ACTIVE" } });
  }
  return NextResponse.json({ ok: true, status: "ACTIVE" });
}
