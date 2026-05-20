import { Suspense } from "react";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { InspirationGrid } from "@/components/inspiration/InspirationGrid";
import { SearchBar } from "@/components/search/SearchBar";
import { FilterPanel } from "@/components/search/FilterPanel";
import { Spinner } from "@/components/ui/Spinner";
import type { Prisma } from "@prisma/client";

export const metadata: Metadata = { title: "Recherche" };
export const dynamic = "force-dynamic";

interface SearchPageProps {
  searchParams: Promise<{
    q?: string;
    categoryId?: string;
    tags?: string;
    yearFrom?: string;
    yearTo?: string;
    page?: string;
  }>;
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const params = await searchParams;
  const q = params.q?.trim() ?? "";
  const categoryId = params.categoryId ?? "";
  const tags = params.tags ? params.tags.split(",").filter(Boolean) : [];
  const yearFrom = params.yearFrom ? parseInt(params.yearFrom) : null;
  const yearTo = params.yearTo ? parseInt(params.yearTo) : null;

  const hasFilters = q || categoryId || tags.length > 0 || yearFrom || yearTo;

  // Filtres Prisma
  const where: Prisma.InspirationWhereInput = {
    status: "READY",
    ...(q && {
      OR: [
        { title: { contains: q, mode: "insensitive" } },
        { author: { contains: q, mode: "insensitive" } },
        { studio: { contains: q, mode: "insensitive" } },
        { description: { contains: q, mode: "insensitive" } },
        { notes: { contains: q, mode: "insensitive" } },
        { country: { contains: q, mode: "insensitive" } },
        { tags: { some: { tag: { name: { contains: q, mode: "insensitive" } } } } },
      ],
    }),
    ...(categoryId && { categoryId }),
    ...(tags.length > 0 && {
      AND: tags.map((slug) => ({ tags: { some: { tag: { slug } } } })),
    }),
    ...((yearFrom || yearTo) && {
      year: {
        ...(yearFrom && { gte: yearFrom }),
        ...(yearTo && { lte: yearTo }),
      },
    }),
  };

  // Données en parallèle
  const [inspirations, categories, popularTags] = await Promise.all([
    db.inspiration.findMany({
      where,
      include: {
        images: {
          select: { thumbnailKey: true, blurHash: true, width: true, height: true, isMain: true },
          orderBy: [{ isMain: "desc" }, { order: "asc" }],
          take: 1,
        },
        category: { select: { name: true } },
        tags: { include: { tag: { select: { name: true } } }, take: 5 },
      },
      orderBy: { createdAt: "desc" },
      take: 96,
    }),

    db.category.findMany({ orderBy: { order: "asc" } }),

    // Tags les plus utilisés
    db.tag.findMany({
      include: { _count: { select: { inspirations: true } } },
      orderBy: { inspirations: { _count: "desc" } },
      take: 20,
    }),
  ]);

  const tagsForPanel = popularTags
    .filter((t) => t._count.inspirations > 0)
    .map((t) => ({ name: t.name, slug: t.slug, count: t._count.inspirations }));

  return (
    <div className="p-6">
      <header className="mb-6">
        <p className="text-[var(--text-tertiary)] text-xs tracking-widest uppercase mb-1">
          Explorer
        </p>
        <h1 className="text-2xl font-light text-[var(--text-primary)] mb-4">Recherche</h1>

        {/* Barre de recherche */}
        <Suspense>
          <SearchBar autoFocus />
        </Suspense>
      </header>

      <div className="flex gap-8">
        {/* Filtres sidebar */}
        <Suspense>
          <FilterPanel categories={categories} popularTags={tagsForPanel} />
        </Suspense>

        {/* Résultats */}
        <div className="flex-1 min-w-0">
          {hasFilters && (
            <p className="text-xs text-[var(--text-tertiary)] mb-4">
              {inspirations.length === 0
                ? "Aucun résultat"
                : `${inspirations.length} résultat${inspirations.length > 1 ? "s" : ""}${q ? ` pour "${q}"` : ""}`}
            </p>
          )}

          {!hasFilters && inspirations.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <p className="text-[var(--text-tertiary)] text-sm mb-1">
                Tape quelque chose pour commencer
              </p>
              <p className="text-[var(--text-tertiary)] text-xs">
                ou utilise les filtres pour explorer ta bibliothèque
              </p>
            </div>
          ) : (
            <InspirationGrid inspirations={inspirations} columns={3} />
          )}
        </div>
      </div>
    </div>
  );
}
