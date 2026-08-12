import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";

// GET /api/library/cloud — TOUTE la bibliothèque, en charge utile minimale.
//
// À la différence de /api/library/strip (paginé, filtré, destiné au panneau
// latéral), cette route sert la bibliothèque ENTIÈRE d'un coup : le nuage 3D
// place les images les unes par rapport aux autres, donc une vue partielle
// donnerait une disposition fausse qui sauterait à chaque chargement.
//
// La charge est donc volontairement maigre — pas de titre long, pas de
// description, pas d'EXIF : de quoi positionner, afficher une vignette et
// insérer dans une planche. ~120 octets par image, soit une soixantaine de
// kilooctets pour un millier d'images.
const PLAFOND = 2000;

export interface CloudImage {
  id: string;              // inspirationId
  k: string;               // thumbnailKey
  s: string;               // storageKey (insertion dans la planche)
  t: string;               // titre
  w: number | null;
  h: number | null;
  y: number | null;        // année
  c: string | null;        // catégorie (1re)
  g: string[];             // tags (slugs)
  col: string[];           // palette (jusqu'à 5), pour choisir la plus chromatique
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const rows = await db.inspiration.findMany({
    where: {
      userId: session.user.id,
      isArchived: false,
      images: { some: {} },      // une image sans fichier n'a rien à montrer
    },
    select: {
      id: true,
      title: true,
      year: true,
      images: {
        orderBy: [{ isMain: "desc" }, { order: "asc" }],
        take: 1,
        select: { thumbnailKey: true, storageKey: true, width: true, height: true },
      },
      categories: { take: 1, select: { category: { select: { name: true } } } },
      tags: { select: { tag: { select: { slug: true } } } },
      // La dominante suffit à positionner ; le reste de la palette ne sert pas ici.
      // Toute la palette, pas seulement la dominante : sur des visuels sombres
      // la dominante est presque toujours le noir du fond, ce qui écrasait
      // TOUTES les images au même endroit du tri par couleur. Le choix de la
      // teinte représentative se fait donc côté client, sur la palette.
      colorPalette: { orderBy: { order: "asc" }, take: 5, select: { hex: true } },
    },
    orderBy: { createdAt: "desc" },
    take: PLAFOND,
  });

  const images: CloudImage[] = rows
    .filter((r) => r.images[0]?.thumbnailKey)
    .map((r) => ({
      id: r.id,
      k: r.images[0].thumbnailKey!,
      s: r.images[0].storageKey,
      t: r.title,
      w: r.images[0].width,
      h: r.images[0].height,
      y: r.year,
      c: r.categories[0]?.category.name ?? null,
      g: r.tags.map((t) => t.tag.slug),
      col: r.colorPalette.map((c) => c.hex),
    }));

  return NextResponse.json({ images, tronque: rows.length >= PLAFOND });
}
