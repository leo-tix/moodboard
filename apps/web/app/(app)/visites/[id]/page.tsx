import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/current";
import { VisitJournal } from "@/components/visits/VisitJournal";
import { VisitMap } from "@/components/visits/VisitMap";
import { VisitCoverCarousel } from "@/components/visits/VisitCoverCarousel";
import { VisitHeaderEditable } from "@/components/visits/VisitHeaderEditable";
import { VisitCaptureFab } from "@/components/visits/VisitCaptureFab";
import { OutboxIndicator } from "@/components/visits/OutboxIndicator";
import { VisitShareButton } from "@/components/visits/VisitShareButton";
import { VisitTopBar } from "@/components/visits/VisitTopBar";
import { buildBentoLayout } from "@/lib/visits/journalItems";

export const revalidate = 0;

interface Props { params: Promise<{ id: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const user = await getCurrentUser();
  const visit = user
    ? await db.visit.findFirst({ where: { id, userId: user.id }, select: { place: true } })
    : null;
  return { title: visit ? `Visite — ${visit.place}` : "Visite" };
}

export default async function VisiteDetailPage({ params }: Props) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const visit = await db.visit.findFirst({
    where: { id, userId: user.id },
    include: {
      user: { select: { name: true, image: true } },
      inspirations: {
        // Une image archivée (masquée de la bibliothèque via le triage) reste
        // visible dans le carnet — l'archivage est une action "bibliothèque
        // de travail", pas un détachement de la visite.
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
      audioClips: true,
      embeds: true,
      mapBlocks: true,
    },
  });

  if (!visit) notFound();

  // Résout Visit.journalLayout vers son contenu réel — grille bento
  // (logique partagée avec la page publique, voir lib/visits/journalItems.ts).
  const tiles = buildBentoLayout(visit);

  const hasMap = visit.latitude !== null && visit.longitude !== null;

  const orderedInspirations = [...visit.inspirations].sort(
    (a, b) => a.visitOrder - b.visitOrder || a.createdAt.getTime() - b.createdAt.getTime()
  );
  const coverImages = orderedInspirations
    .slice(0, 12)
    .map((i) => ({ id: i.id, storageKey: i.images[0]?.storageKey, width: i.images[0]?.width ?? null, height: i.images[0]?.height ?? null }))
    .filter((i): i is { id: string; storageKey: string; width: number | null; height: number | null } => Boolean(i.storageKey));
  // Même première image que la couverture, mais en vignette pour le pin de carte.
  const mapThumbnailKey = orderedInspirations[0]?.images[0]?.thumbnailKey ?? null;

  const hasCover = coverImages.length > 0;
  const shareButton = (
    <VisitShareButton
      visitId={visit.id}
      shareToken={visit.shareToken}
      shareExpiry={visit.shareExpiry ? visit.shareExpiry.toISOString() : null}
    />
  );
  const editableHeader = (
    <VisitHeaderEditable
      visitId={visit.id}
      place={visit.place}
      exhibition={visit.exhibition}
      visitDate={visit.visitDate.toISOString()}
      imageCount={visit.inspirations.length}
      variant={hasCover ? "cover" : "default"}
    />
  );

  return (
    // Largeur limitée + centrée, à l'image du carnet public (carnet/[token]) —
    // demande utilisateur 2026-07-14 : "ce sera + classe" + réduit
    // naturellement le nombre de colonnes d'images visibles. Élargie ensuite
    // à max-w-4xl (retour "rendre un petit peu plus large l'ensemble").
    <div className="max-w-4xl mx-auto p-4 md:p-6">
      {/* Retour + Partager ancrés en haut (sticky) : accessibles pendant tout
          le défilement du carnet (demande utilisateur 2026-07-14). */}
      <VisitTopBar backHref="/visites">{shareButton}</VisitTopBar>

      {/* Cover premium : le titre/lieu/date (éditables) superposés SUR la
          couverture — plus de bloc d'infos dupliqué en dessous. Détachée +
          arrondie + halo lumineux : tout le style vit désormais dans les
          classes par défaut de VisitCoverCarousel (partagées avec la page
          publique), plus besoin d'override ici. */}
      {hasCover ? (
        <VisitCoverCarousel images={coverImages}>
          {editableHeader}
        </VisitCoverCarousel>
      ) : (
        <header className="mb-5">{editableHeader}</header>
      )}

      {(visit.address || visit.notes) && (
        <div className="mb-5">
          {visit.address && (
            <p className="text-xs text-[var(--text-tertiary)]">{visit.address}</p>
          )}
          {visit.notes && (
            <p className="text-xs text-[var(--text-tertiary)] mt-2 max-w-xl whitespace-pre-wrap">
              {visit.notes}
            </p>
          )}
        </div>
      )}

      {/* Carte pleine largeur juste après le titre/lieu — pin avec vignette
          mise en avant (même style que la carte cumulée), "carte premium". */}
      {hasMap && (
        <div className="mb-6 rounded-xl overflow-hidden border border-[var(--border-subtle)]">
          <VisitMap
            latitude={visit.latitude!}
            longitude={visit.longitude!}
            label={visit.place}
            thumbnailKey={mapThumbnailKey}
            className="h-64 md:h-80 w-full"
          />
        </div>
      )}

      <VisitJournal visitId={visit.id} initialTiles={tiles} authorName={visit.user.name} authorImage={visit.user.image} />

      {/* Capture friction zéro : tap = photo native, appui long = mémo vocal */}
      <VisitCaptureFab visitId={visit.id} />
      {/* File hors ligne (Phase 4) : captures en attente de synchronisation */}
      <OutboxIndicator visitId={visit.id} />
    </div>
  );
}
