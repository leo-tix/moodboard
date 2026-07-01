import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { MoodboardEditor } from "@/components/moodboard/MoodboardEditor";
import type { CanvasElement, Stroke, StrokeElement } from "@/lib/moodboard/types";
import { strokeToElement } from "@/lib/moodboard/pencil";

interface Props { params: Promise<{ id: string }> }

export default async function MoodboardEditPage({ params }: Props) {
  const { id } = await params;

  const moodboard = await db.moodboard.findUnique({ where: { id } });
  if (!moodboard) notFound();

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

  return (
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
  );
}
