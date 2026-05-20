import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const categories = await db.category.findMany({
    include: { subcategories: { orderBy: { order: "asc" } } },
    orderBy: { order: "asc" },
  });

  return NextResponse.json(categories);
}
