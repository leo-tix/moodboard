import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { z } from "zod";
import { slugify } from "@/lib/utils";

const schema = z.object({
  name: z.string().min(1).max(100),
});

type Params = { params: Promise<{ id: string }> };

// POST /api/categories/[id]/subcategories — créer une sous-catégorie
export async function POST(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id: categoryId } = await params;
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const slug = slugify(parsed.data.name);

  const last = await db.subcategory.findFirst({
    where: { categoryId },
    orderBy: { order: "desc" },
  });

  const sub = await db.subcategory.create({
    data: {
      name: parsed.data.name,
      slug,
      categoryId,
      order: (last?.order ?? 0) + 1,
    },
  });

  return NextResponse.json(sub, { status: 201 });
}
