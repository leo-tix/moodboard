import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim() ?? "";
  const categoryId = searchParams.get("categoryId") ?? "";
  const tagsParam = searchParams.get("tags") ?? "";
  const tags = tagsParam ? tagsParam.split(",").filter(Boolean) : [];
  const yearFrom = searchParams.get("yearFrom") ? parseInt(searchParams.get("yearFrom")!) : null;
  const yearTo = searchParams.get("yearTo") ? parseInt(searchParams.get("yearTo")!) : null;
  const page = parseInt(searchParams.get("page") ?? "1");
  const limit = parseInt(searchParams.get("limit") ?? "48");

  // Construction des filtres Prisma
  const where: Prisma.InspirationWhereInput = {
    status: "READY",

    // Filtre texte — recherche sur titre, auteur, studio, description, notes, tags
    ...(q && {
      OR: [
        { title: { contains: q, mode: "insensitive" } },
        { author: { contains: q, mode: "insensitive" } },
        { studio: { contains: q, mode: "insensitive" } },
        { description: { contains: q, mode: "insensitive" } },
        { notes: { contains: q, mode: "insensitive" } },
        { country: { contains: q, mode: "insensitive" } },
        { tags: { some: { tag: { name: { contains: q, mode: "insensitive" } } } } },
      ],
    }),

    // Filtre catégorie
    ...(categoryId && { categoryId }),

    // Filtre tags (doit avoir TOUS les tags sélectionnés)
    ...(tags.length > 0 && {
      AND: tags.map((tagSlug) => ({
        tags: { some: { tag: { slug: tagSlug } } },
      })),
    }),

    // Filtre années
    ...(yearFrom || yearTo
      ? {
          year: {
            ...(yearFrom && { gte: yearFrom }),
            ...(yearTo && { lte: yearTo }),
          },
        }
      : {}),
  };

  const [results, total] = await Promise.all([
    db.inspiration.findMany({
      where,
      include: {
        images: {
          select: { thumbnailKey: true, blurHash: true, width: true, height: true, isMain: true },
          orderBy: [{ isMain: "desc" }, { order: "asc" }],
          take: 1,
        },
        category: { select: { name: true } },
        tags: { include: { tag: { select: { name: true, slug: true } } }, take: 5 },
        colorPalette: { select: { hex: true }, orderBy: { order: "asc" }, take: 3 },
      },
      orderBy: q ? { createdAt: "desc" } : { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.inspiration.count({ where }),
  ]);

  return NextResponse.json({
    results,
    total,
    page,
    pages: Math.ceil(total / limit),
    query: { q, categoryId, tags, yearFrom, yearTo },
  });
}
