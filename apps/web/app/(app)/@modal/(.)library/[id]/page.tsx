import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { DetailModal } from "@/components/library/DetailModal";
import type { DetailPageData } from "@/components/library/DetailPageClient";

interface Props { params: Promise<{ id: string }> }

export default async function InterceptedLibraryDetail({ params }: Props) {
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
      categories: { select: { categoryId: true, subcategoryId: true } },
      tags: { select: { tag: { select: { name: true } } } },
      colorPalette: {
        orderBy: { order: "asc" },
        select: { id: true, hex: true, percentage: true, order: true },
      },
      aiAnalysis: { select: { moodDescriptor: true, styleKeywords: true } },
      collections: { select: { collection: { select: { id: true, name: true } } } },
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
      ? { moodDescriptor: inspiration.aiAnalysis.moodDescriptor, styleKeywords: inspiration.aiAnalysis.styleKeywords }
      : null,
    initialCollections: inspiration.collections.map((c) => ({
      id: c.collection.id,
      name: c.collection.name,
    })),
  };

  return <DetailModal data={data} />;
}
