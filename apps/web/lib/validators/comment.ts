import { z } from "zod";
import { COMMENT_MAX_LENGTH, COMMENT_NAME_MAX_LENGTH } from "@/lib/moodboard/comments";

// Le canvas est infini mais pas illimité : on borne l'ancre à un carré très
// large autour de l'origine, pour qu'une valeur aberrante (ou forgée) ne place
// pas une pastille à 1e300 du contenu.
const COORD_MAX = 1_000_000;
const coord = z.number().finite().min(-COORD_MAX).max(COORD_MAX);

export const commentCreateSchema = z
  .object({
    body: z.string().trim().min(1, "Commentaire vide").max(COMMENT_MAX_LENGTH),
    authorName: z.string().trim().min(1, "Indique ton nom").max(COMMENT_NAME_MAX_LENGTH),
    x: coord.optional(),
    y: coord.optional(),
    parentId: z.string().cuid().optional(),
  })
  .refine(
    (d) => (d.parentId ? true : d.x !== undefined && d.y !== undefined),
    "Un commentaire épinglé doit porter une position",
  );

export const commentUpdateSchema = z
  .object({
    body: z.string().trim().min(1, "Commentaire vide").max(COMMENT_MAX_LENGTH).optional(),
    resolved: z.boolean().optional(),
  })
  .refine((d) => d.body !== undefined || d.resolved !== undefined, "Rien à modifier");
