import { z } from "zod";

export const createInspirationSchema = z.object({
  title: z.string().min(1, "Titre requis").max(255),
  description: z.string().max(2000).optional(),
  author: z.string().max(255).optional(),
  studio: z.string().max(255).optional(),
  year: z.number().int().min(1000).max(new Date().getFullYear() + 1).optional(),
  country: z.string().max(100).optional(),
  exposition: z.string().max(255).optional(),
  location: z.string().max(255).optional(),
  source: z.string().max(255).optional(),
  sourceUrl: z.string().url().optional().or(z.literal("")),
  notes: z.string().max(5000).optional(),
  categoryId: z.string().cuid().optional(),
  subcategoryId: z.string().cuid().optional(),
  tags: z.array(z.string()).default([]),
});

export const updateInspirationSchema = createInspirationSchema.partial();

export type CreateInspirationInput = z.infer<typeof createInspirationSchema>;
export type UpdateInspirationInput = z.infer<typeof updateInspirationSchema>;
