import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

/**
 * Chiffrement symétrique des secrets 2FA stockés en base (AES-256-GCM).
 *
 * Pourquoi chiffrer : un secret TOTP en clair dans la table `users` suffit à
 * générer des codes valides. Une fuite de la base (dump, sauvegarde, accès
 * lecture seule) contournerait alors entièrement le second facteur. Le
 * chiffrement déplace ce risque vers la variable d'environnement, qui ne vit
 * pas dans la base.
 *
 * Clé : `TWO_FACTOR_ENCRYPTION_KEY` si elle existe (32 octets en base64 —
 * `openssl rand -base64 32`), sinon dérivée de `NEXTAUTH_SECRET` pour que
 * l'app démarre sans nouvelle variable. Changer l'une ou l'autre rend les
 * secrets existants illisibles : les comptes concernés devront réactiver la
 * 2FA (le code de connexion échouera proprement, sans planter l'application).
 */

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // taille nominale d'un nonce GCM
const PREFIX = "v1"; // versionne le format : v1:<iv>:<tag>:<ciphertext>, tout en base64url

function encryptionKey(): Buffer {
  const explicit = process.env.TWO_FACTOR_ENCRYPTION_KEY;
  if (explicit) {
    const key = Buffer.from(explicit, "base64");
    if (key.length !== 32) {
      throw new Error("TWO_FACTOR_ENCRYPTION_KEY doit faire 32 octets en base64");
    }
    return key;
  }
  const fallback = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET;
  if (!fallback) {
    throw new Error("NEXTAUTH_SECRET manquant : impossible de chiffrer les secrets 2FA");
  }
  // SHA-256 d'un secret déjà aléatoire de haute entropie — pas un mot de passe,
  // donc pas besoin d'une dérivation lente type scrypt.
  return createHash("sha256").update(`moodboard:2fa:${fallback}`).digest();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIX, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(":");
}

/** Déchiffre, ou retourne null si le format/la clé/le tag ne collent pas. */
export function decryptSecret(payload: string | null | undefined): string | null {
  if (!payload) return null;
  const parts = payload.split(":");
  if (parts.length !== 4 || parts[0] !== PREFIX) return null;
  try {
    const [, ivB64, tagB64, dataB64] = parts;
    const decipher = createDecipheriv(ALGORITHM, encryptionKey(), Buffer.from(ivB64, "base64url"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
    const plain = Buffer.concat([decipher.update(Buffer.from(dataB64, "base64url")), decipher.final()]);
    return plain.toString("utf8");
  } catch {
    return null;
  }
}
