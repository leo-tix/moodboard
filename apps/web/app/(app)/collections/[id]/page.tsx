import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { CollectionDetailClient } from "@/components/collections/CollectionDetailClient";
import { getSuggestedAdditions } from "@/lib/collections/suggestions";

interface Props { params: Promise<{ id: string }> }

export const revalidate = 0;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const col = await db.collection.findUnique({ where: { id }, select: { name: true } });
  return { title: col?.name ?? "Collection" };
}

export default async function CollectionDetailPage({ params }: Props) {
  const { id } = await params;

  const [collection, suggestions] = await Promise.all([
    db.collection.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            inspiration: {
              include: {
                images: {
                  orderBy: [{ isMain: "desc" }, { order: "asc" }],
                  take: 1,
                  select: { thumbnailKey: true, blurHash: true, width: true, height: true, isMain: true },
                },
                categories: { include: { category: { select: { name: true } } }, take: 3 },
                tags: { include: { tag: { select: { name: true } } }, take: 5 },
              },
            },
          },
          orderBy: { order: "asc" },
        },
        _count: { select: { items: true } },
      },
    }),
    getSuggestedAdditions(id),
  ]);

  if (!collection) notFound();

  return (
    <div className="p-6">
      <div className="flex items-center gap-2 mb-6">
        <Link
          href="/collections"
          className="text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors"
        >
          ← Collections
        </Link>
        <span className="text-[var(--border-default)] text-xs">/</span>
        <span className="text-xs text-[var(--text-tertiary)]">
          {collection._count.items} image{collection._count.items !== 1 ? "s" : ""}
        </span>
      </div>

      <CollectionDetailClient
        collectionId={collection.id}
        initialName={collection.name}
        initialDescription={collection.description}
        initialItems={collection.items}
        suggestions={suggestions}
      />
    </div>
  );
}
