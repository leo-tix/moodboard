import { buildBentoLayout } from "@/lib/visits/journalItems";
import { VisitJournalReadOnly } from "@/components/visits/VisitJournalReadOnly";
import { VisitCoverCarousel } from "@/components/visits/VisitCoverCarousel";
import { VisitMap } from "@/components/visits/VisitMap";
import { getImageUrl } from "@/lib/storage/urls";

// Rendu LECTURE SEULE d'une visite (cover + carte + carnet bento), partagé entre
// la page publique /carnet/[token] et l'accès membre (visite partagée). `visit`
// doit inclure les mêmes relations que buildBentoLayout attend (voir carnet page).
type VisitData = Parameters<typeof buildBentoLayout>[0] & {
  place: string;
  exhibition: string | null;
  visitDate: Date;
  notes: string | null;
  latitude: number | null;
  longitude: number | null;
  coverKey: string | null;
  user: { name: string | null; image: string | null };
  inspirations: { id: string; visitOrder: number; createdAt: Date; images: { storageKey: string; thumbnailKey: string | null; width: number | null; height: number | null }[] }[];
};

export function VisitReadOnlyView({ visit, showAuthor = true }: { visit: VisitData; showAuthor?: boolean }) {
  const tiles = buildBentoLayout(visit);
  const hasMap = visit.latitude !== null && visit.longitude !== null;

  const orderedInspirations = [...visit.inspirations].sort(
    (a, b) => a.visitOrder - b.visitOrder || a.createdAt.getTime() - b.createdAt.getTime(),
  );
  const carouselImages = orderedInspirations
    .slice(0, 12)
    .map((i) => ({ id: i.id, storageKey: i.images[0]?.storageKey, width: i.images[0]?.width ?? null, height: i.images[0]?.height ?? null }))
    .filter((i): i is { id: string; storageKey: string; width: number | null; height: number | null } => Boolean(i.storageKey));
  const coverImages = visit.coverKey
    ? [{ id: "custom-cover", storageKey: visit.coverKey, width: null as number | null, height: null as number | null }]
    : carouselImages;
  const mapThumbnailKey = orderedInspirations[0]?.images[0]?.thumbnailKey ?? null;

  const hasCover = coverImages.length > 0;
  const coverTitle = visit.exhibition || visit.place;
  const date = new Date(visit.visitDate).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });

  const author = visit.user;
  const authorAvatar = author.image ? (/^https?:\/\//.test(author.image) ? author.image : getImageUrl(author.image)) : null;
  const authorInitials = (author.name ?? "").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-6">
      {hasCover ? (
        <VisitCoverCarousel images={coverImages}>
          <div className="drop-shadow-[0_2px_12px_rgba(0,0,0,0.6)]">
            <h1 className="font-serif text-white text-3xl md:text-4xl font-semibold leading-tight">{coverTitle}</h1>
            <p className="text-sm text-white/85 mt-1">{visit.exhibition ? `${visit.place} · ${date}` : date}</p>
          </div>
        </VisitCoverCarousel>
      ) : (
        <header className="mb-5 mt-4">
          <h1 className="font-serif text-2xl md:text-3xl font-semibold text-[var(--text-primary)] leading-tight">{coverTitle}</h1>
          {visit.exhibition && <p className="text-sm text-[var(--text-secondary)] mt-1">{visit.place}</p>}
          <p className="text-xs text-[var(--text-tertiary)] mt-1">{date}</p>
        </header>
      )}

      {showAuthor && author.name && (
        <div className="flex items-center gap-3 mt-5 mb-6">
          <div className="w-9 h-9 rounded-full overflow-hidden bg-[var(--bg-surface)] ring-1 ring-[var(--border-subtle)] flex items-center justify-center shrink-0">
            {authorAvatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={authorAvatar} alt="" className="w-full h-full object-cover" />
            ) : (
              <span className="text-[12px] font-medium text-[var(--text-secondary)]">{authorInitials}</span>
            )}
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-medium text-[var(--text-primary)] leading-tight truncate">{author.name}</p>
            <p className="text-[11px] text-[var(--text-tertiary)]">Carnet de visite partagé</p>
          </div>
        </div>
      )}

      {visit.notes && <p className="text-xs text-[var(--text-tertiary)] mb-5 max-w-xl whitespace-pre-wrap">{visit.notes}</p>}

      {hasMap && (
        <div className="mb-6 rounded-xl overflow-hidden border border-[var(--border-subtle)]">
          <VisitMap latitude={visit.latitude!} longitude={visit.longitude!} label={visit.place} thumbnailKey={mapThumbnailKey} zoom={5} countryOutline className="h-64 md:h-80 w-full" />
        </div>
      )}

      <VisitJournalReadOnly tiles={tiles} authorName={visit.user.name} authorImage={visit.user.image} />
    </div>
  );
}
