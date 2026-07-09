import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";

// GET /api/inspirations — liste paginée
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const userId = session.user.id;

  const { searchParams } = new URL(req.url);
  const page = parseInt(searchParams.get("page") ?? "1");
  const limit = parseInt(searchParams.get("limit") ?? "48");
  const categoryId = searchParams.get("categoryId");
  const status = searchParams.get("status") ?? "READY";

  const where = {
    userId,
    ...(status !== "all" ? { status: status as "READY" | "PROCESSING" | "ERROR" } : {}),
    ...(categoryId ? { categoryId } : {}),
    isArchived: false,
    isAccepted: true,
  };

  const [inspirations, total] = await Promise.all([
    db.inspiration.findMany({
      where,
      include: {
        images: {
          select: {
            thumbnailKey: true,
            blurHash: true,
            width: true,
            height: true,
            isMain: true,
          },
          orderBy: [{ isMain: "desc" }, { order: "asc" }],
        },
        categories: { include: { category: { select: { name: true } } }, take: 3 },
        tags: { include: { tag: { select: { name: true } } } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.inspiration.count({ where }),
  ]);

  return NextResponse.json({
    inspirations,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
}
