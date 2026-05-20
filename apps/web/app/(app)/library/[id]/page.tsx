import { notFound } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { db } from "@/lib/db";
import { getImageUrl } from "@/lib/storage/urls";
import { MetadataPanel } from "@/components/inspiration/MetadataPanel";

export const revalidate = 0;

interface Props { params: Promise<{ id: string }> }

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  const inspiration = await db.inspiration.findUnique({ where: { id }, select: { title: true } });
  return { title: inspiration?.title ?? "Inspiration" };
}

export default async function InspirationDetailPage({ params }: Props) {
  const { id } = await params;

  const inspiration = await db.inspiration.findUnique({
    where: { id },
    include: {
      images: { orderBy: [{ isMain: "desc" }, { order: "asc" }] },
      categories: { include: { category: true, subcategory: true } },
      tags: { include: { tag: true } },
      colorPalette: { orderBy: { order: "asc" } },
      aiAnalysis: true,
    },
  });

  if (!inspiration) notFound();

  const mainImage = inspiration.images[0];
  const mainImageUrl = mainImage ? getImageUrl(mainImage.storageKey) : null;

  return (
    <div className="flex h-screen flex-col">
      <div className="flex-shrink-0 px-6 py-3 border-b border-[var(--border-subtle)] flex items-center gap-2">
        <Link href="/library" className="text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors">
          ← Bibliothèque
        </Link>
        <span className="text-[var(--border-default)] text-xs">/</span>
        <span className="text-xs text-[var(--text-secondary)] truncate max-w-xs">{inspiration.title}</span>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Image */}
        <div className="flex-1 bg-[var(--bg-surface)] flex items-center justify-center overflow-hidden">
          {mainImageUrl ? (
            <div className="relative w-full h-full">
              <Image src={mainImageUrl} alt={inspiration.title} fill className="object-contain" priority sizes="(max-width: 1280px) 70vw, 60vw" />
            </div>
          ) : (
            <div className="text-[var(--text-tertiary)] text-sm">Pas d&apos;image</div>
          )}
        </div>

        {/* Metadata panel */}
        <div className="w-80 flex-shrink-0 border-l border-[var(--border-subtle)] overflow-hidden flex flex-col">
          <MetadataPanel
            id={inspiration.id}
            initialData={{
              title: inspiration.title,
              description: inspiration.description ?? "",
              author: inspiration.author ?? "",
              studio: inspiration.studio ?? "",
              year: inspiration.year ?? undefined,
              country: inspiration.country ?? "",
              exposition: inspiration.exposition ?? "",
              location: inspiration.location ?? "",
              source: inspiration.source ?? "",
              notes: inspiration.notes ?? "",
              sourceUrl: inspiration.sourceUrl ?? "",
              categories: inspiration.categories.map((c) => ({
                categoryId: c.categoryId,
                subcategoryId: c.subcategoryId ?? null,
              })),
              tags: inspiration.tags.map((t) => t.tag.name),
            }}
            colorPalette={inspiration.colorPalette}
            aiAnalysis={
              inspiration.aiAnalysis
                ? { moodDescriptor: inspiration.aiAnalysis.moodDescriptor, styleKeywords: inspiration.aiAnalysis.styleKeywords }
                : null
            }
          />
        </div>
      </div>
    </div>
  );
}
