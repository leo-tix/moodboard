import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/current";
import { VisitJournal, type JournalItem, type JournalBlock } from "@/components/visits/VisitJournal";
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
      titleBlocks: true,
      quoteBlocks: true,
      audioClips: true,
      columnBlocks: true,
    },
  });

  if (!visit) notFound();

  // Fusion des 6 tables de blocs dans une seule séquence de carnet façon
  // Notion (voir schema.prisma) : chaque bloc "réclamé" par une colonne
  // (référencé dans la pile left/right d'un VisitColumns) est retiré de la
  // séquence plate — il ne s'affiche qu'imbriqué dans son bloc colonnes.
  type BlockLookupKey = `${"image" | "note" | "title" | "quote" | "audio"}-${string}`;
  const blocks = new Map<BlockLookupKey, JournalBlock>();
  visit.inspirations.forEach((i) => {
    blocks.set(`image-${i.id}`, {
      type: "image",
      id: i.id,
      title: i.title,
      author: i.author,
      year: i.year,
      thumbnailKey: i.images[0]?.thumbnailKey ?? null,
      width: i.images[0]?.width ?? null,
      height: i.images[0]?.height ?? null,
    });
  });
  visit.noteBlocks.forEach((n) => blocks.set(`note-${n.id}`, { type: "note", id: n.id, content: n.content }));
  visit.titleBlocks.forEach((t) => blocks.set(`title-${t.id}`, { type: "title", id: t.id, content: t.content }));
  visit.quoteBlocks.forEach((q) => blocks.set(`quote-${q.id}`, { type: "quote", id: q.id, content: q.content }));
  visit.audioClips.forEach((a) =>
    blocks.set(`audio-${a.id}`, { type: "audio", id: a.id, storageKey: a.storageKey, durationSec: a.durationSec, transcript: a.transcript }),
  );

  const REF_TO_KEY: Record<string, "image" | "note" | "title" | "quote" | "audio"> = { IMAGE: "image", TEXT: "note", TITLE: "title", QUOTE: "quote", AUDIO: "audio" };
  // Chaque pile (left/right) est un tableau JSON [{type,id}, ...] — ordre
  // conservé, résolu en blocs purs via le lookup map ci-dessus (une entrée
  // orpheline, ex. bloc supprimé sans passer par l'API, est silencieusement
  // ignorée plutôt que de planter le rendu).
  const resolveStack = (stack: unknown): JournalBlock[] =>
    (Array.isArray(stack) ? stack : [])
      .map((ref) => {
        const r = ref as { type?: string; id?: string };
        return r?.type && r?.id ? blocks.get(`${REF_TO_KEY[r.type]}-${r.id}`) : undefined;
      })
      .filter((b): b is JournalBlock => Boolean(b));

  const claimed = new Set<BlockLookupKey>();
  visit.columnBlocks.forEach((c) => {
    resolveStack(c.left).forEach((b) => claimed.add(`${b.type}-${b.id}`));
    resolveStack(c.right).forEach((b) => claimed.add(`${b.type}-${b.id}`));
  });

  const merged: { item: JournalItem; order: number; createdAt: Date }[] = [];
  visit.inspirations.forEach((i) => {
    if (!claimed.has(`image-${i.id}`)) merged.push({ item: blocks.get(`image-${i.id}`)!, order: i.visitOrder, createdAt: i.createdAt });
  });
  visit.noteBlocks.forEach((n) => {
    if (!claimed.has(`note-${n.id}`)) merged.push({ item: blocks.get(`note-${n.id}`)!, order: n.order, createdAt: n.createdAt });
  });
  visit.titleBlocks.forEach((t) => {
    if (!claimed.has(`title-${t.id}`)) merged.push({ item: blocks.get(`title-${t.id}`)!, order: t.order, createdAt: t.createdAt });
  });
  visit.quoteBlocks.forEach((q) => {
    if (!claimed.has(`quote-${q.id}`)) merged.push({ item: blocks.get(`quote-${q.id}`)!, order: q.order, createdAt: q.createdAt });
  });
  visit.audioClips.forEach((a) => {
    if (!claimed.has(`audio-${a.id}`)) merged.push({ item: blocks.get(`audio-${a.id}`)!, order: a.order, createdAt: a.createdAt });
  });
  visit.columnBlocks.forEach((c) => {
    merged.push({
      item: { type: "columns", id: c.id, left: resolveStack(c.left), right: resolveStack(c.right) },
      order: c.order,
      createdAt: c.createdAt,
    });
  });

  // Tri : ordre explicite, puis createdAt pour départager (blocs ajoutés en
  // lot partagent le même order → ordre chrono naturel).
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
