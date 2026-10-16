import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { canEditResource } from "@/lib/access/resolve";
import { buildBentoLayout } from "@/lib/visits/journalItems";

interface Params { params: Promise<{ id: string }> }

// GET /api/visits/[id]/tiles — grille bento résolue (même construction que
// la page serveur, apps/web/app/(app)/visites/[id]/page.tsx), via un `fetch`
// client ordinaire — donc JAMAIS soumis au cache du routeur Next.js,
// contrairement à router.refresh() qui peut rejouer un payload RSC mis en
// cache jusqu'à staleTimes.dynamic (30s, next.config.ts). Utilisé par
// VisitJournal pour une resynchronisation fiable après upload depuis le FAB
// de capture — retour utilisateur 2026-10-16 : "vidéo convertie et
// uploadée mais pas apparue dans la visite".
export async function GET(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id } = await params;
  if (!(await canEditResource("VISIT", id, session.user.id))) {
    return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  }

  const visit = await db.visit.findUnique({
    where: { id },
    include: {
      inspirations: {
        where: { status: "READY" },
        select: {
          id: true,
          title: true,
          author: true,
          year: true,
          visitOrder: true,
          createdAt: true,
          images: {
            select: { storageKey: true, thumbnailKey: true, width: true, height: true },
            orderBy: [{ isMain: "desc" }, { order: "asc" }],
            take: 1,
          },
        },
      },
      noteBlocks: true,
      audioClips: true,
      embeds: true,
      mapBlocks: true,
      cartels: true,
      palettes: true,
      tickets: true,
      sketches: true,
      highlights: true,
      checklists: true,
      timelines: true,
    },
  });
  if (!visit) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  return NextResponse.json({ tiles: buildBentoLayout(visit) });
}
