import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/current";
import { LibraryClient } from "@/components/inspiration/LibraryClient";
import { PwaInstallButton } from "@/components/pwa/PwaInstallButton";

export const metadata: Metadata = { title: "Bibliothèque" };
// Données par profil → rendu dynamique (pas de cache partagé entre profils)
export const dynamic = "force-dynamic";

export default async function LibraryPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const inspirations = await db.inspiration.findMany({
    where: { userId: user.id, status: "READY", isAccepted: true, isArchived: false },
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
    // Pas de `take` : un plafond artificiel (200 avant) tronquait
    // silencieusement la bibliothèque au-delà — le compteur restait figé à
    // 200 ET les images plus anciennes que la 200e devenaient invisibles
    // dans la grille (bug remonté 2026-07-14 ; le profil réel en a 286).
    // L'infinite scroll de LibraryClient pagine déjà côté client sur ce
    // tableau complet (PAGE_SIZE=48) — usage personnel, volumétrie modeste.
  });

  return (
    <div className="p-4 md:p-6">
      <header className="mb-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[var(--text-tertiary)] text-xs tracking-widest uppercase mb-1">Archive</p>
          <h1 className="text-xl md:text-2xl font-light text-[var(--text-primary)] flex items-baseline gap-2 flex-wrap">
            Bibliothèque
            {inspirations.length > 0 && (
              <span className="text-sm font-normal text-[var(--text-tertiary)]">{inspirations.length}</span>
            )}
          </h1>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <PwaInstallButton />
          <a href="/upload" className="px-3 py-2 text-xs bg-[var(--bg-surface)] border border-[var(--border-default)] text-[var(--text-secondary)] rounded-md hover:text-[var(--text-primary)] hover:border-[var(--border-strong)] transition-colors">
            + Ajouter
          </a>
        </div>
      </header>
      <LibraryClient inspirations={inspirations} />
    </div>
  );
}
