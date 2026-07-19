import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { sendMessageSchema } from "@/lib/validators/message";
import { conversationForParticipant } from "@/lib/messaging/conversation";
import { resolveAccess, canView } from "@/lib/access/resolve";

type Params = { params: Promise<{ id: string }> };

// POST /api/conversations/[id]/messages — envoie un message (texte / ressource / image).
export async function POST(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const me = session.user.id;
  const { id } = await params;

  const convo = await conversationForParticipant(id, me);
  if (!convo) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const parsed = sendMessageSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Données invalides" }, { status: 400 });
  const { body: text, sharedResource, sharedResourceId, sharedImageId } = parsed.data;

  // On ne partage que ce à quoi l'expéditeur a accès.
  if (sharedResource && sharedResourceId && !canView(await resolveAccess(sharedResource, sharedResourceId, me))) {
    return NextResponse.json({ error: "Ressource inaccessible" }, { status: 403 });
  }
  if (sharedImageId) {
    const img = await db.image.findFirst({ where: { id: sharedImageId, inspiration: { userId: me } }, select: { id: true } });
    if (!img) return NextResponse.json({ error: "Image inaccessible" }, { status: 403 });
  }

  const message = await db.message.create({
    data: { conversationId: id, senderId: me, body: text || null, sharedResource: sharedResource ?? null, sharedResourceId: sharedResourceId ?? null, sharedImageId: sharedImageId ?? null },
  });

  // MàJ conversation : dernier message + passage ACTIVE si le destinataire répond.
  await db.conversation.update({
    where: { id },
    data: { lastMessageAt: new Date(), ...(convo.status === "PENDING" && convo.initiatorId !== me ? { status: "ACTIVE" as const } : {}) },
  });

  return NextResponse.json({ ok: true, id: message.id });
}
