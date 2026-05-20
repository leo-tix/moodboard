import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { updateInspirationSchema } from "@/lib/validators/inspiration";

// GET /api/inspirations/[id]
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id } = await params;

  const inspiration = await db.inspiration.findUnique({
    where: { id },
    include: {
      images: { orderBy: [{ isMain: "desc" }, { order: "asc" }] },
      category: true,
      subcategory: true,
      tags: { include: { tag: true } },
      colorPalette: { orderBy: { order: "asc" } },
      aiAnalysis: true,
      collections: { include: { collection: true } },
    },
  });

  if (!inspiration) {
    return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  }

  return NextResponse.json(inspiration);
}

// PATCH /api/inspirations/[id]
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const parsed = updateInspirationSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { tags, ...data } = parsed.data;

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
                where: { slug: name.toLowerCase().replace(/\s+/g, "-") },
                create: {
                  name,
                  slug: name.toLowerCase().replace(/\s+/g, "-"),
                },
              },
            },
          })),
        },
      }),
    },
    include: { tags: { include: { tag: true } } },
  });

  return NextResponse.json(inspiration);
}

// DELETE /api/inspirations/[id]
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id } = await params;

  // Les images R2 sont à supprimer aussi — géré côté client ou job séparé
  await db.inspiration.delete({ where: { id } });

  return NextResponse.json({ success: true });
}
