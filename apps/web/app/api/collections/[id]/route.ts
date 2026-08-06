import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { deleteGrantsFor, canEditResource, resolveAccess, canView } from "@/lib/access/resolve";

type Params = { params: Promise<{ id: string }> };

// GET /api/collections/[id] — détail avec toutes les images
export async function GET(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id } = await params;

  // Lecture ouverte au propriétaire, éditeur ou lecteur autorisé (co-consultation).
  if (!canView(await resolveAccess("COLLECTION", id, session.user.id))) {
    return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  }

  const collection = await db.collection.findUnique({
    where: { id },
    include: {
      items: {
        include: {
          inspiration: {
            include: {
              images: {
                orderBy: [{ isMain: "desc" }, { order: "asc" }],
                take: 1,
                select: { thumbnailKey: true, blurHash: true, width: true, height: true },
              },
              categories: { include: { category: { select: { name: true } } }, take: 3 },
              tags: { include: { tag: { select: { name: true } } }, take: 5 },
            },
          },
        },
        orderBy: { order: "asc" },
      },
      _count: { select: { items: true } },
    },
  });

  if (!collection) return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  return NextResponse.json(collection);
}

// PATCH /api/collections/[id] — renommer / description / image de couverture
export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id } = await params;
  const { name, description, coverImageKey } = await req.json();

  // Propriétaire OU éditeur (co-édition du nom/description).
  if (!(await canEditResource("COLLECTION", id, session.user.id))) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  // La couverture doit être une image RÉELLEMENT dans cette collection. Sans
  // ce contrôle, n'importe quelle clé de stockage arbitraire serait acceptée :
  // l'aperçu d'une collection partagée pourrait alors afficher un fichier
  // auquel le visiteur n'a aucun droit d'accès.
  if (coverImageKey !== undefined && coverImageKey !== null) {
    if (typeof coverImageKey !== "string") {
      return NextResponse.json({ error: "Couverture invalide" }, { status: 400 });
    }
    const dedans = await db.image.findFirst({
      where: { storageKey: coverImageKey, inspiration: { collections: { some: { collectionId: id } } } },
      select: { id: true },
    });
    if (!dedans) {
      return NextResponse.json({ error: "Cette image n'est pas dans la collection." }, { status: 400 });
    }
  }

  const collection = await db.collection.update({
    where: { id },
    data: {
      ...(name?.trim() ? { name: name.trim() } : {}),
      ...(description !== undefined ? { description: description?.trim() || null } : {}),
      // `null` RÉINITIALISE la couverture (retour à la première image) — d'où
      // le test sur `undefined` et non sur la valeur elle-même.
      ...(coverImageKey !== undefined ? { coverImageKey } : {}),
    },
  });

  return NextResponse.json(collection);
}

// DELETE /api/collections/[id]
export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id } = await params;
  const res = await db.collection.deleteMany({ where: { id, userId: session.user.id } });
  if (res.count === 0) return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  await deleteGrantsFor("COLLECTION", id); // ACL polymorphe : pas de cascade DB
  return NextResponse.json({ success: true });
}
