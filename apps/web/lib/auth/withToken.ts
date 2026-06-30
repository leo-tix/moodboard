import { auth } from "@/auth";
import { db } from "@/lib/db";
import { createHash } from "crypto";

/**
 * Authenticates a request via NextAuth session OR a Bearer API token.
 * Returns the userId, or null if unauthenticated.
 */
export async function getAuthUserId(req: Request): Promise<string | null> {
  // 1. Session cookie (normal browser usage)
  const session = await auth();
  if (session?.user?.id) return session.user.id;

  // 2. Bearer token (Chrome extension)
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const plainToken = authHeader.slice(7).trim();
  if (!plainToken) return null;

  const tokenHash = createHash("sha256").update(plainToken).digest("hex");
  const apiToken = await db.apiToken.findUnique({
    where: { tokenHash },
    select: { id: true, userId: true },
  });

  if (!apiToken) return null;

  // Fire-and-forget lastUsedAt update
  db.apiToken
    .update({ where: { id: apiToken.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});

  return apiToken.userId;
}
