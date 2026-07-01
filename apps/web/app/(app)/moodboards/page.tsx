import { db } from "@/lib/db";
import { MoodboardGrid } from "@/components/moodboard/MoodboardGrid";
import { capCanvasForPreview } from "@/lib/moodboard/preview";
import type { CanvasElement } from "@/lib/moodboard/types";

export default async function MoodboardsPage() {
  const [moodboards, folders] = await Promise.all([
    db.moodboard.findMany({
      orderBy: [{ order: "asc" }, { updatedAt: "desc" }],
      select: {
        id: true,
        title: true,
        background: true,
        canvasData: true,
        shareToken: true,
        shareExpiry: true,
        order: true,
        folderId: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    db.moodboardFolder.findMany({ orderBy: { order: "asc" } }),
  ]);

  const serialized = moodboards.map((m) => {
    const canvasData = m.canvasData as CanvasElement[];
    const imageCount = canvasData.filter((el) => el.type === "image").length;
    return {
      ...m,
      canvasData: capCanvasForPreview(canvasData),
      imageCount,
      shareExpiry: m.shareExpiry?.toISOString() ?? null,
      createdAt: m.createdAt.toISOString(),
      updatedAt: m.updatedAt.toISOString(),
    };
  });

  return (
    <div className="p-6">
      <MoodboardGrid initialMoodboards={serialized} initialFolders={folders} />
    </div>
  );
}
