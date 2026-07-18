import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { z } from "zod";
import { nextBlockOrder } from "@/lib/visits/blockOrder";
import { searchArtist } from "@/lib/visits/wikiArtist";

interface Params { params: Promise<{ id: string }> }

const createSchema = z.object({ name: z.string().min(1).max(200) });

// POST /api/visits/[id]/artist — crée une fiche artiste (VisitEmbed kind
// ARTIST) à partir d'un NOM : on interroge Wikipédia FR côté serveur et on fige
// notice/portrait/URL dans la ligne. Supprimé via la route /embeds/[id].
export async function POST(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const visit = await db.visit.findFirst({ where: { id, userId: session.user.id }, select: { id: true } });
  if (!visit) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const meta = await searchArtist(parsed.data.name);
  if (!meta) return NextResponse.json({ error: "Artiste introuvable sur Wikipédia" }, { status: 422 });

  const order = await nextBlockOrder(id);
  const embed = await db.visitEmbed.create({
    data: {
      visitId: id,
      kind: "ARTIST",
      url: meta.url,
      title: meta.title,
      description: meta.description,
      image: meta.image,
      siteName: meta.siteName,
      order,
    },
  });
  return NextResponse.json(embed, { status: 201 });
}
