import { createHash, randomInt } from "crypto";
import { db } from "@/lib/db";

/**
 * Codes de secours : la porte de sortie quand le téléphone d'authentification
 * est perdu. Dix codes à usage unique, affichés UNE seule fois à l'activation,
 * stockés hachés (SHA-256). Consommer un code le marque définitivement utilisé.
 */

const CODE_COUNT = 10;
// Alphabet sans caractères ambigus (0/O, 1/I/L) — ces codes se recopient à la main.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const GROUP = 5; // deux groupes de 5 → 10 caractères ≈ 49 bits d'entropie

export function hashRecoveryCode(code: string): string {
  return createHash("sha256").update(normalizeRecoveryCode(code)).digest("hex");
}

/** Insensible à la casse et aux tirets : « abcde-fghij » == « ABCDEFGHIJ ». */
export function normalizeRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function generateOne(): string {
  let out = "";
  for (let i = 0; i < GROUP * 2; i++) {
    // randomInt (CSPRNG, non biaisé) plutôt que Math.random.
    out += ALPHABET[randomInt(ALPHABET.length)];
  }
  return `${out.slice(0, GROUP)}-${out.slice(GROUP)}`;
}

/**
 * Remplace tous les codes de l'utilisateur par une nouvelle série et retourne
 * les codes en clair — seul moment où ils existent en clair.
 */
export async function regenerateRecoveryCodes(userId: string): Promise<string[]> {
  const codes = Array.from({ length: CODE_COUNT }, generateOne);
  await db.$transaction([
    db.twoFactorRecoveryCode.deleteMany({ where: { userId } }),
    db.twoFactorRecoveryCode.createMany({
      data: codes.map((code) => ({ userId, codeHash: hashRecoveryCode(code) })),
    }),
  ]);
  return codes;
}

/** Consomme un code s'il est valide et encore inutilisé. */
export async function consumeRecoveryCode(userId: string, code: string): Promise<boolean> {
  const normalized = normalizeRecoveryCode(code);
  if (normalized.length !== GROUP * 2) return false;

  const hash = hashRecoveryCode(normalized);
  // updateMany + filtre `usedAt: null` : la condition et l'écriture sont dans la
  // même requête, donc deux connexions simultanées ne peuvent pas consommer le
  // même code deux fois (count vaut 1 pour une seule d'entre elles).
  const { count } = await db.twoFactorRecoveryCode.updateMany({
    where: { userId, codeHash: hash, usedAt: null },
    data: { usedAt: new Date() },
  });
  return count === 1;
}

export async function countUnusedRecoveryCodes(userId: string): Promise<number> {
  return db.twoFactorRecoveryCode.count({ where: { userId, usedAt: null } });
}
