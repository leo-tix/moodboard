import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/current";
import { VisitsGlobalMap } from "@/components/visits/VisitsGlobalMap";

export const metadata: Metadata = { title: "Carte des visites — Moodboard" };
export const revalidate = 0;

export default async function VisitesCartePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const visits = await db.visit.findMany({
    where: { userId: user.id },
    orderBy: { visitDate: "desc" },
    include: {
      _count: { select: { inspirations: true } },
      inspirations: {
        take: 1,
        orderBy: { createdAt: "asc" },
        select: {
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
    latitude: v.latitude,
    longitude: v.longitude,
    count: v._count.inspirations,
    thumbnailKey: v.inspirations[0]?.images[0]?.thumbnailKey ?? null,
  }));

  return (
    <div className="p-4 md:p-6 h-[calc(100vh-2rem)] md:h-[calc(100vh-3rem)] flex flex-col">
      <header className="mb-4 flex-shrink-0">
        <p className="text-[var(--text-tertiary)] text-xs tracking-widest uppercase mb-1">
          Archive
        </p>
        <h1 className="text-2xl font-light text-[var(--text-primary)]">Carte des visites</h1>
      </header>

      <div className="flex-1 min-h-0">
        <VisitsGlobalMap visits={serialized} />
      </div>
    </div>
  );
}
