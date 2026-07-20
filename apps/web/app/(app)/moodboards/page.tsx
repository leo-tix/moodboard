import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/current";
import { MoodboardGrid } from "@/components/moodboard/MoodboardGrid";
import { accessibleWhere } from "@/lib/access/resolve";
import { LibraryTabs } from "@/components/social/LibraryTabs";
import { SharedResourceGrid, type SharedItem } from "@/components/social/SharedResourceGrid";

export const dynamic = "force-dynamic";

export default async function MoodboardsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const shared = (await searchParams).tab === "shared";
  const sharedWhere = { AND: [{ userId: { not: user.id } }, await accessibleWhere("MOODBOARD", user.id)] };
  const sharedCount = await db.moodboard.count({ where: sharedWhere });

  if (shared) {
    const rows = await db.moodboard.findMany({ where: sharedWhere, select: { id: true, title: true, background: true, previewKey: true, user: { select: { name: true, username: true, image: true } } }, orderBy: { updatedAt: "desc" }, take: 60 });
    const items: SharedItem[] = rows.map((m) => ({ id: m.id, href: `/moodboards/${m.id}/edit`, title: m.title, cover: null, board: { previewKey: m.previewKey, background: m.background }, owner: m.user }));
    return (
      <div className="p-6">
        <LibraryTabs base="/moodboards" active="shared" mineLabel="Mes planches" sharedCount={sharedCount} />
        <SharedResourceGrid items={items} emptyLabel="Aucune planche partagée avec toi pour l'instant." />
      </div>
    );
  }

  const [moodboards, folders] = await Promise.all([
    db.moodboard.findMany({
      where: { userId: user.id },
      orderBy: [{ order: "asc" }, { updatedAt: "desc" }],
      select: {
        id: true,
        title: true,
        background: true,
        previewKey: true,
        shareToken: true,
        shareExpiry: true,
        order: true,
        folderId: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    db.moodboardFolder.findMany({ where: { userId: user.id }, orderBy: { order: "asc" } }),
  ]);

  // La grille affiche l'aperçu précalculé (previewKey) → on ne lit plus
  // canvasData (economie d'egress). `canvasData: []` satisfait le type partagé.
  const serialized = moodboards.map((m) => ({
    ...m,
    canvasData: [],
    shareExpiry: m.shareExpiry?.toISOString() ?? null,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  }));

  return (
    <div className="p-6">
      <LibraryTabs base="/moodboards" active="mine" mineLabel="Mes planches" sharedCount={sharedCount} />
      <MoodboardGrid initialMoodboards={serialized} initialFolders={folders} />
    </div>
  );
}
