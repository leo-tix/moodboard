import { db } from "@/lib/db";
import { areConnected } from "@/lib/access/connections";

// Paire canonique (userAId < userBId) → une seule conversation par paire.
export function canonicalPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

/**
 * Trouve ou crée la conversation entre `me` et `other`. Entre connexions →
 * ACTIVE ; vers un non-connecté → PENDING (demande jusqu'à réponse/acceptation).
 */
export async function getOrCreateConversation(me: string, other: string) {
  const [userAId, userBId] = canonicalPair(me, other);
  const existing = await db.conversation.findFirst({ where: { userAId, userBId } });
  if (existing) return existing;
  const connected = await areConnected(me, other);
  return db.conversation.create({
    data: { userAId, userBId, initiatorId: me, status: connected ? "ACTIVE" : "PENDING" },
  });
}

/** La conversation si `me` en est participant, sinon null. */
export async function conversationForParticipant(id: string, me: string) {
  const c = await db.conversation.findUnique({ where: { id } });
  if (!c || (c.userAId !== me && c.userBId !== me)) return null;
  return c;
}

export function otherParticipant(c: { userAId: string; userBId: string }, me: string): string {
  return c.userAId === me ? c.userBId : c.userAId;
}
