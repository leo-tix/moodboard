import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";

// Même distance perceptuelle que /search et /api/inspirations/color-search
// (gardées en sync manuellement, pas de module partagé pour ce petit calcul).
function colorDistance(hex1: string, hex2: string): number {
  const p = (h: string, s: number) => parseInt(h.slice(s, s + 2), 16);
  const [r1, g1, b1] = [p(hex1, 1), p(hex1, 3), p(hex1, 5)];
  const [r2, g2, b2] = [p(hex2, 1), p(hex2, 3), p(hex2, 5)];
  return Math.sqrt(2 * (r1 - r2) ** 2 + 4 * (g1 - g2) ** 2 + 3 * (b1 - b2) ** 2);
}
const COLOR_THRESHOLD = 120;

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const limitParam = sp.get("limit");
  const limit = limitParam ? Math.min(parseInt(limitParam, 10) || 200, 500) : 200;
  const q = sp.get("q")?.trim() ?? "";
  const categoryId = sp.get("categoryId") ?? "";
  const tagsParam = sp.get("tags") ?? "";
  const tags = tagsParam ? tagsParam.split(",").filter(Boolean) : [];
  const yearFrom = sp.get("yearFrom") ? parseInt(sp.get("yearFrom")!, 10) : null;
  const yearTo = sp.get("yearTo") ? parseInt(sp.get("yearTo")!, 10) : null;
  const colorHex = (sp.get("color") ?? "").replace("#", "").toUpperCase();
  const isColorSearch = /^[0-9A-F]{6}$/.test(colorHex);

  const where: Prisma.InspirationWhereInput = {
    userId:     session.user.id,
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
    ...((yearFrom || yearTo) && {
      year: {
        ...(yearFrom && { gte: yearFrom }),
        ...(yearTo && { lte: yearTo }),
      },
    }),
    ...(isColorSearch && { colorPalette: { some: {} } }),
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
      colorPalette: isColorSearch ? { select: { hex: true } } : false,
    },
    orderBy: { createdAt: "desc" },
    take: isColorSearch ? 500 : limit,
  });

  let sorted = rows;
  if (isColorSearch) {
    const target = `#${colorHex}`;
    sorted = rows
      .map((r) => {
        const palette = (r as { colorPalette?: { hex: string }[] }).colorPalette ?? [];
        const minDist = palette.length ? Math.min(...palette.map((c) => colorDistance(target, c.hex))) : 999;
        return { ...r, _colorDistance: minDist };
      })
      .filter((r) => r._colorDistance <= COLOR_THRESHOLD)
      .sort((a, b) => a._colorDistance - b._colorDistance)
      .slice(0, limit);
  }

  return NextResponse.json({
    items: sorted.map((r) => ({
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
