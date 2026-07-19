import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/current";
import { resolveAccess } from "@/lib/access/resolve";
import { MoodboardEditor } from "@/components/moodboard/MoodboardEditor";
import { MoodboardViewer } from "@/components/moodboard/MoodboardViewer";
import { ShareButton } from "@/components/social/ShareButton";
import type { CanvasElement, Stroke, StrokeElement } from "@/lib/moodboard/types";
import { strokeToElement } from "@/lib/moodboard/pencil";

interface Props { params: Promise<{ id: string }> }

export default async function MoodboardEditPage({ params }: Props) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // Accès partagé : le propriétaire et les éditeurs éditent ; un lecteur autorisé
  // (public / connexions / grant Lecteur) voit la planche en lecture seule.
  const moodboard = await db.moodboard.findUnique({ where: { id } });
  if (!moodboard) notFound();
  const access = await resolveAccess("MOODBOARD", id, user.id);
  if (!access) notFound();

  // ── Legacy migration: pencilStrokes → StrokeElement[] ─────────────────────
  // Boards created before the StrokeElement refactor store strokes in a separate
  // `pencilStrokes` DB field.  Convert them to first-class canvas elements and
  // merge into canvasData so the editor handles them identically to new strokes.
  const canvasData = moodboard.canvasData as CanvasElement[];
  const legacyStrokes = (moodboard.pencilStrokes as unknown as Stroke[] | null) ?? [];

  const hasLegacyStrokes =
    legacyStrokes.length > 0 &&
    !canvasData.some((el) => el.type === "stroke");

  let mergedCanvasData: CanvasElement[] = canvasData;
  if (hasLegacyStrokes) {
    const maxZ = canvasData.reduce((m, el) => Math.max(m, el.zIndex), 100);
    const strokeEls: StrokeElement[] = legacyStrokes.map((s, i) =>
      strokeToElement(s, maxZ + i + 1)
    );
    mergedCanvasData = [...canvasData, ...strokeEls];
  }

  // Lecteur → visionneuse (pas d'édition).
  if (access === "viewer") {
    return (
      <div className="min-h-screen bg-[var(--bg-base)]">
        <MoodboardViewer data={{ id: moodboard.id, title: moodboard.title, canvasData: mergedCanvasData, background: moodboard.background }} />
      </div>
    );
  }

  return (
    <>
      {/* Partage membre (visibilité + éditeurs) — le propriétaire seul le voit. */}
      {access === "owner" && (
        <div className="fixed top-2.5 right-2.5 z-[70]">
          <ShareButton resource="moodboards" id={moodboard.id} allowEditor />
        </div>
      )}
      <MoodboardEditor
        initialData={{
          id: moodboard.id,
          title: moodboard.title,
          canvasData: mergedCanvasData,
          background: moodboard.background,
          shareToken: moodboard.shareToken,
          shareExpiry: moodboard.shareExpiry?.toISOString() ?? null,
          order: moodboard.order,
          folderId: moodboard.folderId,
          createdAt: moodboard.createdAt.toISOString(),
          updatedAt: moodboard.updatedAt.toISOString(),
        }}
      />
    </>
  );
}
