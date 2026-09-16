import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { decryptSecret } from "@/lib/auth/secretBox";
import { verifyTotp } from "@/lib/auth/totp";
import { consumeRecoveryCode } from "@/lib/auth/recoveryCodes";
import { checkLockout, clientIp, clearFailures, registerFailure } from "@/lib/auth/throttle";

/**
 * Vérifications communes aux routes de gestion de la 2FA (/api/account/2fa/*).
 * Toutes exigent une réauthentification par mot de passe : une session volée ne
 * doit pas suffire à désactiver le second facteur ni à relire les codes de secours.
 */

export type TwoFactorUser = {
  id: string;
  email: string;
  passwordHash: string;
  twoFactorEnabled: boolean;
  twoFactorSecret: string | null;
};

export async function loadTwoFactorUser(userId: string): Promise<TwoFactorUser | null> {
  return db.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, passwordHash: true, twoFactorEnabled: true, twoFactorSecret: true },
  });
}

export type GuardFailure = { error: string; status: number };

/**
 * Réauthentification : verrou de débit, puis mot de passe, puis — si la 2FA est
 * déjà active — un code TOTP ou un code de secours. Retourne null si tout est bon.
 */
export async function requireReauth(
  req: Request,
  user: TwoFactorUser,
  input: { password: string; code?: string; recoveryCode?: string },
  { requireSecondFactor = true }: { requireSecondFactor?: boolean } = {},
): Promise<GuardFailure | null> {
  const keys = { email: user.email.toLowerCase(), ip: clientIp(req) };

  const lockedFor = await checkLockout(keys);
  if (lockedFor > 0) {
    return {
      error: `Trop de tentatives. Réessaie dans ${Math.ceil(lockedFor / 60)} minute(s).`,
      status: 429,
    };
  }

  if (!(await bcrypt.compare(input.password, user.passwordHash))) {
    await registerFailure(keys);
    return { error: "Mot de passe incorrect", status: 403 };
  }

  if (requireSecondFactor && user.twoFactorEnabled) {
    const ok = await verifySecondFactor(user, input.code, input.recoveryCode);
    if (!ok) {
      await registerFailure(keys);
      return { error: "Code de validation incorrect", status: 403 };
    }
  }

  await clearFailures(keys);
  return null;
}

/** Code TOTP OU code de secours (consommé s'il est valide). */
export async function verifySecondFactor(
  user: TwoFactorUser,
  code?: string,
  recoveryCode?: string,
): Promise<boolean> {
  const secret = decryptSecret(user.twoFactorSecret);
  if (code && secret && verifyTotp(secret, code)) return true;
  if (recoveryCode) return consumeRecoveryCode(user.id, recoveryCode);
  return false;
}
