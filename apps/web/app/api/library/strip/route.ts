import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const limitParam = sp.get("limit");
  const limit = limitParam ? Math.min(parseInt(limitParam, 10) || 200, 500) : 200;
  const q = sp.get("q")?.trim() ?? "";
  const categoryId = sp.get("categoryId") ?? "";
  const tagsParam = sp.get("tags") ?? "";
  const tags = tagsParam ? tagsParam.split(",").filter(Boolean) : [];

  const where: Prisma.InspirationWhereInput = {
    status:     "READY",
    isArchived: false,
    isAccepted: true,
    ...(q && {
      OR: [
        { title:       { contains: q, mode: "insensitive" } },
        { author:      { contains: q, mode: "insensitive" } },
        { description: { contains: q, mode: "insensitive" } },
        { tags: { some: { tag: { name: { contains: q, mode: "insensitive" } } } } },
      ],
    }),
    ...(categoryId && { categories: { some: { categoryId } } }),
    ...(tags.length > 0 && {
      AND: tags.map((slug) => ({ tags: { some: { tag: { slug } } } })),
    }),
  };

  const rows = await db.inspiration.findMany({
    where,
    select: {
      id: true,
      title: true,
      images: {
        where: { isMain: true },
        select: { thumbnailKey: true, storageKey: true, width: true, height: true, isAnimated: true },
        take: 1,
      },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return NextResponse.json({
    items: rows.map((r) => ({
      id: r.id,
      title: r.title,
      thumbnailKey: r.images[0]?.thumbnailKey ?? null,
      storageKey: r.images[0]?.storageKey ?? null,
      width: r.images[0]?.width ?? null,
      height: r.images[0]?.height ?? null,
      isAnimated: r.images[0]?.isAnimated ?? false,
    })),
  });
}
