import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { LibraryClient } from "@/components/inspiration/LibraryClient";

export const revalidate = 0;

interface Props { params: Promise<{ id: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const visit = await db.visit.findUnique({ where: { id }, select: { place: true } });
  return { title: visit ? `Visite — ${visit.place}` : "Visite" };
}

export default async function VisiteDetailPage({ params }: Props) {
  const { id } = await params;

  const visit = await db.visit.findUnique({
    where: { id },
    include: {
      inspirations: {
        where: { status: "READY", isArchived: false },
        include: {
          images: {
            select: { storageKey: true, thumbnailKey: true, blurHash: true, width: true, height: true, isMain: true, isAnimated: true },
            orderBy: [{ isMain: "desc" }, { order: "asc" }],
            take: 1,
          },
          categories: {
            include: { category: { select: { name: true } } },
            take: 3,
          },
          tags: { include: { tag: { select: { name: true } } }, take: 5 },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!visit) notFound();

  const date = visit.visitDate.toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <div className="p-4 md:p-6">
      <header className="mb-4">
        <Link
          href="/visites"
          className="text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors"
        >
          ← Carnet de visite
        </Link>
        <h1 className="text-xl md:text-2xl font-light text-[var(--text-primary)] mt-2 flex items-baseline gap-2 flex-wrap">
          {visit.place}
          <span className="text-sm font-normal text-[var(--text-tertiary)]">
            {visit.inspirations.length}
          </span>
        </h1>
        <p className="text-sm text-[var(--text-secondary)] mt-0.5">
          {visit.exhibition && <span className="italic">{visit.exhibition} · </span>}
          {date}
        </p>
        {visit.notes && (
          <p className="text-xs text-[var(--text-tertiary)] mt-2 max-w-xl">{visit.notes}</p>
        )}
      </header>

      <LibraryClient inspirations={visit.inspirations} />
    </div>
  );
}
