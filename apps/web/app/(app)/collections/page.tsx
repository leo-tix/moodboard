import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/current";
import { CollectionsClient } from "@/components/collections/CollectionsClient";
import { getSuggestedCollections } from "@/lib/collections/suggestions";

export const metadata: Metadata = { title: "Collections" };
export const revalidate = 0;

export default async function CollectionsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

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

      <CollectionsClient initialCollections={collections} suggestions={suggestions} />
    </div>
  );
}
