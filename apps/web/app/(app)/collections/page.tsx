import type { Metadata } from "next";
import { db } from "@/lib/db";
import { CollectionsClient } from "@/components/collections/CollectionsClient";

export const metadata: Metadata = { title: "Collections" };
export const revalidate = 0;

export default async function CollectionsPage() {
  const collections = await db.collection.findMany({
    include: {
      items: {
        include: {
          inspiration: {
            include: {
              images: {
                where: { isMain: true },
                take: 1,
                select: { thumbnailKey: true },
              },
            },
          },
        },
        orderBy: { order: "asc" },
        take: 4,
      },
      _count: { select: { items: true } },
    },
    orderBy: { order: "asc" },
  });

  return (
    <div className="p-6">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <p className="text-[var(--text-tertiary)] text-xs tracking-widest uppercase mb-1">
            Archive
          </p>
          <h1 className="text-2xl font-light text-[var(--text-primary)]">
            Collections
            {collections.length > 0 && (
              <span className="ml-3 text-sm font-normal text-[var(--text-tertiary)]">
                {collections.length}
              </span>
            )}
          </h1>
        </div>
        {/* Le bouton Créer est géré côté client dans CollectionsClient */}
      </header>

      <CollectionsClient initialCollections={collections} />
    </div>
  );
}
