import { z } from "zod";

/** Code TOTP à 6 chiffres — les espaces de la saisie sont tolérés. */
export const totpCodeSchema = z
  .string()
  .trim()
  .transform((s) => s.replace(/\s/g, ""))
  .refine((s) => /^\d{6}$/.test(s), "Code à 6 chiffres attendu");

/** Code de secours : 10 caractères, tiret et casse libres. */
export const recoveryCodeSchema = z
  .string()
  .trim()
  .refine((s) => s.replace(/[^A-Za-z0-9]/g, "").length === 10, "Code de secours invalide");

export const setupSchema = z.object({
  password: z.string().min(1, "Mot de passe requis"),
});

export const enableSchema = z.object({
  code: totpCodeSchema,
});

/** Désactivation / régénération des codes : mot de passe + second facteur. */
export const confirmSchema = z
  .object({
    password: z.string().min(1, "Mot de passe requis"),
    code: totpCodeSchema.optional(),
    recoveryCode: recoveryCodeSchema.optional(),
  })
  .refine((v) => Boolean(v.code || v.recoveryCode), {
    message: "Code de validation requis",
    path: ["code"],
  });
