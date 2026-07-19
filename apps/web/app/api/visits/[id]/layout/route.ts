import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { z } from "zod";

interface Params { params: Promise<{ id: string }> }

const tileSchema = z.object({
  // Doit rester aligné sur JournalTileType (apps/web/lib/visits/bentoSpans.ts).
  // ⚠ Un type manquant ici fait échouer TOUT le PATCH (zod) → aucune
  // sauvegarde de layout (réordonnancement/format) sur les visites contenant
  // ce type — bug 2026-07-19 (les 7 modules « musée » manquaient).
  type: z.enum([
    "image", "note", "audio", "embed", "map",
    "cartel", "palette", "ticket", "sketch", "highlight", "checklist", "timeline",
  ]),
  id: z.string().min(1),
  w: z.union([z.literal(1), z.literal(2)]),
  // Les médias tiennent en 1|2 (format fixe) ; les blocs texte s'étendent en
  // hauteur automatique par paliers de grille — h peut donc dépasser 2 (borné
  // à 12 comme garde-fou). Voir apps/web/lib/visits/bentoSpans.ts.
  h: z.number().int().min(1).max(12),
  hideTitle: z.boolean().optional(),
  hideImage: z.boolean().optional(),
  hideInfo: z.boolean().optional(),
  hideParagraph: z.boolean().optional(),
});

// PATCH /api/visits/[id]/layout — remplace intégralement Visit.journalLayout.
// Même pattern que canvasData sur Moodboard : le client renvoie le tableau
// complet (réordonné et/ou avec un format modifié), une seule écriture.
// Utilisé pour le drag-reorder, le cycle de redimensionnement, et le retrait
// d'une tuile de la grille (la suppression du CONTENU passe par la route
// dédiée au type — /notes/[id], /audio/[id], etc.).
export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = z.object({ layout: z.array(tileSchema) }).safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const owned = await db.visit.findFirst({ where: { id, userId: session.user.id }, select: { id: true } });
  if (!owned) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const visit = await db.visit.update({
    where: { id },
    data: { journalLayout: parsed.data.layout },
    select: { journalLayout: true },
  });
  return NextResponse.json(visit);
}
