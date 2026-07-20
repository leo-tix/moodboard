import type { Prisma } from "@prisma/client";

// Relations nécessaires au rendu LECTURE SEULE d'une visite (VisitReadOnlyView /
// buildBentoLayout). Partagé entre la page publique token et l'accès membre.
export const VISIT_READONLY_INCLUDE = {
  user: { select: { name: true, image: true } },
  inspirations: {
    where: { status: "READY" as const },
    select: {
      id: true,
      title: true,
      author: true,
      year: true,
      visitOrder: true,
      createdAt: true,
      images: {
        select: { storageKey: true, thumbnailKey: true, width: true, height: true },
        orderBy: [{ isMain: "desc" as const }, { order: "asc" as const }],
        take: 1,
      },
    },
  },
  noteBlocks: true,
  audioClips: true,
  embeds: true,
  mapBlocks: true,
  cartels: true,
  palettes: true,
  tickets: true,
  sketches: true,
  highlights: true,
  checklists: true,
  timelines: true,
} satisfies Prisma.VisitInclude;
