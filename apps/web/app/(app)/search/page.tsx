import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/current";
import { InspirationGrid, type InspirationGridItem } from "@/components/inspiration/InspirationGrid";
import { LibraryClient } from "@/components/inspiration/LibraryClient";
import { SearchBar } from "@/components/search/SearchBar";
import { FilterPanel } from "@/components/search/FilterPanel";
import { FilterDrawer } from "@/components/search/FilterDrawer";
import type { Prisma } from "@prisma/client";
import { Prisma as PrismaClient } from "@prisma/client";

export const metadata: Metadata = { title: "Recherche" };
export const dynamic = "force-dynamic";

// Same perceptual distance as the API route (kept in sync)
function colorDistance(hex1: string, hex2: string): number {
  const p = (h: string, s: number) => parseInt(h.slice(s, s + 2), 16);
  const [r1, g1, b1] = [p(hex1, 1), p(hex1, 3), p(hex1, 5)];
  const [r2, g2, b2] = [p(hex2, 1), p(hex2, 3), p(hex2, 5)];
  return Math.sqrt(2 * (r1-r2)**2 + 4 * (g1-g2)**2 + 3 * (b1-b2)**2);
}

interface SearchPageProps {
  searchParams: Promise<{
    q?: string;
    categoryId?: string;
    tags?: string;
    yearFrom?: string;
    yearTo?: string;
    color?: string;
    page?: string;
    archived?: string;
  }>;
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const userId = user.id;

  const params = await searchParams;
  const q = params.q?.trim() ?? "";
  const categoryId = params.categoryId ?? "";
  const tags = params.tags ? params.tags.split(",").filter(Boolean) : [];
  const yearFrom = params.yearFrom ? parseInt(params.yearFrom) : null;
  const yearTo = params.yearTo ? parseInt(params.yearTo) : null;
  const colorHex = params.color ? params.color.replace("#", "").toUpperCase() : "";
  const isColorSearch = /^[0-9A-F]{6}$/.test(colorHex);
  const isArchivedMode = params.archived === "true";

  const hasFilters = q || categoryId || tags.length > 0 || yearFrom || yearTo || isColorSearch;

  const textWhere: Prisma.InspirationWhereInput = {
    userId,
    status:     "READY",
    isAccepted: isArchivedMode ? undefined : true,
    isArchived: isArchivedMode ? true : false,
    ...(q && {
      OR: [
        { title: { contains: q, mode: "insensitive" } },
        { author: { contains: q, mode: "insensitive" } },
        { description: { contains: q, mode: "insensitive" } },
        { country: { contains: q, mode: "insensitive" } },
        { tags: { some: { tag: { name: { contains: q, mode: "insensitive" } } } } },
      ],
    }),
    ...(categoryId && { categories: { some: { categoryId } } }),
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

  const [inspirationsRaw, categories, popularTags] = await Promise.all([
    db.inspiration.findMany({
      where: isColorSearch
        ? { userId, status: "READY", isAccepted: isArchivedMode ? undefined : true, isArchived: isArchivedMode ? true : false, colorPalette: { some: {} } }
        : textWhere,
      include: {
        colorPalette: isColorSearch ? { orderBy: { order: "asc" } } : false,
        images: {
          select: { thumbnailKey: true, blurHash: true, width: true, height: true, isMain: true },
          orderBy: [{ isMain: "desc" }, { order: "asc" }],
          take: 1,
        },
        categories: { include: { category: { select: { name: true } } }, take: 3 },
        tags: { include: { tag: { select: { name: true } } }, take: 5 },
      },
      orderBy: { createdAt: "desc" },
      take: isColorSearch ? 500 : 96,
    }),
    db.category.findMany({ orderBy: { order: "asc" } }),
    db.tag.findMany({
      where: { userId },
      include: { _count: { select: { inspirations: true } } },
      orderBy: { inspirations: { _count: "desc" } },
      take: 20,
    }),
  ]);

  // Color sort — compute min distance per inspiration, filter, sort
  type InspirationWithColor = (typeof inspirationsRaw)[0] & { _colorDistance?: number };
  let inspirations: InspirationWithColor[];

  if (isColorSearch) {
    const target = `#${colorHex}`;
    const THRESHOLD = 120;
    inspirations = (inspirationsRaw as InspirationWithColor[])
      .map((insp) => {
        const palette = (insp as { colorPalette?: { hex: string }[] }).colorPalette ?? [];
        const minDist = palette.length
          ? Math.min(...palette.map((c) => colorDistance(target, c.hex)))
          : 999;
        return { ...insp, _colorDistance: Math.round(minDist) };
      })
      .filter((i) => i._colorDistance! <= THRESHOLD)
      .sort((a, b) => a._colorDistance! - b._colorDistance!)
      .slice(0, 48);
  } else {
    inspirations = inspirationsRaw;
  }

  // ── En mode archives : compter les moodboards qui contiennent chaque image ──
  let moodboardCountMap: Record<string, number> = {};
  if (isArchivedMode && inspirations.length > 0) {
    const ids = inspirations.map((i) => i.id);
    try {
      const rows = await db.$queryRaw<{ inspiration_id: string; count: bigint }[]>(
        PrismaClient.sql`
          SELECT
            elem->>'inspirationId' AS inspiration_id,
            COUNT(DISTINCT id)::integer AS count
          FROM moodboards,
            jsonb_array_elements("canvasData") AS elem
          WHERE elem->>'type' = 'image'
            AND "userId" = ${userId}
            AND elem->>'inspirationId' = ANY(${ids})
          GROUP BY elem->>'inspirationId'
        `
      );
      for (const row of rows) {
        moodboardCountMap[row.inspiration_id] = Number(row.count);
      }
    } catch {
      // Non-bloquant — le badge ne s'affiche pas si la requête échoue
    }
  }

  const tagsForPanel = popularTags
    .filter((t) => t._count.inspirations > 0)
    .map((t) => ({ name: t.name, slug: t.slug, count: t._count.inspirations }));

  return (
    <div className="p-4 md:p-6">
      <header className="mb-4 md:mb-6">
        <div className="flex items-center gap-3 mb-1">
          <p className="text-[var(--text-tertiary)] text-xs tracking-widest uppercase">Explorer</p>
          {/* Toggle archives */}
          <a
            href={isArchivedMode ? "/search" : "/search?archived=true"}
            className={`text-[10px] px-2.5 py-1 rounded-full border transition-colors ${
              isArchivedMode
                ? "bg-amber-500/15 border-amber-500/40 text-amber-400"
                : "border-[var(--border-subtle)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
            }`}
          >
            {isArchivedMode ? "✕ Quitter les archives" : "⊘ Voir les archives"}
          </a>
        </div>
        <h1 className="text-2xl font-light text-[var(--text-primary)] mb-4">
          {isArchivedMode ? "Archives" : "Recherche"}
          {isArchivedMode && (
            <span className="ml-3 text-sm font-normal text-amber-400/80">
              {inspirations.length} image{inspirations.length !== 1 ? "s" : ""} archivée{inspirations.length !== 1 ? "s" : ""}
            </span>
          )}
        </h1>
        {!isArchivedMode && (
          <Suspense>
            <SearchBar autoFocus />
          </Suspense>
        )}
      </header>

      {/* Mode archives — grille sélectionnable avec BatchEditBar */}
      {isArchivedMode ? (
        inspirations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <p className="text-[var(--text-tertiary)] text-sm">Aucune image archivée</p>
            <a href="/triage" className="text-xs text-[var(--accent,#a78bfa)] mt-2 hover:opacity-80 transition-opacity">
              ← Retour au triage
            </a>
          </div>
        ) : (
          <LibraryClient
          isArchivedMode
          inspirations={(inspirations as InspirationGridItem[]).map((i) => ({
            ...i,
            moodboardCount: moodboardCountMap[i.id] ?? 0,
            // Rattachée à une visite (carnet) = "utilisée", au même titre
            // qu'une présence sur une planche (voir LibraryClient.unusedIds).
            visitId: i.visitId ?? null,
          }))}
        />
        )
      ) : (
        // flex-col sur mobile : sans ce breakpoint, "flex gap-8" restait une
        // rangée à toutes les tailles d'écran — sur mobile, le bouton
        // "Filtres" (seul rendu du FilterDrawer hors desktop) devenait un
        // item de rangée à côté de la grille de résultats au lieu de
        // s'empiler au-dessus, lui volant une bonne partie de la largeur
        // (bug remonté 2026-07-14).
        <div className="flex flex-col md:flex-row gap-4 md:gap-8">
          {/* Mobile: drawer toggle + panel; Desktop: inline sidebar */}
          <Suspense>
            <FilterDrawer hasActiveFilters={!!(categoryId || tags.length || yearFrom || yearTo || colorHex)}>
              <FilterPanel categories={categories} popularTags={tagsForPanel} />
            </FilterDrawer>
          </Suspense>

          <div className="flex-1 min-w-0">
            {isColorSearch && (
              <div className="flex items-center gap-2 mb-4">
                <div className="w-5 h-5 rounded-sm border border-[var(--border-subtle)]" style={{ backgroundColor: `#${colorHex}` }} />
                <p className="text-xs text-[var(--text-secondary)]">
                  Couleurs similaires à <span className="font-mono">#{colorHex}</span>
                </p>
                {inspirations.length > 0 && (
                  <span className="text-[10px] text-[var(--text-tertiary)]">— {inspirations.length} résultat{inspirations.length > 1 ? "s" : ""}</span>
                )}
              </div>
            )}

            {hasFilters && !isColorSearch && (
              <p className="text-xs text-[var(--text-tertiary)] mb-4">
                {inspirations.length === 0
                  ? "Aucun résultat"
                  : `${inspirations.length} résultat${inspirations.length > 1 ? "s" : ""}${q ? ` pour "${q}"` : ""}`}
              </p>
            )}

            {!hasFilters ? (
              <div className="flex flex-col items-center justify-center py-24 text-center">
                <p className="text-[var(--text-tertiary)] text-sm mb-1">Tape quelque chose pour commencer</p>
                <p className="text-[var(--text-tertiary)] text-xs">ou utilise les filtres pour explorer ta bibliothèque</p>
              </div>
            ) : inspirations.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24 text-center">
                <p className="text-[var(--text-tertiary)] text-sm">Aucun résultat</p>
                {isColorSearch && (
                  <p className="text-[var(--text-tertiary)] text-xs mt-1">
                    Essaie une couleur plus proche de ta bibliothèque
                  </p>
                )}
              </div>
            ) : (
              <InspirationGrid inspirations={inspirations as InspirationGridItem[]} columns={3} saveNavContext />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
