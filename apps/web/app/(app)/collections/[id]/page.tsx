import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/current";
import { CollectionDetailClient } from "@/components/collections/CollectionDetailClient";
import { getSuggestedAdditions } from "@/lib/collections/suggestions";
import { ShareButton } from "@/components/social/ShareButton";
import { resolveAccess } from "@/lib/access/resolve";
import { getThumbnailUrl, getImageUrl } from "@/lib/storage/urls";

interface Props { params: Promise<{ id: string }> }

export const revalidate = 0;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const user = await getCurrentUser();
  const col = user
    ? await db.collection.findFirst({ where: { id, userId: user.id }, select: { name: true } })
    : null;
  return { title: col?.name ?? "Collection" };
}

export default async function CollectionDetailPage({ params }: Props) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // Accès partagé : un tiers autorisé voit la collection en LECTURE SEULE (grille
  // de vignettes). L'édition reste au propriétaire. Aucun accès → 404.
  const access = await resolveAccess("COLLECTION", id, user.id);
  if (!access) notFound();
  if (access !== "owner") {
    const col = await db.collection.findUnique({
      where: { id },
      include: {
        user: { select: { name: true, username: true } },
        items: {
          orderBy: { order: "asc" },
          include: { inspiration: { include: { images: { orderBy: [{ isMain: "desc" }, { order: "asc" }], take: 1, select: { thumbnailKey: true, storageKey: true } } } } },
        },
      },
    });
    if (!col) notFound();
    return (
      <div className="p-4 md:p-6 max-w-4xl mx-auto">
        <div className="mb-1"><Link href="/feed" className="text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]">← Retour</Link></div>
        <h1 className="text-lg font-medium text-[var(--text-primary)]">{col.name}</h1>
        <p className="text-xs text-[var(--text-tertiary)] mb-5">Collection de {col.user.name || `@${col.user.username}`} · {col.items.length} image{col.items.length !== 1 ? "s" : ""}</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {col.items.map((it) => {
            const img = it.inspiration.images[0];
            const url = img ? (img.thumbnailKey ? getThumbnailUrl(img.thumbnailKey) : getImageUrl(img.storageKey)) : null;
            return (
              <div key={it.inspirationId} className="aspect-square rounded-lg overflow-hidden bg-[var(--bg-elevated)] border border-[var(--border-subtle)]">
                {url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={url} alt={it.inspiration.title} className="w-full h-full object-cover" />
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  const [collection, suggestions] = await Promise.all([
    db.collection.findFirst({
      where: { id, userId: user.id },
      include: {
        items: {
          include: {
            inspiration: {
              include: {
                images: {
                  orderBy: [{ isMain: "desc" }, { order: "asc" }],
                  take: 1,
                  select: { thumbnailKey: true, blurHash: true, width: true, height: true, isMain: true },
                },
                categories: { include: { category: { select: { name: true } } }, take: 3 },
                tags: { include: { tag: { select: { name: true } } }, take: 5 },
              },
            },
          },
          orderBy: { order: "asc" },
        },
        _count: { select: { items: true } },
      },
    }),
    getSuggestedAdditions(id, user.id),
  ]);

  if (!collection) notFound();

  return (
    <div className="p-4 md:p-6">
      <div className="flex items-center gap-2 mb-6">
        <Link
          href="/collections"
          className="text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors"
        >
          ← Collections
        </Link>
        <span className="text-[var(--border-default)] text-xs">/</span>
        <span className="text-xs text-[var(--text-tertiary)]">
          {collection._count.items} image{collection._count.items !== 1 ? "s" : ""}
        </span>
        <div className="ml-auto">
          <ShareButton resource="collections" id={collection.id} />
        </div>
      </div>

      <CollectionDetailClient
        collectionId={collection.id}
        initialName={collection.name}
        initialDescription={collection.description}
        initialItems={collection.items}
        suggestions={suggestions}
      />
    </div>
  );
}
