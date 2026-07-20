import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { canEditResource } from "@/lib/access/resolve";
import { z } from "zod";
import { nextBlockOrder } from "@/lib/visits/blockOrder";

interface Params { params: Promise<{ id: string }> }

const createSchema = z.object({
  // HTML (sortie de l'éditeur Tiptap) — plafond relevé pour absorber la
  // verbosité des balises par rapport au texte brut d'origine. Pas de risque
  // XSS supplémentaire : le rendu passe par le schéma ProseMirror (parser
  // qui ne reconnaît que les nœuds de StarterKit), jamais par un
  // dangerouslySetInnerHTML brut.
  content: z.string().max(20000).default(""),
  // Position dans le carnet ; si absent → fin de séquence
  order: z.number().int().optional(),
});

// POST /api/visits/[id]/notes — crée un bloc de note dans le carnet
export async function POST(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  if (!(await canEditResource("VISIT", id, session.user.id))) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const order = parsed.data.order ?? (await nextBlockOrder(id));

  const note = await db.visitNote.create({
    data: { visitId: id, content: parsed.data.content, order },
  });

  return NextResponse.json(note, { status: 201 });
}
