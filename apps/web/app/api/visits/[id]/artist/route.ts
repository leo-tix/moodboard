import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { z } from "zod";
import { nextBlockOrder } from "@/lib/visits/blockOrder";
import { fetchWikiSummary, searchWiki } from "@/lib/visits/wikiArtist";

interface Params { params: Promise<{ id: string }> }

// `title` = page exacte choisie dans les suggestions ; `name` = recherche libre.
const createSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  name: z.string().min(1).max(200).optional(),
}).refine((d) => d.title || d.name, { message: "title ou name requis" });

// POST /api/visits/[id]/artist — crée une « fiche wiki » (VisitEmbed kind
// ARTIST) depuis Wikipédia FR. Champs figés à la création. Supprimé via
// /embeds/[id]. Stockage : title=nom, description=1er paragraphe,
// siteName=description courte (« peintre français »).
export async function POST(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const visit = await db.visit.findFirst({ where: { id, userId: session.user.id }, select: { id: true } });
  if (!visit) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const meta = parsed.data.title
    ? await fetchWikiSummary(parsed.data.title)
    : await searchWiki(parsed.data.name!);
  if (!meta) return NextResponse.json({ error: "Page introuvable sur Wikipédia" }, { status: 422 });

  const order = await nextBlockOrder(id);
  const embed = await db.visitEmbed.create({
    data: {
      visitId: id,
      kind: "ARTIST",
      url: meta.url,
      title: meta.title,
      description: meta.extract,
      image: meta.image,
      siteName: meta.shortDesc, // repurposé : description courte pour la carte
      data: (meta.structured ?? undefined) as import("@prisma/client").Prisma.InputJsonValue | undefined, // infobox Wikidata
      order,
    },
  });
  return NextResponse.json(embed, { status: 201 });
}
