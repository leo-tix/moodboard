import { auth } from "@/auth";

export type CurrentUser = { id: string; role: "ADMIN" | "USER" };

/**
 * Utilisateur courant depuis la session (server components, server actions,
 * routes navigateur). Retourne null si non connecté.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  return { id: session.user.id, role: session.user.role ?? "USER" };
}

/** Exige un admin. Retourne l'utilisateur si admin, sinon null. */
export async function requireAdmin(): Promise<CurrentUser | null> {
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") return null;
  return user;
}
