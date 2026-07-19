import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/current";
import { db } from "@/lib/db";
import { relationStatus } from "@/lib/access/connections";
import { UserAvatar } from "@/components/social/UserAvatar";
import { ConnectButton } from "@/components/social/ConnectButton";

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

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="flex items-start gap-4">
        <UserAvatar name={user.name} username={user.username} image={user.image} size={80} />
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-medium text-[var(--text-primary)] truncate">
            {user.name || `@${user.username}`}
          </h1>
          {user.username && <p className="text-sm text-[var(--text-tertiary)]">@{user.username}</p>}
          {user.bio && <p className="text-sm text-[var(--text-secondary)] mt-2 whitespace-pre-wrap">{user.bio}</p>}
          <div className="mt-4">
            {isSelf ? (
              <Link
                href="/settings/account"
                className="inline-flex items-center px-3.5 py-2 rounded-lg text-sm border border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] transition-colors"
              >
                Modifier mon profil
              </Link>
            ) : (
              <ConnectButton targetUserId={user.id} initialStatus={rel.status} connectionId={rel.connectionId} />
            )}
          </div>
        </div>
      </div>

      {/* Ressources partagées — arrivent en Phase 2 (visibilité + ACL). */}
      <div className="mt-10 border-t border-[var(--border-subtle)] pt-6 text-sm text-[var(--text-tertiary)]">
        Les planches, visites et collections partagées apparaîtront ici.
      </div>
    </div>
  );
}
