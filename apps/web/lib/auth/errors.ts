import { CredentialsSignin } from "next-auth";

/**
 * Erreurs de connexion typées. NextAuth renvoie la propriété `code` au client
 * (`signIn(..., { redirect: false })` → `result.code`), ce qui permet à la page
 * de login de réagir précisément — demander le code 2FA, annoncer un verrou —
 * sans jamais inventer un endpoint qui reposterait le mot de passe.
 */

export class InvalidCredentialsError extends CredentialsSignin {
  code = "invalid_credentials";
}

/** Mot de passe correct, mais le compte exige un second facteur. */
export class TwoFactorRequiredError extends CredentialsSignin {
  code = "2fa_required";
}

/** Second facteur fourni mais invalide (code TOTP ou code de secours). */
export class TwoFactorInvalidError extends CredentialsSignin {
  code = "2fa_invalid";
}

/** Trop d'échecs : connexion verrouillée temporairement. */
export class TooManyAttemptsError extends CredentialsSignin {
  code = "too_many_attempts";
}
