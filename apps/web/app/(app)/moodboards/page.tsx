import { db } from "@/lib/db";
import { MoodboardGrid } from "@/components/moodboard/MoodboardGrid";
import type { CanvasElement } from "@/lib/moodboard/types";

export default async function MoodboardsPage() {
  const moodboards = await db.moodboard.findMany({
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      title: true,
      background: true,
      canvasData: true,
      shareToken: true,
      shareExpiry: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  const serialized = moodboards.map((m) => ({
    ...m,
    canvasData: m.canvasData as CanvasElement[],
    pencilStrokes: [] as import("@/lib/moodboard/types").Stroke[],
    shareExpiry: m.shareExpiry?.toISOString() ?? null,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  }));

  return (
    <div className="p-6">
      <MoodboardGrid initialMoodboards={serialized} />
    </div>
  );
}
