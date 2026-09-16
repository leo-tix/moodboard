import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { regenerateRecoveryCodes } from "@/lib/auth/recoveryCodes";
import { loadTwoFactorUser, requireReauth } from "@/lib/auth/twoFactor";
import { confirmSchema } from "@/lib/validators/twoFactor";

/**
 * POST /api/account/2fa/recovery-codes — régénère la série de codes de secours.
 * L'ancienne série est invalidée : c'est le geste à faire si une liste imprimée
 * a pu être vue par quelqu'un d'autre.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const parsed = confirmSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Données invalides" }, { status: 400 });
  }

  const user = await loadTwoFactorUser(session.user.id);
  if (!user) return NextResponse.json({ error: "Compte introuvable" }, { status: 404 });
  if (!user.twoFactorEnabled) {
    return NextResponse.json({ error: "Active d'abord la double authentification" }, { status: 409 });
  }

  const failure = await requireReauth(req, user, parsed.data);
  if (failure) return NextResponse.json({ error: failure.error }, { status: failure.status });

  const recoveryCodes = await regenerateRecoveryCodes(user.id);
  return NextResponse.json({ ok: true, recoveryCodes });
}
