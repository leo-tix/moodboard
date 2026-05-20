import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { z } from "zod";
import { slugify } from "@/lib/utils";

const createSchema = z.object({
  name: z.string().min(1).max(100),
  icon: z.string().max(10).optional(),
  description: z.string().max(500).optional(),
});

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const categories = await db.category.findMany({
    include: {
      subcategories: { orderBy: { order: "asc" } },
      _count: { select: { inspirationCategories: true } },
    },
    orderBy: { order: "asc" },
  });

  return NextResponse.json(categories);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const slug = slugify(parsed.data.name);
  const existing = await db.category.findUnique({ where: { slug } });
  if (existing) return NextResponse.json({ error: "Cette catégorie existe déjà" }, { status: 409 });

  // Ordre = dernier + 1
  const last = await db.category.findFirst({ orderBy: { order: "desc" } });

  const category = await db.category.create({
    data: {
      name: parsed.data.name,
      slug,
      icon: parsed.data.icon ?? "○",
      description: parsed.data.description,
      order: (last?.order ?? 0) + 1,
    },
    include: { subcategories: true, _count: { select: { inspirationCategories: true } } },
  });

  return NextResponse.json(category, { status: 201 });
}
