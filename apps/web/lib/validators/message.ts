import { z } from "zod";

export const startConversationSchema = z
  .object({ userId: z.string().cuid().optional(), username: z.string().trim().min(1).optional() })
  .refine((d) => d.userId || d.username, "Destinataire requis");

export const sendMessageSchema = z
  .object({
    body: z.string().trim().max(4000).optional(),
    sharedResource: z.enum(["MOODBOARD", "VISIT", "COLLECTION"]).optional(),
    sharedResourceId: z.string().optional(),
    sharedImageId: z.string().optional(),
  })
  .refine((d) => (d.body && d.body.length > 0) || d.sharedImageId || (d.sharedResource && d.sharedResourceId), "Message vide");
