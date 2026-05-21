import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";

// GET /api/collections — liste toutes les collections avec couverture + compte
export async function GET(_req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const collections = await db.collection.findMany({
    include: {
      items: {
        include: {
          inspiration: {
            include: {
              images: {
                where: { isMain: true },
                take: 1,
                select: { thumbnailKey: true },
              },
            },
          },
        },
        orderBy: { order: "asc" },
        take: 4, // pour la mosaïque de couverture
      },
      _count: { select: { items: true } },
    },
    orderBy: { order: "asc" },
  });

  return NextResponse.json(collections);
}

// POST /api/collections — créer une collection
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { name, description } = await req.json();
  if (!name?.trim()) return NextResponse.json({ error: "Nom requis" }, { status: 400 });

  const collection = await db.collection.create({
    data: { name: name.trim(), description: description?.trim() || null },
    include: { _count: { select: { items: true } } },
  });

  return NextResponse.json(collection, { status: 201 });
}
