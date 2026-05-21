import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { MoodboardEditor } from "@/components/moodboard/MoodboardEditor";
import type { CanvasElement } from "@/lib/moodboard/types";

interface Props { params: Promise<{ id: string }> }

export default async function MoodboardEditPage({ params }: Props) {
  const { id } = await params;

  const moodboard = await db.moodboard.findUnique({ where: { id } });
  if (!moodboard) notFound();

  return (
    <MoodboardEditor
      initialData={{
        id: moodboard.id,
        title: moodboard.title,
        canvasData: moodboard.canvasData as CanvasElement[],
        background: moodboard.background,
        shareToken: moodboard.shareToken,
        shareExpiry: moodboard.shareExpiry?.toISOString() ?? null,
        createdAt: moodboard.createdAt.toISOString(),
        updatedAt: moodboard.updatedAt.toISOString(),
      }}
    />
  );
}
