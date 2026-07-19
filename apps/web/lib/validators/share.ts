import { z } from "zod";

export const visibilitySchema = z.object({
  visibility: z.enum(["PRIVATE", "CONNECTIONS", "PUBLIC"]),
});

export const grantSchema = z
  .object({
    userId: z.string().cuid().optional(),
    username: z.string().trim().min(1).optional(),
    role: z.enum(["VIEWER", "EDITOR"]).default("VIEWER"),
  })
  .refine((d) => d.userId || d.username, "Destinataire requis");

export const grantRemoveSchema = z.object({ userId: z.string().cuid() });
