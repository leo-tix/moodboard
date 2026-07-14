import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { z } from "zod";
import { nextBlockOrder } from "@/lib/visits/blockOrder";
import { fetchLinkPreview, fetchYouTubeMeta, parseYouTubeId, isSafePublicUrl } from "@/lib/visits/linkPreview";

interface Params { params: Promise<{ id: string }> }

const createSchema = z.object({
  kind: z.enum(["LINK", "YOUTUBE"]),
  url: z.string().url().max(2000),
  order: z.number().int().optional(),
});

// POST /api/visits/[id]/embeds — crée un bloc lien externe (kind LINK, carte
// d'aperçu via Open Graph) ou un embed YouTube (kind YOUTUBE, miniature +
// titre via oEmbed). Les métadonnées sont récupérées côté serveur À LA
// CRÉATION et figées dans la ligne (pas de refetch au rendu).
export async function POST(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const visit = await db.visit.findFirst({ where: { id, userId: session.user.id }, select: { id: true } });
  if (!visit) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const { kind, url } = parsed.data;

  if (kind === "YOUTUBE") {
    const videoId = parseYouTubeId(url);
    if (!videoId) return NextResponse.json({ error: "URL YouTube invalide" }, { status: 400 });
  } else if (!isSafePublicUrl(url)) {
    return NextResponse.json({ error: "URL non autorisée" }, { status: 400 });
  }

  const meta =
    kind === "YOUTUBE"
      ? await fetchYouTubeMeta(parseYouTubeId(url)!)
      : await fetchLinkPreview(url);

  const order = parsed.data.order ?? (await nextBlockOrder(id));
  const embed = await db.visitEmbed.create({
    data: {
      visitId: id,
      kind,
      url,
      title: meta.title,
      description: meta.description,
      image: meta.image,
      siteName: meta.siteName,
      order,
    },
  });

  return NextResponse.json(embed, { status: 201 });
}
