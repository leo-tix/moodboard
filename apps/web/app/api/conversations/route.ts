import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { startConversationSchema } from "@/lib/validators/message";
import { getOrCreateConversation } from "@/lib/messaging/conversation";

const userSummary = { id: true, name: true, username: true, image: true } as const;

// GET /api/conversations — inbox : conversations + dernier message + non-lus.
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const me = session.user.id;

  const convos = await db.conversation.findMany({
    where: { OR: [{ userAId: me }, { userBId: me }] },
    orderBy: { lastMessageAt: "desc" },
    include: { userA: { select: userSummary }, userB: { select: userSummary } },
  });

  const conversations = await Promise.all(
    convos.map(async (c) => {
      const other = c.userAId === me ? c.userB : c.userA;
      const [last, unread] = await Promise.all([
        db.message.findFirst({ where: { conversationId: c.id }, orderBy: { createdAt: "desc" }, select: { body: true, createdAt: true, senderId: true, sharedResource: true, sharedImageId: true } }),
        db.message.count({ where: { conversationId: c.id, senderId: { not: me }, readAt: null } }),
      ]);
      return {
        id: c.id,
        status: c.status,
        isRequest: c.status === "PENDING" && c.initiatorId !== me,
        other,
        last,
        unread,
        lastMessageAt: c.lastMessageAt,
      };
    }),
  );

  return NextResponse.json({ conversations, unreadTotal: conversations.reduce((s, c) => s + c.unread, 0) });
}

// POST /api/conversations — ouvre (ou récupère) la conversation avec un membre.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const me = session.user.id;

  const body = await req.json().catch(() => ({}));
  const parsed = startConversationSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Données invalides" }, { status: 400 });

  const target = await db.user.findFirst({
    where: parsed.data.userId ? { id: parsed.data.userId } : { username: parsed.data.username!.toLowerCase() },
    select: { id: true },
  });
  if (!target) return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  if (target.id === me) return NextResponse.json({ error: "Impossible de s'écrire à soi-même" }, { status: 400 });

  const convo = await getOrCreateConversation(me, target.id);
  return NextResponse.json({ conversationId: convo.id, status: convo.status });
}
