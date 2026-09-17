import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { auth } from "@/auth";
import { resolveAccess, canView } from "@/lib/access/resolve";
import { MoodboardViewer } from "@/components/moodboard/MoodboardViewer";
import type { CanvasElement } from "@/lib/moodboard/types";

export const metadata = { robots: "noindex" };

interface Props { params: Promise<{ token: string }> }

export default async function SharePage({ params }: Props) {
  const { token } = await params;

  const moodboard = await db.moodboard.findUnique({
    where: { shareToken: token },
    select: {
      id: true,
      title: true,
      canvasData: true,
      background: true,
      shareToken: true,
      shareExpiry: true,
      allowComments: true,
      _count: { select: { comments: true } },
    },
  });

  if (!moodboard) notFound();

  // Lien expiré
  if (moodboard.shareExpiry && moodboard.shareExpiry < new Date()) notFound();

  // Un visiteur CONNECTÉ qui a par ailleurs accès à la planche commente sous
  // son identité de compte plutôt qu'en invité anonyme — c'est ce qui fait que
  // le propriétaire se reconnaît quand il vérifie le rendu de son propre lien.
  // La condition doit coller à celle du serveur (resolveCommentContext) : un
  // membre connecté SANS accès reste un invité, comme n'importe qui d'autre.
  const session = await auth();
  const access = session?.user?.id
    ? await resolveAccess("MOODBOARD", moodboard.id, session.user.id)
    : null;
  const viewer = canView(access)
    ? await db.user.findUnique({
        where: { id: session!.user!.id! },
        select: { id: true, name: true, username: true },
      })
    : null;

  // Le panneau est monté si les retours sont ouverts OU si la planche porte
  // déjà des commentaires (un fil reste lisible après refermeture).
  const commentsMounted = moodboard.allowComments || moodboard._count.comments > 0;

  return (
    <div className="min-h-screen bg-[var(--bg-base)]">
      <MoodboardViewer
        data={{
          id: moodboard.id,
          title: moodboard.title,
          canvasData: moodboard.canvasData as CanvasElement[],
          background: moodboard.background,
        }}
        comments={
          commentsMounted
            ? {
                shareToken: token,
                allowComments: moodboard.allowComments,
                viewerName: viewer ? viewer.name || (viewer.username ? `@${viewer.username}` : "Membre") : null,
                isOwner: access === "owner",
              }
            : undefined
        }
      />
    </div>
  );
}
