import { db } from "@/lib/db";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CollectionSuggestion {
  type: "category" | "tag" | "year" | "author";
  label: string;
  sublabel: string; // e.g. "12 images · Catégorie"
  count: number;
  inspirationIds: string[];
  previewThumbs: string[]; // up to 4 thumbnailKeys
}

export interface SuggestedAddition {
  id: string;
  title: string;
  year: number | null;
  thumbnailKey: string | null;
  blurHash: string | null;
  width: number | null;
  height: number | null;
  score: number;
  matchReason: string;
}

// ─── Suggested collections ────────────────────────────────────────────────────

/**
 * Génère des suggestions de collections dynamiques à partir des métadonnées.
 * Exclut les collections déjà existantes (par nom).
 */
export async function getSuggestedCollections(
  existingCollectionNames: string[]
): Promise<CollectionSuggestion[]> {
  const excluded = new Set(existingCollectionNames.map((n) => n.toLowerCase().trim()));
  const suggestions: CollectionSuggestion[] = [];

  // ── 1. Par catégorie ──────────────────────────────────────────────────────

  // Compte les inspirations par catégorie
  const catCounts = await db.inspirationCategory.groupBy({
    by: ["categoryId"],
    _count: { inspirationId: true },
    where: { inspiration: { status: "READY" } },
    orderBy: { _count: { inspirationId: "desc" } },
    take: 10,
  });

  const popularCatIds = catCounts
    .filter((c) => c._count.inspirationId >= 3)
    .map((c) => c.categoryId);

  if (popularCatIds.length > 0) {
    const catDetails = await db.category.findMany({
      where: { id: { in: popularCatIds } },
      select: { id: true, name: true },
    });

    for (const cat of catDetails) {
      if (excluded.has(cat.name.toLowerCase())) continue;

      const count = catCounts.find((c) => c.categoryId === cat.id)?._count.inspirationId ?? 0;

      // Récupère les IDs et les vignettes
      const items = await db.inspirationCategory.findMany({
        where: { categoryId: cat.id, inspiration: { status: "READY" } },
        include: {
          inspiration: {
            include: {
              images: { where: { isMain: true }, take: 1, select: { thumbnailKey: true } },
            },
          },
        },
        take: 50,
        orderBy: { inspiration: { createdAt: "desc" } },
      });

      suggestions.push({
        type: "category",
        label: cat.name,
        sublabel: `${count} image${count > 1 ? "s" : ""} · Catégorie`,
        count,
        inspirationIds: items.map((i) => i.inspirationId),
        previewThumbs: items
          .slice(0, 4)
          .map((i) => i.inspiration.images[0]?.thumbnailKey)
          .filter((t): t is string => !!t),
      });
    }
  }

  // ── 2. Par tag populaire ───────────────────────────────────────────────────

  const tagCounts = await db.inspirationTag.groupBy({
    by: ["tagId"],
    _count: { inspirationId: true },
    where: { inspiration: { status: "READY" } },
    orderBy: { _count: { inspirationId: "desc" } },
    take: 20,
  });

  const popularTagIds = tagCounts
    .filter((t) => t._count.inspirationId >= 3)
    .slice(0, 8)
    .map((t) => t.tagId);

  if (popularTagIds.length > 0) {
    const tagDetails = await db.tag.findMany({
      where: { id: { in: popularTagIds } },
      select: { id: true, name: true },
    });

    for (const tag of tagDetails) {
      if (excluded.has(tag.name.toLowerCase())) continue;
      // Ne pas dupliquer si une catégorie du même nom a déjà été suggérée
      if (suggestions.some((s) => s.label.toLowerCase() === tag.name.toLowerCase())) continue;

      const count = tagCounts.find((t) => t.tagId === tag.id)?._count.inspirationId ?? 0;

      const items = await db.inspirationTag.findMany({
        where: { tagId: tag.id, inspiration: { status: "READY" } },
        include: {
          inspiration: {
            include: {
              images: { where: { isMain: true }, take: 1, select: { thumbnailKey: true } },
            },
          },
        },
        take: 50,
        orderBy: { inspiration: { createdAt: "desc" } },
      });

      suggestions.push({
        type: "tag",
        label: tag.name,
        sublabel: `${count} image${count > 1 ? "s" : ""} · Tag`,
        count,
        inspirationIds: items.map((i) => i.inspirationId),
        previewThumbs: items
          .slice(0, 4)
          .map((i) => i.inspiration.images[0]?.thumbnailKey)
          .filter((t): t is string => !!t),
      });
    }
  }

  // ── 3. Par année ──────────────────────────────────────────────────────────

  const yearCounts = await db.inspiration.groupBy({
    by: ["year"],
    _count: { id: true },
    where: { status: "READY", year: { not: null } },
    orderBy: { _count: { id: "desc" } },
    take: 5,
  });

  for (const yg of yearCounts.filter((y) => y._count.id >= 3 && y.year)) {
    const label = String(yg.year!);
    if (excluded.has(label)) continue;

    const items = await db.inspiration.findMany({
      where: { status: "READY", year: yg.year! },
      include: {
        images: { where: { isMain: true }, take: 1, select: { thumbnailKey: true } },
      },
      take: 50,
      orderBy: { createdAt: "desc" },
    });

    suggestions.push({
      type: "year",
      label,
      sublabel: `${yg._count.id} image${yg._count.id > 1 ? "s" : ""} · Année`,
      count: yg._count.id,
      inspirationIds: items.map((i) => i.id),
      previewThumbs: items
        .slice(0, 4)
        .map((i) => i.images[0]?.thumbnailKey)
        .filter((t): t is string => !!t),
    });
  }

  // ── 4. Par auteur ─────────────────────────────────────────────────────────

  const authorCounts = await db.inspiration.groupBy({
    by: ["author"],
    _count: { id: true },
    where: { status: "READY", author: { not: null } },
    orderBy: { _count: { id: "desc" } },
    take: 5,
  });

  for (const ag of authorCounts.filter((a) => a._count.id >= 3 && a.author)) {
    const label = ag.author!;
    if (excluded.has(label.toLowerCase())) continue;

    const items = await db.inspiration.findMany({
      where: { status: "READY", author: label },
      include: {
        images: { where: { isMain: true }, take: 1, select: { thumbnailKey: true } },
      },
      take: 50,
      orderBy: { createdAt: "desc" },
    });

    suggestions.push({
      type: "author",
      label,
      sublabel: `${ag._count.id} image${ag._count.id > 1 ? "s" : ""} · Auteur`,
      count: ag._count.id,
      inspirationIds: items.map((i) => i.id),
      previewThumbs: items
        .slice(0, 4)
        .map((i) => i.images[0]?.thumbnailKey)
        .filter((t): t is string => !!t),
    });
  }

  // Déduplique et trie par count décroissant
  return suggestions.sort((a, b) => b.count - a.count).slice(0, 9);
}

// ─── Suggested additions for a collection ─────────────────────────────────────

/**
 * Trouve les images de la bibliothèque les plus pertinentes à ajouter à
 * une collection existante, basé sur les tags et catégories partagés.
 */
export async function getSuggestedAdditions(
  collectionId: string
): Promise<SuggestedAddition[]> {
  // Récupère les items actuels avec leurs métadonnées
  const collection = await db.collection.findUnique({
    where: { id: collectionId },
    include: {
      items: {
        include: {
          inspiration: {
            include: {
              tags: { select: { tagId: true } },
              categories: { select: { categoryId: true } },
            },
          },
        },
      },
    },
  });

  if (!collection || collection.items.length === 0) return [];

  const existingIds = new Set(collection.items.map((i) => i.inspirationId));

  // Agrège les tags et catégories pondérés par fréquence dans la collection
  const tagFreq = new Map<string, number>();
  const catFreq = new Map<string, number>();

  for (const item of collection.items) {
    for (const t of item.inspiration.tags) {
      tagFreq.set(t.tagId, (tagFreq.get(t.tagId) ?? 0) + 1);
    }
    for (const c of item.inspiration.categories) {
      catFreq.set(c.categoryId, (catFreq.get(c.categoryId) ?? 0) + 1);
    }
  }

  if (tagFreq.size === 0 && catFreq.size === 0) return [];

  const tagIds = Array.from(tagFreq.keys());
  const catIds = Array.from(catFreq.keys());

  // Clause OR construite dynamiquement
  const orClauses = [
    ...(tagIds.length > 0 ? [{ tags: { some: { tagId: { in: tagIds } } } }] : []),
    ...(catIds.length > 0 ? [{ categories: { some: { categoryId: { in: catIds } } } }] : []),
  ];

  const candidates = await db.inspiration.findMany({
    where: {
      status: "READY",
      id: { notIn: Array.from(existingIds) },
      OR: orClauses,
    },
    include: {
      images: {
        orderBy: [{ isMain: "desc" }, { order: "asc" }],
        take: 1,
        select: { thumbnailKey: true, blurHash: true, width: true, height: true },
      },
      tags: { select: { tagId: true } },
      categories: { select: { categoryId: true } },
    },
    take: 60,
  });

  // Score chaque candidat
  const scored: SuggestedAddition[] = candidates.map((c) => {
    const tagMatches = c.tags.filter((t) => tagFreq.has(t.tagId)).length;
    const catMatches = c.categories.filter((cat) => catFreq.has(cat.categoryId)).length;

    // Pondération : catégorie vaut plus qu'un tag
    const score = tagMatches + catMatches * 2;

    let matchReason = "";
    if (catMatches > 0 && tagMatches > 0) {
      matchReason = `${catMatches} catégorie${catMatches > 1 ? "s" : ""} · ${tagMatches} tag${tagMatches > 1 ? "s" : ""}`;
    } else if (catMatches > 0) {
      matchReason = `${catMatches} catégorie${catMatches > 1 ? "s" : ""} en commun`;
    } else {
      matchReason = `${tagMatches} tag${tagMatches > 1 ? "s" : ""} en commun`;
    }

    return {
      id: c.id,
      title: c.title,
      year: c.year,
      thumbnailKey: c.images[0]?.thumbnailKey ?? null,
      blurHash: c.images[0]?.blurHash ?? null,
      width: c.images[0]?.width ?? null,
      height: c.images[0]?.height ?? null,
      score,
      matchReason,
    };
  });

  return scored.sort((a, b) => b.score - a.score).slice(0, 12);
}
