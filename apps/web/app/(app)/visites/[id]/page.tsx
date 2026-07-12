import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/current";
import { VisitJournal, type JournalItem } from "@/components/visits/VisitJournal";
import { VisitMap } from "@/components/visits/VisitMap";
import { VisitCoverCarousel } from "@/components/visits/VisitCoverCarousel";
import { VisitHeaderEditable } from "@/components/visits/VisitHeaderEditable";

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

  const coverImages = [...visit.inspirations]
    .sort((a, b) => a.visitOrder - b.visitOrder || a.createdAt.getTime() - b.createdAt.getTime())
    .slice(0, 12)
    .map((i) => ({ id: i.id, storageKey: i.images[0]?.storageKey, width: i.images[0]?.width ?? null, height: i.images[0]?.height ?? null }))
    .filter((i): i is { id: string; storageKey: string; width: number | null; height: number | null } => Boolean(i.storageKey));

  const hasCover = coverImages.length > 0;

  return (
    <div className="p-4 md:p-6">
      <VisitCoverCarousel images={coverImages} backHref="/visites" />

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

        <div className="flex flex-col md:flex-row md:items-center gap-3 md:gap-4">
          <div className="flex-1 min-w-0">
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
          </div>

          {/* Mini-carte compacte (hauteur alignée sur le bloc texte pour
              éviter la zone morte relevée à l'audit) */}
          {hasMap && (
            <div className="w-full md:w-56 lg:w-64 flex-shrink-0 rounded-lg overflow-hidden border border-[var(--border-subtle)]">
              <VisitMap
                latitude={visit.latitude!}
                longitude={visit.longitude!}
                label={visit.place}
                className="h-28 w-full"
              />
            </div>
          )}
        </div>
      </header>

      <VisitJournal visitId={visit.id} initialItems={items} />
    </div>
  );
}
