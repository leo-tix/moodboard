import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/current";
import { VisitsClient } from "@/components/visits/VisitsClient";

export const metadata: Metadata = { title: "Carnet de visite" };
export const revalidate = 0;

export default async function VisitesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

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
      <header className="mb-6">
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
      </header>

      <VisitsClient initialVisits={serialized} />
    </div>
  );
}
