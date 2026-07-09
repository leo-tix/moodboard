import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { deleteFromR2 } from "@/lib/storage/r2";
import { z } from "zod";

const batchSchema = z.object({
  ids: z.array(z.string()).min(1).max(200),
  patch: z.object({
    title: z.string().min(1).max(255).optional(),
    addCategory: z.object({
      categoryId: z.string(),
      subcategoryId: z.string().nullable().optional(),
    }).optional(),
    year: z.number().int().nullable().optional(),
    addTags: z.array(z.string()).optional(),
    // restore: remet les images archivées en triage (isArchived=false, isAccepted=false)
    restore: z.boolean().optional(),
  }),
});

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const userId = session.user.id;

  const body = await req.json();
  const parsed = batchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { ids: requestedIds, patch } = parsed.data;
  const { addTags, addCategory, restore, ...scalarFields } = patch;

  // Restreint aux inspirations réellement possédées par ce profil (anti-IDOR)
  const owned = await db.inspiration.findMany({
    where: { id: { in: requestedIds }, userId },
    select: { id: true },
  });
  const ids = owned.map((i) => i.id);
  if (ids.length === 0) return NextResponse.json({ success: true, updated: 0 });

  // Restaurer des archives → remet en triage
  if (restore) {
    await db.inspiration.updateMany({
      where: { id: { in: ids } },
      data: { isArchived: false, isAccepted: false },
    });
    return NextResponse.json({ success: true, restored: ids.length });
  }

  // Scalar fields (title, year)
  const scalarData: Record<string, unknown> = {};
  if (scalarFields.title !== undefined) scalarData.title = scalarFields.title;
  if (scalarFields.year !== undefined) scalarData.year = scalarFields.year;

  if (Object.keys(scalarData).length > 0) {
    await db.inspiration.updateMany({ where: { id: { in: ids } }, data: scalarData });
  }

  // Add category to all (upsert — won't duplicate)
  if (addCategory) {
    for (const inspirationId of ids) {
      await db.inspirationCategory.upsert({
        where: { inspirationId_categoryId: { inspirationId, categoryId: addCategory.categoryId } },
        create: {
          inspirationId,
          categoryId: addCategory.categoryId,
          subcategoryId: addCategory.subcategoryId ?? null,
        },
        update: { subcategoryId: addCategory.subcategoryId ?? null },
      });
    }
  }

  // Add tags (non-destructive)
  if (addTags && addTags.length > 0) {
    for (const name of addTags) {
      const slug = name.toLowerCase().replace(/\s+/g, "-");
      const tag = await db.tag.upsert({
        where: { userId_slug: { userId, slug } },
        create: { userId, name, slug },
        update: {},
      });
      for (const inspirationId of ids) {
        await db.inspirationTag.upsert({
          where: { inspirationId_tagId: { inspirationId, tagId: tag.id } },
          create: { inspirationId, tagId: tag.id },
          update: {},
        });
      }
    }
  }

  return NextResponse.json({ success: true, updated: ids.length });
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const userId = session.user.id;

  const body = await req.json();
  const parsed = z.object({ ids: z.array(z.string()).min(1) }).safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { ids } = parsed.data;

  // Collect R2 keys before deleting — scoped au propriétaire (anti-IDOR)
  const inspirations = await db.inspiration.findMany({
    where: { id: { in: ids }, userId },
    include: { images: { select: { storageKey: true, thumbnailKey: true } } },
  });
  const ownedIds = inspirations.map((i) => i.id);
  if (ownedIds.length === 0) return NextResponse.json({ success: true, deleted: 0 });

  await db.inspiration.deleteMany({ where: { id: { in: ownedIds } } });

  // Clean up R2 objects
  const keys = inspirations.flatMap((i) =>
    i.images.flatMap((img) => [img.storageKey, img.thumbnailKey].filter(Boolean) as string[])
  );
  if (keys.length > 0) {
    await Promise.allSettled(keys.map((k) => deleteFromR2(k)));
  }

  return NextResponse.json({ success: true, deleted: ids.length });
}
