import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/current";
import { VisitJournal, type JournalItem } from "@/components/visits/VisitJournal";
import { VisitMap } from "@/components/visits/VisitMap";
import { VisitCoverCarousel } from "@/components/visits/VisitCoverCarousel";
import { VisitHeaderEditable } from "@/components/visits/VisitHeaderEditable";
import { VisitCaptureFab } from "@/components/visits/VisitCaptureFab";

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
      inspirations: {
        where: { status: "READY", isArchived: false },
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
    },
  });

  if (!visit) notFound();

  // Fusion images + notes dans une seule séquence de carnet.
  // Tri : ordre explicite, puis createdAt pour départager (images ajoutées
  // en lot partagent le même visitOrder → ordre chrono naturel).
  const merged: { item: JournalItem; order: number; createdAt: Date }[] = [
    ...visit.inspirations.map((i) => ({
      item: {
        type: "image" as const,
        id: i.id,
        title: i.title,
        author: i.author,
        year: i.year,
        thumbnailKey: i.images[0]?.thumbnailKey ?? null,
        width: i.images[0]?.width ?? null,
        height: i.images[0]?.height ?? null,
      },
      order: i.visitOrder,
      createdAt: i.createdAt,
    })),
    ...visit.noteBlocks.map((n) => ({
      item: { type: "note" as const, id: n.id, content: n.content },
      order: n.order,
      createdAt: n.createdAt,
    })),
  ];
  merged.sort((a, b) => a.order - b.order || a.createdAt.getTime() - b.createdAt.getTime());
  const items = merged.map((m) => m.item);

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
  const coverTitle = visit.exhibition || visit.place;

  return (
    <div className="p-4 md:p-6">
      <VisitCoverCarousel images={coverImages} title={coverTitle} backHref="/visites" />

      <header className="mb-5">
        {/* Sans cover (visite sans image), le retour flottant n'existe pas —
            on garde le lien texte classique. */}
        {!hasCover && (
          <Link
            href="/visites"
            className="inline-block mb-2 text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors"
          >
            ← Carnet de visite
          </Link>
        )}

        <VisitHeaderEditable
          visitId={visit.id}
          place={visit.place}
          exhibition={visit.exhibition}
          visitDate={visit.visitDate.toISOString()}
          imageCount={visit.inspirations.length}
        />
        {visit.address && (
          <p className="text-xs text-[var(--text-tertiary)] mt-1">{visit.address}</p>
        )}
        {visit.notes && (
          <p className="text-xs text-[var(--text-tertiary)] mt-2 max-w-xl whitespace-pre-wrap">
            {visit.notes}
          </p>
        )}
      </header>

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

      <VisitJournal visitId={visit.id} initialItems={items} />

      {/* Capture friction zéro : tap = photo native, appui long = mémo vocal */}
      <VisitCaptureFab visitId={visit.id} />
    </div>
  );
}
