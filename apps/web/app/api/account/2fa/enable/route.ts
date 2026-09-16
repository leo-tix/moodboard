import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { decryptSecret } from "@/lib/auth/secretBox";
import { verifyTotp } from "@/lib/auth/totp";
import { regenerateRecoveryCodes } from "@/lib/auth/recoveryCodes";
import { loadTwoFactorUser } from "@/lib/auth/twoFactor";
import { clearFailures, checkLockout, clientIp, registerFailure } from "@/lib/auth/throttle";
import { enableSchema } from "@/lib/validators/twoFactor";

/**
 * POST /api/account/2fa/enable — confirme l'activation avec un premier code,
 * puis délivre les codes de secours (affichés une seule fois).
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const parsed = enableSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Code invalide" }, { status: 400 });
  }

  const user = await loadTwoFactorUser(session.user.id);
  if (!user) return NextResponse.json({ error: "Compte introuvable" }, { status: 404 });
  if (user.twoFactorEnabled) {
    return NextResponse.json({ error: "La double authentification est déjà active" }, { status: 409 });
  }

  const secret = decryptSecret(user.twoFactorSecret);
  if (!secret) {
    return NextResponse.json({ error: "Recommence la configuration" }, { status: 409 });
  }

  // Même limitation de débit que la connexion : le code fait 6 chiffres.
  const keys = { email: user.email.toLowerCase(), ip: clientIp(req) };
  const lockedFor = await checkLockout(keys);
  if (lockedFor > 0) {
    return NextResponse.json(
      { error: `Trop de tentatives. Réessaie dans ${Math.ceil(lockedFor / 60)} minute(s).` },
      { status: 429 },
    );
  }

  if (!verifyTotp(secret, parsed.data.code)) {
    await registerFailure(keys);
    return NextResponse.json({ error: "Code incorrect" }, { status: 403 });
  }
  await clearFailures(keys);

  await db.user.update({
    where: { id: user.id },
    data: { twoFactorEnabled: true, twoFactorEnabledAt: new Date() },
  });

  const recoveryCodes = await regenerateRecoveryCodes(user.id);
  return NextResponse.json({ ok: true, recoveryCodes });
}
