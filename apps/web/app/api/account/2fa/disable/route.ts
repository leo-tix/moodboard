import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { loadTwoFactorUser, requireReauth } from "@/lib/auth/twoFactor";
import { confirmSchema } from "@/lib/validators/twoFactor";

/**
 * POST /api/account/2fa/disable — désactive le second facteur.
 * Exige mot de passe + code en cours : désactiver la 2FA est exactement ce que
 * cherche à faire quelqu'un qui a volé une session.
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
    // Cas d'une configuration abandonnée avant confirmation : on nettoie le secret.
    await db.user.update({
      where: { id: user.id },
      data: { twoFactorSecret: null, twoFactorEnabledAt: null },
    });
    return NextResponse.json({ ok: true });
  }

  const failure = await requireReauth(req, user, parsed.data);
  if (failure) return NextResponse.json({ error: failure.error }, { status: failure.status });

  await db.$transaction([
    db.user.update({
      where: { id: user.id },
      data: { twoFactorEnabled: false, twoFactorSecret: null, twoFactorEnabledAt: null },
    }),
    db.twoFactorRecoveryCode.deleteMany({ where: { userId: user.id } }),
  ]);

  return NextResponse.json({ ok: true });
}
