import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthUserId } from "@/lib/auth/withToken";
import { randomUUID } from "crypto";
import type { CanvasElement, ImageElement } from "@/lib/moodboard/types";
import { regenerateMoodboardPreview } from "@/lib/moodboard/savePreview";

interface Params { params: Promise<{ id: string }> }

// POST /api/moodboards/[id]/items — ajoute une image au canvas
export async function POST(req: NextRequest, { params }: Params) {
  const userId = await getAuthUserId(req);
  if (!userId) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id } = await params;
  const { inspirationId, storageKey, thumbnailKey, width, height, title } =
    await req.json() as {
      inspirationId: string;
      storageKey: string;
      thumbnailKey?: string;
      width: number;
      height: number;
      title: string;
    };

  const moodboard = await db.moodboard.findFirst({
    where: { id, userId },
    select: { canvasData: true },
  });
  if (!moodboard) return NextResponse.json({ error: "Planche introuvable" }, { status: 404 });

  const existing = moodboard.canvasData as CanvasElement[];
  const maxZ = existing.reduce((m, e) => Math.max(m, e.zIndex ?? 0), 0);

  // Place at a random-ish position in the centre of the canvas
  const x = 200 + Math.round(Math.random() * 400);
  const y = 150 + Math.round(Math.random() * 300);
  const w = Math.min(300, width);
  const h = Math.round(w * (height / width));

  const element: ImageElement = {
    id: randomUUID(),
    type: "image",
    inspirationId,
    storageKey,
    thumbnailKey,
    title,
    aspectRatio: width / height,
    x, y, w, h,
    zIndex: maxZ + 1,
  };

  await db.moodboard.update({
    where: { id },
    data: { canvasData: [...existing, element] as object[] },
  });

  // La grille des planches n'affiche plus `canvasData` mais l'aperçu
  // précalculé (previewKey, voir moodboards/page.tsx) — contrairement à
  // l'éditeur (qui le régénère via son debounce schedulePreview), cette
  // route est appelée hors éditeur (extension Chrome) et doit régénérer
  // l'aperçu elle-même, sinon l'image ajoutée reste invisible sur la
  // planche tant que personne n'ouvre l'éditeur. Best-effort : une image
  // encore en triage (non acceptée) doit quand même apparaître — l'aperçu
  // compose `canvasData` tel quel, sans filtrer par statut.
  await regenerateMoodboardPreview(id).catch(() => {});

  return NextResponse.json({ ok: true, elementId: element.id });
}
