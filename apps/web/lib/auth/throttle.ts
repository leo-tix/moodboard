import { db } from "@/lib/db";

/**
 * Limitation de débit des tentatives de connexion (anti force brute et
 * bourrage d'identifiants).
 *
 * Deux clés sont comptées en parallèle pour chaque tentative :
 *  - `user:<email>` → protège un compte visé, quelle que soit l'origine ;
 *  - `ip:<adresse>` → protège l'instance d'un balayage sur beaucoup de comptes.
 *
 * Le compteur vit en base : en serverless, un compteur en mémoire disparaît
 * entre deux requêtes et ne protège rien.
 */

const MAX_FAILURES = 5;        // échecs tolérés avant verrou
const LOCK_MINUTES = 15;       // durée du verrou une fois le seuil atteint
const WINDOW_MINUTES = 60;     // au-delà, la série d'échecs est repartie de zéro
const IP_MULTIPLIER = 4;       // une IP partagée (NAT, bureau) tolère plus d'échecs

export type ThrottleKeys = { email?: string | null; ip?: string | null };

function keysFor({ email, ip }: ThrottleKeys): { key: string; max: number }[] {
  const keys: { key: string; max: number }[] = [];
  if (email) keys.push({ key: `user:${email.toLowerCase()}`, max: MAX_FAILURES });
  if (ip) keys.push({ key: `ip:${ip}`, max: MAX_FAILURES * IP_MULTIPLIER });
  return keys;
}

/** Adresse de l'appelant derrière le proxy Vercel. */
export function clientIp(req: Request | undefined): string | null {
  if (!req) return null;
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return req.headers.get("x-real-ip");
}

/** Verrou actif ? Retourne le nombre de secondes restantes, ou 0. */
export async function checkLockout(keys: ThrottleKeys): Promise<number> {
  const names = keysFor(keys).map((k) => k.key);
  if (names.length === 0) return 0;

  const rows = await db.loginAttempt.findMany({
    where: { key: { in: names }, lockedUntil: { gt: new Date() } },
    select: { lockedUntil: true },
  });
  if (rows.length === 0) return 0;

  const until = Math.max(...rows.map((r) => r.lockedUntil!.getTime()));
  return Math.ceil((until - Date.now()) / 1000);
}

/** Enregistre un échec et pose le verrou si le seuil est franchi. */
export async function registerFailure(keys: ThrottleKeys): Promise<void> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - WINDOW_MINUTES * 60_000);

  for (const { key, max } of keysFor(keys)) {
    const existing = await db.loginAttempt.findUnique({ where: { key } });

    // Série expirée (ou inexistante) → on repart d'un seul échec.
    if (!existing || existing.firstFailAt < windowStart) {
      await db.loginAttempt.upsert({
        where: { key },
        create: { key, failures: 1, firstFailAt: now },
        update: { failures: 1, firstFailAt: now, lockedUntil: null },
      });
      continue;
    }

    const failures = existing.failures + 1;
    await db.loginAttempt.update({
      where: { key },
      data: {
        failures,
        lockedUntil: failures >= max ? new Date(now.getTime() + LOCK_MINUTES * 60_000) : existing.lockedUntil,
      },
    });
  }
}

/** Connexion réussie → on efface l'ardoise. */
export async function clearFailures(keys: ThrottleKeys): Promise<void> {
  const names = keysFor(keys).map((k) => k.key);
  if (names.length === 0) return;
  await db.loginAttempt.deleteMany({ where: { key: { in: names } } });
}

export const THROTTLE = { MAX_FAILURES, LOCK_MINUTES, WINDOW_MINUTES } as const;
