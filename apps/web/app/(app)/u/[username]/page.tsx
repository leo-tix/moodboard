import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/current";
import { db } from "@/lib/db";
import { relationStatus } from "@/lib/access/connections";
import { accessibleWhereForOwner } from "@/lib/access/resolve";
import { getImageUrl } from "@/lib/storage/urls";
import { UserAvatar } from "@/components/social/UserAvatar";
import { ConnectButton } from "@/components/social/ConnectButton";
import { MessageButton } from "@/components/social/MessageButton";

export const dynamic = "force-dynamic";

export default async function ProfilePage({ params }: { params: Promise<{ username: string }> }) {
  const me = await getCurrentUser();
  if (!me) redirect("/login");

  const { username } = await params;
  const user = await db.user.findUnique({
    where: { username: username.toLowerCase() },
    select: { id: true, name: true, username: true, bio: true, image: true },
  });
  if (!user) notFound();

  const rel = await relationStatus(me.id, user.id);
  const isSelf = rel.status === "self";

  const [boards, visits, collections] = await Promise.all([
    db.moodboard.findMany({ where: await accessibleWhereForOwner("MOODBOARD", me.id, user.id), select: { id: true, title: true, background: true }, orderBy: { order: "asc" }, take: 12 }),
    db.visit.findMany({ where: await accessibleWhereForOwner("VISIT", me.id, user.id), select: { id: true, place: true, exhibition: true, coverKey: true, visitDate: true }, orderBy: { visitDate: "desc" }, take: 12 }),
    db.collection.findMany({ where: await accessibleWhereForOwner("COLLECTION", me.id, user.id), select: { id: true, name: true, coverImageKey: true }, orderBy: { order: "asc" }, take: 12 }),
  ]);
  const nothing = boards.length === 0 && visits.length === 0 && collections.length === 0;

  const grid = "grid grid-cols-2 sm:grid-cols-3 gap-3";
  const card =
    "block rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] overflow-hidden hover:border-[var(--border-default)] transition-colors";

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="flex items-start gap-4">
        <UserAvatar name={user.name} username={user.username} image={user.image} size={80} />
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-medium text-[var(--text-primary)] truncate">{user.name || `@${user.username}`}</h1>
          {user.username && <p className="text-sm text-[var(--text-tertiary)]">@{user.username}</p>}
          {user.bio && <p className="text-sm text-[var(--text-secondary)] mt-2 whitespace-pre-wrap">{user.bio}</p>}
          <div className="mt-4">
            {isSelf ? (
              <Link href="/settings/account" className="inline-flex items-center px-3.5 py-2 rounded-lg text-sm border border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] transition-colors">
                Modifier mon profil
              </Link>
            ) : (
              <div className="flex items-center gap-2">
                <ConnectButton targetUserId={user.id} initialStatus={rel.status} connectionId={rel.connectionId} />
                <MessageButton targetUserId={user.id} />
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mt-10 space-y-8">
        {boards.length > 0 && (
          <section>
            <p className="text-[10px] uppercase tracking-widest text-[var(--text-tertiary)] mb-2">Planches</p>
            <div className={grid}>
              {boards.map((b) => (
                <Link key={b.id} href={`/moodboards/${b.id}`} className={card}>
                  <div className="aspect-[4/3]" style={{ background: b.background }} />
                  <p className="px-2.5 py-2 text-xs text-[var(--text-primary)] truncate">{b.title}</p>
                </Link>
              ))}
            </div>
          </section>
        )}
        {visits.length > 0 && (
          <section>
            <p className="text-[10px] uppercase tracking-widest text-[var(--text-tertiary)] mb-2">Visites</p>
            <div className={grid}>
              {visits.map((v) => {
                const inner = (
                  <>
                    <div className="aspect-[4/3] bg-[var(--bg-elevated)]">
                      {v.coverKey && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={getImageUrl(v.coverKey)} alt="" className="w-full h-full object-cover" />
                      )}
                    </div>
                    <p className="px-2.5 py-2 text-xs text-[var(--text-primary)] truncate">{v.exhibition || v.place}</p>
                  </>
                );
                // La visite d'un tiers n'est pas encore ouvrable (lecture partagée à venir).
                return isSelf ? (
                  <Link key={v.id} href={`/visites/${v.id}`} className={card}>{inner}</Link>
                ) : (
                  <div key={v.id} className={card}>{inner}</div>
                );
              })}
            </div>
          </section>
        )}
        {collections.length > 0 && (
          <section>
            <p className="text-[10px] uppercase tracking-widest text-[var(--text-tertiary)] mb-2">Collections</p>
            <div className={grid}>
              {collections.map((c) => {
                const inner = (
                  <>
                    <div className="aspect-[4/3] bg-[var(--bg-elevated)]">
                      {c.coverImageKey && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={getImageUrl(c.coverImageKey)} alt="" className="w-full h-full object-cover" />
                      )}
                    </div>
                    <p className="px-2.5 py-2 text-xs text-[var(--text-primary)] truncate">{c.name}</p>
                  </>
                );
                return isSelf ? (
                  <Link key={c.id} href={`/collections/${c.id}`} className={card}>{inner}</Link>
                ) : (
                  <div key={c.id} className={card}>{inner}</div>
                );
              })}
            </div>
          </section>
        )}
        {nothing && (
          <p className="text-sm text-[var(--text-tertiary)] border-t border-[var(--border-subtle)] pt-6">
            {isSelf ? "Tu n'as rien partagé pour l'instant." : "Rien de partagé avec toi pour l'instant."}
          </p>
        )}
      </div>
    </div>
  );
}
