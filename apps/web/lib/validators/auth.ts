import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().email("Email invalide"),
  password: z.string().min(8, "Mot de passe trop court"),
});

export type LoginInput = z.infer<typeof loginSchema>;

// ── Gestion de compte ──────────────────────────────────────────────────────────

export const profileSchema = z.object({
  name: z.string().trim().max(80, "Nom trop long").optional(),
  email: z.string().email("Email invalide").optional(),
});

export type ProfileInput = z.infer<typeof profileSchema>;

export const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1, "Mot de passe actuel requis"),
  newPassword: z.string().min(8, "Le nouveau mot de passe doit faire au moins 8 caractères"),
});

export type PasswordChangeInput = z.infer<typeof passwordChangeSchema>;

// ── Gestion des profils (admin) ─────────────────────────────────────────────────

// quotaBytes : plafond de stockage R2 alloué au profil, en octets.
export const createProfileSchema = z.object({
  email: z.string().email("Email invalide"),
  password: z.string().min(8, "Mot de passe trop court (min 8 caractères)"),
  name: z.string().trim().max(80, "Nom trop long").optional(),
  quotaBytes: z.number().int().positive("Quota invalide"),
});

export type CreateProfileInput = z.infer<typeof createProfileSchema>;

export const updateProfileSchema = z.object({
  name: z.string().trim().max(80, "Nom trop long").nullable().optional(),
  quotaBytes: z.number().int().positive("Quota invalide").optional(),
  password: z.string().min(8, "Mot de passe trop court (min 8 caractères)").optional(),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
