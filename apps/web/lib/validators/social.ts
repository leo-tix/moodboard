import { z } from "zod";

// Demande de connexion : par id de compte OU par handle (au moins un des deux).
export const connectionRequestSchema = z
  .object({
    userId: z.string().cuid().optional(),
    username: z.string().trim().min(1).optional(),
  })
  .refine((d) => d.userId || d.username, "Destinataire requis");

export type ConnectionRequestInput = z.infer<typeof connectionRequestSchema>;

// Réponse à une demande reçue.
export const connectionActionSchema = z.object({
  action: z.enum(["accept", "decline"]),
});

export type ConnectionActionInput = z.infer<typeof connectionActionSchema>;
