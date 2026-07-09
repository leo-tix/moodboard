import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { deleteFromR2 } from "@/lib/storage/r2";
import { updateInspirationSchema } from "@/lib/validators/inspiration";

// GET /api/inspirations/[id]
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id } = await params;

  const inspiration = await db.inspiration.findFirst({
    where: { id, userId: session.user.id },
    include: {
      images: { orderBy: [{ isMain: "desc" }, { order: "asc" }] },
      categories: {
        include: {
          category: true,
          subcategory: true,
        },
      },
      tags: { include: { tag: true } },
      colorPalette: { orderBy: { order: "asc" } },
      aiAnalysis: true,
      collections: { include: { collection: true } },
    },
  });

  if (!inspiration) return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  return NextResponse.json(inspiration);
}

// PATCH /api/inspirations/[id]
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const userId = session.user.id;

  const { id } = await params;
  const body = await req.json();
  const parsed = updateInspirationSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // Vérifie l'appartenance avant toute écriture
  const owned = await db.inspiration.findFirst({
    where: { id, userId },
    select: { id: true },
  });
  if (!owned) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const { tags, categories, ...data } = parsed.data;

  const inspiration = await db.inspiration.update({
    where: { id },
    data: {
      ...data,
      ...(tags !== undefined && {
        tags: {
          deleteMany: {},
          create: tags.map((name: string) => ({
            tag: {
              connectOrCreate: {
                where: { userId_slug: { userId, slug: name.toLowerCase().replace(/\s+/g, "-") } },
                create: { userId, name, slug: name.toLowerCase().replace(/\s+/g, "-") },
              },
            },
          })),
        },
      }),
      ...(categories !== undefined && {
        categories: {
          deleteMany: {},
          create: categories.map(({ categoryId, subcategoryId }) => ({
            categoryId,
            subcategoryId: subcategoryId ?? null,
          })),
        },
      }),
    },
    include: {
      tags: { include: { tag: true } },
      categories: { include: { category: true, subcategory: true } },
    },
  });

  return NextResponse.json(inspiration);
}

// DELETE /api/inspirations/[id] — supprime DB + objets R2
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id } = await params;

  // Fetch image keys before deletion (cascade will wipe them) — scoped au propriétaire
  const inspiration = await db.inspiration.findFirst({
    where: { id, userId: session.user.id },
    include: { images: { select: { storageKey: true, thumbnailKey: true } } },
  });

  if (!inspiration) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  // Delete DB record (cascade removes Image, InspirationTag, InspirationCategory, etc.)
  await db.inspiration.delete({ where: { id } });

  // Delete R2 objects in parallel (non-blocking — don't fail the request if R2 errors)
  const keysToDelete = inspiration.images.flatMap((img) =>
    [img.storageKey, img.thumbnailKey].filter(Boolean) as string[]
  );
  if (keysToDelete.length > 0) {
    await Promise.allSettled(keysToDelete.map((key) => deleteFromR2(key)));
  }

  return NextResponse.json({ success: true });
}
