import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/current";
import { db } from "@/lib/db";
import { accessibleWhere } from "@/lib/access/resolve";
import { getImageUrl } from "@/lib/storage/urls";
import { UserAvatar } from "@/components/social/UserAvatar";

export const dynamic = "force-dynamic";

type Owner = { name: string | null; username: string | null; image: string | null };
type Item = { kind: "board" | "visit" | "collection"; id: string; title: string; cover: string | null; owner: Owner; createdAt: Date };

export default async function FeedPage() {
  const me = await getCurrentUser();
  if (!me) redirect("/login");

  const ownerSel = { select: { name: true, username: true, image: true } };
  const [boards, visits, collections] = await Promise.all([
    db.moodboard.findMany({ where: { AND: [{ userId: { not: me.id } }, await accessibleWhere("MOODBOARD", me.id)] }, select: { id: true, title: true, background: true, createdAt: true, user: ownerSel }, orderBy: { createdAt: "desc" }, take: 20 }),
    db.visit.findMany({ where: { AND: [{ userId: { not: me.id } }, await accessibleWhere("VISIT", me.id)] }, select: { id: true, place: true, exhibition: true, coverKey: true, createdAt: true, user: ownerSel }, orderBy: { createdAt: "desc" }, take: 20 }),
    db.collection.findMany({ where: { AND: [{ userId: { not: me.id } }, await accessibleWhere("COLLECTION", me.id)] }, select: { id: true, name: true, coverImageKey: true, createdAt: true, user: ownerSel }, orderBy: { createdAt: "desc" }, take: 20 }),
  ]);

  const items: Item[] = [
    ...boards.map((b) => ({ kind: "board" as const, id: b.id, title: b.title, cover: null, owner: b.user, createdAt: b.createdAt })),
    ...visits.map((v) => ({ kind: "visit" as const, id: v.id, title: v.exhibition || v.place, cover: v.coverKey ? getImageUrl(v.coverKey) : null, owner: v.user, createdAt: v.createdAt })),
    ...collections.map((c) => ({ kind: "collection" as const, id: c.id, title: c.name, cover: c.coverImageKey ? getImageUrl(c.coverImageKey) : null, owner: c.user, createdAt: c.createdAt })),
  ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 30);

  const KIND_LABEL = { board: "Planche", visit: "Visite", collection: "Collection" };
  const fmt = (d: Date) => d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto">
      <h1 className="text-sm font-medium text-[var(--text-primary)] mb-4">Fil d&apos;actualité</h1>
      {items.length === 0 ? (
        <p className="text-sm text-[var(--text-tertiary)] py-8 text-center">
          Rien à afficher pour l&apos;instant. Connecte-toi à des membres et ce qu&apos;ils partagent apparaîtra ici.
        </p>
      ) : (
        <div className="space-y-3">
          {items.map((it) => {
            const inner = (
              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] overflow-hidden">
                {it.cover && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={it.cover} alt="" className="w-full aspect-[16/9] object-cover" />
                )}
                {it.kind === "board" && !it.cover && <div className="w-full aspect-[16/9]" style={{ background: "var(--bg-elevated)" }} />}
                <div className="p-3 flex items-center gap-2.5">
                  <UserAvatar name={it.owner.name} username={it.owner.username} image={it.owner.image} size={30} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-[var(--text-primary)] truncate">{it.title}</p>
                    <p className="text-[11px] text-[var(--text-tertiary)] truncate">
                      {KIND_LABEL[it.kind]} · {it.owner.name || `@${it.owner.username}`} · {fmt(it.createdAt)}
                    </p>
                  </div>
                </div>
              </div>
            );
            const href = it.kind === "board" ? `/moodboards/${it.id}/edit` : it.kind === "visit" ? `/visites/${it.id}` : `/collections/${it.id}`;
            return <Link key={`${it.kind}-${it.id}`} href={href} className="block hover:opacity-90 transition-opacity">{inner}</Link>;
          })}
        </div>
      )}
    </div>
  );
}
