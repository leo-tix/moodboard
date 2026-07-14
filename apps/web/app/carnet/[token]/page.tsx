import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { buildJournalItems } from "@/lib/visits/journalItems";
import { VisitJournalReadOnly } from "@/components/visits/VisitJournalReadOnly";
import { VisitCoverCarousel } from "@/components/visits/VisitCoverCarousel";
import { VisitMap } from "@/components/visits/VisitMap";

export const metadata: Metadata = { robots: "noindex" };

interface Props { params: Promise<{ token: string }> }

// Carnet de visite public en LECTURE SEULE (Phase 5). Accessible sans session
// via un shareToken. Aucune donnée propriétaire exposée au-delà du carnet
// lui-même — pas de scoping userId (l'accès EST le token).
export default async function PublicCarnetPage({ params }: Props) {
  const { token } = await params;

  const visit = await db.visit.findUnique({
    where: { shareToken: token },
    include: {
      inspirations: {
        where: { status: "READY" },
        select: {
          id: true,
          title: true,
          author: true,
          year: true,
          visitOrder: true,
          createdAt: true,
          images: {
            select: { storageKey: true, thumbnailKey: true, width: true, height: true },
            orderBy: [{ isMain: "desc" }, { order: "asc" }],
            take: 1,
          },
        },
      },
      noteBlocks: true,
      titleBlocks: true,
      quoteBlocks: true,
      audioClips: true,
      columnBlocks: true,
      embeds: true,
    },
  });

  if (!visit) notFound();
  // Lien expiré → 404 (même comportement que le partage des planches).
  if (visit.shareExpiry && visit.shareExpiry < new Date()) notFound();

  const items = buildJournalItems(visit);
  const hasMap = visit.latitude !== null && visit.longitude !== null;

  const orderedInspirations = [...visit.inspirations].sort(
    (a, b) => a.visitOrder - b.visitOrder || a.createdAt.getTime() - b.createdAt.getTime(),
  );
  const coverImages = orderedInspirations
    .slice(0, 12)
    .map((i) => ({ id: i.id, storageKey: i.images[0]?.storageKey, width: i.images[0]?.width ?? null, height: i.images[0]?.height ?? null }))
    .filter((i): i is { id: string; storageKey: string; width: number | null; height: number | null } => Boolean(i.storageKey));
  const mapThumbnailKey = orderedInspirations[0]?.images[0]?.thumbnailKey ?? null;

  const hasCover = coverImages.length > 0;
  const coverTitle = visit.exhibition || visit.place;
  const date = new Date(visit.visitDate).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });

  return (
    <div className="min-h-screen bg-[var(--bg-base)]">
      <div className="max-w-3xl mx-auto p-4 md:p-6">
        {/* Infos superposées SUR la cover (titre/lieu/date), pas de doublon
            en dessous — cohérent avec la page de détail. */}
        {hasCover ? (
          <VisitCoverCarousel images={coverImages}>
            <div className="drop-shadow-[0_2px_12px_rgba(0,0,0,0.6)]">
              <h1 className="font-serif text-white text-3xl md:text-4xl font-semibold leading-tight">
                {coverTitle}
              </h1>
              <p className="text-sm text-white/85 mt-1">
                {visit.exhibition ? `${visit.place} · ${date}` : date}
              </p>
            </div>
          </VisitCoverCarousel>
        ) : (
          <header className="mb-5 mt-4">
            <h1 className="font-serif text-2xl md:text-3xl font-semibold text-[var(--text-primary)] leading-tight">
              {coverTitle}
            </h1>
            {visit.exhibition && <p className="text-sm text-[var(--text-secondary)] mt-1">{visit.place}</p>}
            <p className="text-xs text-[var(--text-tertiary)] mt-1">{date}</p>
          </header>
        )}

        {visit.notes && (
          <p className="text-xs text-[var(--text-tertiary)] mb-5 max-w-xl whitespace-pre-wrap">{visit.notes}</p>
        )}

        {hasMap && (
          <div className="mb-6 rounded-xl overflow-hidden border border-[var(--border-subtle)]">
            <VisitMap
              latitude={visit.latitude!}
              longitude={visit.longitude!}
              label={visit.place}
              thumbnailKey={mapThumbnailKey}
              className="h-56 md:h-72 w-full"
            />
          </div>
        )}

        <VisitJournalReadOnly items={items} />

        <footer className="mt-10 pt-6 border-t border-[var(--border-subtle)] text-center">
          <p className="text-[11px] text-[var(--text-tertiary)]">Carnet de visite partagé — Moodboard</p>
        </footer>
      </div>
    </div>
  );
}
