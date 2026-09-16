import { createHmac, randomBytes, timingSafeEqual } from "crypto";

/**
 * TOTP (RFC 6238) — implémentation minimale, sans dépendance.
 *
 * Compatible avec Google Authenticator, 1Password, Bitwarden, Authy… :
 * HMAC-SHA1, 6 chiffres, fenêtre de 30 s, secret en base32 (RFC 4648 sans
 * remplissage). Ce sont les valeurs par défaut de la spec — les applis
 * d'authentification ne lisent d'ailleurs pas les paramètres `algorithm`/
 * `digits` de l'URI otpauth de façon fiable, donc on ne s'en écarte pas.
 */

const DIGITS = 6;
const PERIOD_SECONDS = 30;
const B32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/, "").replace(/\s+/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const idx = B32_ALPHABET.indexOf(char);
    if (idx === -1) throw new Error("Secret base32 invalide");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Nouveau secret partagé : 20 octets (160 bits), la taille recommandée par la RFC 4226. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** Code à 6 chiffres pour un secret et un instant donnés. */
export function generateTotp(secretBase32: string, atMs: number = Date.now()): string {
  const counter = Math.floor(atMs / 1000 / PERIOD_SECONDS);
  const buf = Buffer.alloc(8);
  // Compteur sur 64 bits big-endian ; writeBigUInt64BE évite la perte de
  // précision d'un décalage binaire 32 bits.
  buf.writeBigUInt64BE(BigInt(counter));

  const hmac = createHmac("sha1", base32Decode(secretBase32)).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return (binary % 10 ** DIGITS).toString().padStart(DIGITS, "0");
}

/**
 * Vérifie un code saisi. `window` = nombre de pas de 30 s tolérés de part et
 * d'autre (1 → ±30 s), pour absorber la dérive d'horloge du téléphone.
 * Comparaison à temps constant : un code TOTP est un secret court, une
 * comparaison naïve fuiterait sa valeur par le temps de réponse.
 */
export function verifyTotp(
  secretBase32: string,
  token: string,
  { window = 1, atMs = Date.now() }: { window?: number; atMs?: number } = {},
): boolean {
  const cleaned = token.replace(/\s/g, "");
  if (!/^\d{6}$/.test(cleaned)) return false;

  for (let step = -window; step <= window; step++) {
    const expected = generateTotp(secretBase32, atMs + step * PERIOD_SECONDS * 1000);
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(cleaned))) return true;
  }
  return false;
}

/** URI `otpauth://` à encoder dans le QR code présenté à l'utilisateur. */
export function totpAuthUrl(secretBase32: string, accountLabel: string, issuer = "Moodboard"): string {
  const label = encodeURIComponent(`${issuer}:${accountLabel}`);
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/** Secret affiché en groupes de 4 pour la saisie manuelle (sans QR). */
export function formatSecretForDisplay(secretBase32: string): string {
  return secretBase32.replace(/(.{4})/g, "$1 ").trim();
}
