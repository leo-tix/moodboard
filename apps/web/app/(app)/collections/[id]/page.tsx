import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { CollectionDetailClient } from "@/components/collections/CollectionDetailClient";

interface Props { params: Promise<{ id: string }> }

export const revalidate = 0;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const col = await db.collection.findUnique({ where: { id }, select: { name: true } });
  return { title: col?.name ?? "Collection" };
}

export default async function CollectionDetailPage({ params }: Props) {
  const { id } = await params;

  const collection = await db.collection.findUnique({
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
  });

  if (!collection) notFound();

  return (
    <div className="p-6">
      <header className="mb-6">
        <div className="flex items-center gap-2 mb-3">
          <Link
            href="/collections"
            className="text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors"
          >
            ← Collections
          </Link>
        </div>
        <div className="flex items-end justify-between">
          <div>
            <p className="text-[var(--text-tertiary)] text-xs tracking-widest uppercase mb-1">
              Collection
            </p>
            <h1 className="text-2xl font-light text-[var(--text-primary)]">
              {collection.name}
              <span className="ml-3 text-sm font-normal text-[var(--text-tertiary)]">
                {collection._count.items}
              </span>
            </h1>
            {collection.description && (
              <p className="text-sm text-[var(--text-secondary)] mt-1">
                {collection.description}
              </p>
            )}
          </div>
        </div>
      </header>

      <CollectionDetailClient
        collectionId={collection.id}
        initialItems={collection.items}
      />
    </div>
  );
}
