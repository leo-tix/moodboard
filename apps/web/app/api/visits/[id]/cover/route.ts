import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { z } from "zod";
import { uploadTilePhoto } from "@/lib/visits/tilePhoto";
import { canEditResource } from "@/lib/access/resolve";

interface Params { params: Promise<{ id: string }> }

// Propriétaire OU éditeur (co-édition) de la visite.
const canEditVisit = (id: string, userId: string) => canEditResource("VISIT", id, userId);

// PATCH /api/visits/[id]/cover — définit la couverture personnalisée par sa clé
// R2 (image choisie parmi celles de la visite), ou la retire (coverKey: null →
// retour au carrousel). On ne stocke que la clé ; l'image reste par ailleurs
// possédée par son inspiration (pas de purge R2 ici — la clé peut être partagée).
const patchSchema = z.object({ coverKey: z.string().min(1).max(300).nullable() });

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const { id } = await params;
  if (!(await canEditVisit(id, session.user.id))) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  await db.visit.update({ where: { id }, data: { coverKey: parsed.data.coverKey } });
  return NextResponse.json({ coverKey: parsed.data.coverKey });
}

// POST /api/visits/[id]/cover — importe une NOUVELLE photo de couverture
// (galerie ou appareil). Même pipeline image que les tuiles (webp + vignette).
export async function POST(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const { id } = await params;
  if (!(await canEditVisit(id, session.user.id))) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Fichier manquant" }, { status: 400 });

  const res = await uploadTilePhoto(session.user.id, file);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });

  await db.visit.update({ where: { id }, data: { coverKey: res.photo.storageKey } });
  return NextResponse.json({ coverKey: res.photo.storageKey });
}
