import { notFound } from "next/navigation";
import { db } from "@/lib/db";
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
    },
  });

  if (!moodboard) notFound();

  // Lien expiré
  if (moodboard.shareExpiry && moodboard.shareExpiry < new Date()) notFound();

  return (
    <div className="min-h-screen bg-[var(--bg-base)]">
      <MoodboardViewer
        data={{
          id: moodboard.id,
          title: moodboard.title,
          canvasData: moodboard.canvasData as CanvasElement[],
          background: moodboard.background,
        }}
      />
    </div>
  );
}
