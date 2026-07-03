import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { DetailPageClient, type DetailPageData } from "@/components/library/DetailPageClient";

export const revalidate = 0;

interface Props { params: Promise<{ id: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const inspiration = await db.inspiration.findUnique({ where: { id }, select: { title: true } });
  return { title: inspiration?.title ?? "Inspiration" };
}

export default async function InspirationDetailPage({ params }: Props) {
  const { id } = await params;

  const inspiration = await db.inspiration.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      description: true,
      author: true,
      year: true,
      country: true,
      exposition: true,
      location: true,
      source: true,
      sourceUrl: true,
      images: {
        orderBy: [{ isMain: "desc" }, { order: "asc" }],
        take: 1,
        select: { storageKey: true },
      },
      categories: {
        select: { categoryId: true, subcategoryId: true },
      },
      tags: {
        select: { tag: { select: { name: true } } },
      },
      colorPalette: {
        orderBy: { order: "asc" },
        select: { id: true, hex: true, percentage: true, order: true },
      },
      aiAnalysis: {
        select: { moodDescriptor: true, styleKeywords: true },
      },
      collections: {
        select: { collection: { select: { id: true, name: true } } },
      },
      visit: {
        select: { id: true, place: true, exhibition: true, visitDate: true },
      },
    },
  });

  if (!inspiration) notFound();

  const data: DetailPageData = {
    id: inspiration.id,
    title: inspiration.title,
    mainImageStorageKey: inspiration.images[0]?.storageKey ?? null,
    initialData: {
      title: inspiration.title,
      description: inspiration.description ?? "",
      author: inspiration.author ?? "",
      year: inspiration.year ?? undefined,
      country: inspiration.country ?? "",
      exposition: inspiration.exposition ?? "",
      location: inspiration.location ?? "",
      source: inspiration.source ?? "",
      sourceUrl: inspiration.sourceUrl ?? "",
      categories: inspiration.categories.map((c) => ({
        categoryId: c.categoryId,
        subcategoryId: c.subcategoryId ?? null,
      })),
      tags: inspiration.tags.map((t) => t.tag.name),
    },
    colorPalette: inspiration.colorPalette,
    aiAnalysis: inspiration.aiAnalysis
      ? {
          moodDescriptor: inspiration.aiAnalysis.moodDescriptor,
          styleKeywords: inspiration.aiAnalysis.styleKeywords,
        }
      : null,
    initialCollections: inspiration.collections.map((c) => ({
      id: c.collection.id,
      name: c.collection.name,
    })),
    initialVisit: inspiration.visit
      ? {
          id: inspiration.visit.id,
          place: inspiration.visit.place,
          exhibition: inspiration.visit.exhibition,
          visitDate: inspiration.visit.visitDate.toISOString(),
        }
      : null,
  };

  return <DetailPageClient data={data} />;
}
