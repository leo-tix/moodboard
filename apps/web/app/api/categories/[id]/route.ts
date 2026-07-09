import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/current";
import { db } from "@/lib/db";
import { z } from "zod";
import { slugify } from "@/lib/utils";

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  icon: z.string().max(10).optional(),
  description: z.string().max(500).optional(),
  order: z.number().int().optional(),
});

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Réservé à l'administrateur" }, { status: 403 });

  const { id } = await params;
  const body = await req.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const data: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.name) data.slug = slugify(parsed.data.name);

  const category = await db.category.update({
    where: { id },
    data,
    include: {
      subcategories: { orderBy: { order: "asc" } },
      _count: { select: { inspirationCategories: true } },
    },
  });

  return NextResponse.json(category);
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Réservé à l'administrateur" }, { status: 403 });

  const { id } = await params;
  // InspirationCategory entries cascade-delete with the category (onDelete: Cascade)
  await db.category.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
