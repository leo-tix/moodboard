import type { Metadata } from "next";
import { db } from "@/lib/db";
import { LibraryClient } from "@/components/inspiration/LibraryClient";

export const metadata: Metadata = { title: "Bibliothèque" };
export const revalidate = 60;

export default async function LibraryPage() {
  const inspirations = await db.inspiration.findMany({
    where: { status: "READY", isAccepted: true, isArchived: false },
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
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return (
    <div className="p-6">
      <header className="mb-4 flex items-center justify-between">
        <div>
          <p className="text-[var(--text-tertiary)] text-xs tracking-widest uppercase mb-1">Archive</p>
          <h1 className="text-2xl font-light text-[var(--text-primary)]">
            Bibliothèque
            {inspirations.length > 0 && (
              <span className="ml-3 text-sm font-normal text-[var(--text-tertiary)]">{inspirations.length}</span>
            )}
          </h1>
        </div>
        <a href="/upload" className="px-4 py-2 text-xs bg-[var(--bg-surface)] border border-[var(--border-default)] text-[var(--text-secondary)] rounded-md hover:text-[var(--text-primary)] hover:border-[var(--border-strong)] transition-colors">
          + Ajouter
        </a>
      </header>
      <LibraryClient inspirations={inspirations} />
    </div>
  );
}
