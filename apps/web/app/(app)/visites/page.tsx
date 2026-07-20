import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/current";
import { VisitsClient } from "@/components/visits/VisitsClient";
import { VisitsHeaderActions } from "@/components/visits/VisitsHeaderActions";
import { accessibleWhere } from "@/lib/access/resolve";
import { getImageUrl } from "@/lib/storage/urls";
import { pickImgUrl } from "@/lib/social/previewCover";
import { LibraryTabs } from "@/components/social/LibraryTabs";
import { SharedResourceGrid, type SharedItem } from "@/components/social/SharedResourceGrid";

export const metadata: Metadata = { title: "Carnet de visite" };
export const revalidate = 0;

export default async function VisitesPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const shared = (await searchParams).tab === "shared";
  const sharedWhere = { AND: [{ userId: { not: user.id } }, await accessibleWhere("VISIT", user.id)] };
  const sharedCount = await db.visit.count({ where: sharedWhere });

  if (shared) {
    const rows = await db.visit.findMany({ where: sharedWhere, select: { id: true, place: true, exhibition: true, coverKey: true, user: { select: { name: true, username: true, image: true } }, inspirations: { where: { status: "READY" }, orderBy: [{ visitOrder: "asc" }, { createdAt: "asc" }], take: 1, select: { images: { orderBy: [{ isMain: "desc" }, { order: "asc" }], take: 1, select: { thumbnailKey: true, storageKey: true } } } } }, orderBy: { visitDate: "desc" }, take: 60 });
    const items: SharedItem[] = rows.map((v) => ({ id: v.id, href: `/visites/${v.id}`, title: v.exhibition || v.place, cover: v.coverKey ? getImageUrl(v.coverKey) : pickImgUrl(v.inspirations[0]?.images[0]), board: null, owner: v.user }));
    return (
      <div className="p-4 md:p-6">
        <LibraryTabs base="/visites" active="shared" mineLabel="Mes visites" sharedCount={sharedCount} />
        <SharedResourceGrid items={items} emptyLabel="Aucune visite partagée avec toi pour l'instant." />
      </div>
    );
  }

  const visits = await db.visit.findMany({
    where: { userId: user.id },
    orderBy: { visitDate: "desc" },
    include: {
      _count: { select: { inspirations: true } },
      inspirations: {
        take: 4,
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          images: {
            where: { isMain: true },
            take: 1,
            select: { thumbnailKey: true },
          },
        },
      },
    },
  });

  const serialized = visits.map((v) => ({
    id: v.id,
    place: v.place,
    exhibition: v.exhibition,
    visitDate: v.visitDate.toISOString(),
    notes: v.notes,
    count: v._count.inspirations,
    thumbnails: v.inspirations
      .map((i) => i.images[0]?.thumbnailKey)
      .filter((k): k is string => Boolean(k)),
  }));

  return (
    <div className="p-4 md:p-6">
      <header className="mb-6 flex items-start justify-between gap-3">
        <div>
          <p className="text-[var(--text-tertiary)] text-xs tracking-widest uppercase mb-1">
            Archive
          </p>
          <h1 className="text-2xl font-light text-[var(--text-primary)]">
            Carnet de visite
            {serialized.length > 0 && (
              <span className="ml-3 text-sm font-normal text-[var(--text-tertiary)]">
                {serialized.length}
              </span>
            )}
          </h1>
        </div>
        <VisitsHeaderActions />
      </header>

      <LibraryTabs base="/visites" active="mine" mineLabel="Mes visites" sharedCount={sharedCount} />
      <VisitsClient initialVisits={serialized} />
    </div>
  );
}
