import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { VISIT_READONLY_INCLUDE } from "@/lib/visits/readOnlyInclude";
import { VisitReadOnlyView } from "@/components/visits/VisitReadOnlyView";

export const metadata: Metadata = { robots: "noindex" };

interface Props { params: Promise<{ token: string }> }

// Carnet de visite public en LECTURE SEULE (Phase 5). Accessible sans session
// via un shareToken. Aucune donnée propriétaire exposée au-delà du carnet
// lui-même — pas de scoping userId (l'accès EST le token).
export default async function PublicCarnetPage({ params }: Props) {
  const { token } = await params;

  const visit = await db.visit.findUnique({
    where: { shareToken: token },
    include: VISIT_READONLY_INCLUDE,
  });

  if (!visit) notFound();
  // Lien expiré → 404 (même comportement que le partage des planches).
  if (visit.shareExpiry && visit.shareExpiry < new Date()) notFound();

  return (
    <div className="min-h-screen bg-[var(--bg-base)]">
      <VisitReadOnlyView visit={visit} />
      <footer className="max-w-4xl mx-auto px-4 md:px-6 pb-10 pt-2 text-center">
        <p className="text-[11px] text-[var(--text-tertiary)] border-t border-[var(--border-subtle)] pt-6">Carnet de visite partagé — Moodboard</p>
      </footer>
    </div>
  );
}
