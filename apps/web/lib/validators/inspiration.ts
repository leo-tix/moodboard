import { z } from "zod";

const categorySelectionSchema = z.object({
  categoryId: z.string(),
  subcategoryId: z.string().optional().nullable(),
});

export const createInspirationSchema = z.object({
  title: z.string().min(1, "Titre requis").max(255),
  description: z.string().max(2000).optional(),
  author: z.string().max(255).optional(),
  year: z.number().int().min(1000).max(new Date().getFullYear() + 1).optional(),
  country: z.string().max(100).optional(),
  exposition: z.string().max(255).optional(),
  location: z.string().max(255).optional(),
  source: z.string().max(255).optional(),
  sourceUrl: z.string().url().optional().or(z.literal("")),
  // Multiple categories via junction table
  categories: z.array(categorySelectionSchema).default([]),
  tags: z.array(z.string()).default([]),
});

export const updateInspirationSchema = createInspirationSchema.partial().extend({
  isArchived: z.boolean().optional(),
  isAccepted: z.boolean().optional(),
});

export type CreateInspirationInput = z.infer<typeof createInspirationSchema>;
export type UpdateInspirationInput = z.infer<typeof updateInspirationSchema>;
export type CategorySelection = z.infer<typeof categorySelectionSchema>;
