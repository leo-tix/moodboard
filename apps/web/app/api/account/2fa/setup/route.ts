import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { encryptSecret } from "@/lib/auth/secretBox";
import { formatSecretForDisplay, generateTotpSecret, totpAuthUrl } from "@/lib/auth/totp";
import { loadTwoFactorUser, requireReauth } from "@/lib/auth/twoFactor";
import { setupSchema } from "@/lib/validators/twoFactor";

/**
 * POST /api/account/2fa/setup — prépare l'activation.
 *
 * Génère un secret, le stocke chiffré SANS activer la 2FA, et renvoie le QR
 * code + le secret en clair pour la saisie manuelle. L'activation n'est
 * effective qu'après /enable, une fois un premier code vérifié : sans cette
 * étape en deux temps, une appli mal configurée enfermerait le compte dehors.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const parsed = setupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Données invalides" }, { status: 400 });
  }

  const user = await loadTwoFactorUser(session.user.id);
  if (!user) return NextResponse.json({ error: "Compte introuvable" }, { status: 404 });
  if (user.twoFactorEnabled) {
    return NextResponse.json({ error: "La double authentification est déjà active" }, { status: 409 });
  }

  const failure = await requireReauth(req, user, { password: parsed.data.password });
  if (failure) return NextResponse.json({ error: failure.error }, { status: failure.status });

  const secret = generateTotpSecret();
  const otpauthUrl = totpAuthUrl(secret, user.email);

  await db.user.update({
    where: { id: user.id },
    data: { twoFactorSecret: encryptSecret(secret), twoFactorEnabled: false, twoFactorEnabledAt: null },
  });

  const qrDataUrl = await QRCode.toDataURL(otpauthUrl, { margin: 1, width: 240 });

  return NextResponse.json({
    qrDataUrl,
    otpauthUrl,
    manualKey: formatSecretForDisplay(secret),
  });
}
