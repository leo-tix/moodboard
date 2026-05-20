import { notFound } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { db } from "@/lib/db";
import { getImageUrl } from "@/lib/storage/urls";
import { Badge } from "@/components/ui/Badge";
import { InspirationEditForm } from "@/components/inspiration/InspirationEditForm";

export const revalidate = 0;

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  const inspiration = await db.inspiration.findUnique({
    where: { id },
    select: { title: true },
  });
  return { title: inspiration?.title ?? "Inspiration" };
}

export default async function InspirationDetailPage({ params }: Props) {
  const { id } = await params;

  const inspiration = await db.inspiration.findUnique({
    where: { id },
    include: {
      images: { orderBy: [{ isMain: "desc" }, { order: "asc" }] },
      category: true,
      subcategory: true,
      tags: { include: { tag: true } },
      colorPalette: { orderBy: { order: "asc" } },
      aiAnalysis: true,
    },
  });

  if (!inspiration) notFound();

  const mainImage = inspiration.images[0];
  const mainImageUrl = mainImage ? getImageUrl(mainImage.storageKey) : null;

  const metaFields = [
    { label: "Auteur", value: inspiration.author },
    { label: "Studio", value: inspiration.studio },
    { label: "Année", value: inspiration.year?.toString() },
    { label: "Pays", value: inspiration.country },
    { label: "Exposition", value: inspiration.exposition },
    { label: "Lieu", value: inspiration.location },
    { label: "Source", value: inspiration.source },
  ].filter((f) => f.value);

  return (
    <div className="min-h-screen">
      {/* Breadcrumb */}
      <div className="px-6 py-4 border-b border-[var(--border-subtle)]">
        <Link
          href="/library"
          className="text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors"
        >
          ← Bibliothèque
        </Link>
      </div>

      <div className="flex h-[calc(100vh-56px)]">
        {/* Image principale — côté gauche */}
        <div className="flex-1 bg-[var(--bg-surface)] flex items-center justify-center overflow-hidden">
          {mainImageUrl ? (
            <div className="relative w-full h-full">
              <Image
                src={mainImageUrl}
                alt={inspiration.title}
                fill
                className="object-contain"
                priority
                sizes="60vw"
              />
            </div>
          ) : (
            <div className="text-[var(--text-tertiary)] text-sm">Pas d'image</div>
          )}
        </div>

        {/* Panel métadonnées — côté droit */}
        <div className="w-80 flex-shrink-0 border-l border-[var(--border-subtle)] overflow-y-auto">
          <div className="p-6 space-y-6">
            {/* Titre + statut */}
            <div>
              <h1 className="text-lg font-medium text-[var(--text-primary)] leading-tight mb-2">
                {inspiration.title}
              </h1>
              {inspiration.category && (
                <Badge>{inspiration.category.name}</Badge>
              )}
            </div>

            {/* Description */}
            {inspiration.description && (
              <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
                {inspiration.description}
              </p>
            )}

            {/* Métadonnées */}
            {metaFields.length > 0 && (
              <div className="space-y-2">
                {metaFields.map((f) => (
                  <div key={f.label} className="flex gap-3">
                    <span className="text-xs text-[var(--text-tertiary)] w-20 flex-shrink-0 pt-0.5">
                      {f.label}
                    </span>
                    <span className="text-xs text-[var(--text-secondary)]">{f.value}</span>
                  </div>
                ))}
              </div>
            )}

            {/* URL source */}
            {inspiration.sourceUrl && (
              <a
                href={inspiration.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors underline underline-offset-4 block truncate"
              >
                {inspiration.sourceUrl}
              </a>
            )}

            {/* Palette couleurs */}
            {inspiration.colorPalette.length > 0 && (
              <div>
                <p className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-widest mb-2">
                  Palette
                </p>
                <div className="flex gap-1.5">
                  {inspiration.colorPalette.slice(0, 6).map((c) => (
                    <div
                      key={c.id}
                      title={c.hex}
                      className="w-8 h-8 rounded-sm flex-shrink-0 cursor-help"
                      style={{ backgroundColor: c.hex }}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Tags */}
            {inspiration.tags.length > 0 && (
              <div>
                <p className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-widest mb-2">
                  Tags
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {inspiration.tags.map(({ tag }) => (
                    <Badge
                      key={tag.id}
                      variant={tag.source === "AI" ? "ai" : "default"}
                    >
                      {tag.name}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Notes personnelles */}
            {inspiration.notes && (
              <div>
                <p className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-widest mb-2">
                  Notes
                </p>
                <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                  {inspiration.notes}
                </p>
              </div>
            )}

            {/* Analyse IA */}
            {inspiration.aiAnalysis && (
              <div>
                <p className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-widest mb-2">
                  Analyse IA
                </p>
                {inspiration.aiAnalysis.moodDescriptor && (
                  <p className="text-xs text-[var(--text-secondary)] italic mb-2">
                    "{inspiration.aiAnalysis.moodDescriptor}"
                  </p>
                )}
                {inspiration.aiAnalysis.styleKeywords.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {inspiration.aiAnalysis.styleKeywords.map((kw) => (
                      <Badge key={kw} variant="ai">{kw}</Badge>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Formulaire édition inline */}
            <InspirationEditForm
              id={inspiration.id}
              initialData={{
                title: inspiration.title,
                description: inspiration.description ?? "",
                author: inspiration.author ?? "",
                studio: inspiration.studio ?? "",
                year: inspiration.year ?? undefined,
                country: inspiration.country ?? "",
                notes: inspiration.notes ?? "",
                sourceUrl: inspiration.sourceUrl ?? "",
                categoryId: inspiration.categoryId ?? "",
                subcategoryId: inspiration.subcategoryId ?? "",
                tags: inspiration.tags.map((t) => t.tag.name),
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
