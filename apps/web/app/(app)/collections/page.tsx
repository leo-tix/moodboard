import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/current";
import { CollectionsClient } from "@/components/collections/CollectionsClient";
import { getSuggestedCollections } from "@/lib/collections/suggestions";
import { accessibleWhere } from "@/lib/access/resolve";
import { getImageUrl } from "@/lib/storage/urls";
import { pickImgUrl } from "@/lib/social/previewCover";
import { LibraryTabs } from "@/components/social/LibraryTabs";
import { SharedResourceGrid, type SharedItem } from "@/components/social/SharedResourceGrid";

export const metadata: Metadata = { title: "Collections" };
export const revalidate = 0;

export default async function CollectionsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const shared = (await searchParams).tab === "shared";
  const sharedWhere = { AND: [{ userId: { not: user.id } }, await accessibleWhere("COLLECTION", user.id)] };
  const sharedCount = await db.collection.count({ where: sharedWhere });

  if (shared) {
    const rows = await db.collection.findMany({ where: sharedWhere, select: { id: true, name: true, coverImageKey: true, user: { select: { name: true, username: true, image: true } }, items: { orderBy: { order: "asc" }, take: 1, select: { inspiration: { select: { images: { orderBy: [{ isMain: "desc" }, { order: "asc" }], take: 1, select: { thumbnailKey: true, storageKey: true } } } } } } }, orderBy: { updatedAt: "desc" }, take: 60 });
    const items: SharedItem[] = rows.map((c) => ({ id: c.id, href: `/collections/${c.id}`, title: c.name, cover: c.coverImageKey ? getImageUrl(c.coverImageKey) : pickImgUrl(c.items[0]?.inspiration.images[0]), board: null, owner: c.user }));
    return (
      <div className="p-4 md:p-6">
        <LibraryTabs base="/collections" active="shared" mineLabel="Mes collections" sharedCount={sharedCount} />
        <SharedResourceGrid items={items} emptyLabel="Aucune collection partagée avec toi pour l'instant." />
      </div>
    );
  }

  const collections = await db.collection.findMany({
    where: { userId: user.id },
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

  const suggestions = await getSuggestedCollections(collections.map((c) => c.name), user.id);

  return (
    <div className="p-4 md:p-6">
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
      </header>

      <LibraryTabs base="/collections" active="mine" mineLabel="Mes collections" sharedCount={sharedCount} />
      <CollectionsClient initialCollections={collections} suggestions={suggestions} />
    </div>
  );
}
