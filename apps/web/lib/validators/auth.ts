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
