import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";

function hexToRgb(hex: string) {
  const h = hex.replace("#", "");
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}

function colorDistance(hex1: string, hex2: string): number {
  const c1 = hexToRgb(hex1);
  const c2 = hexToRgb(hex2);
  return Math.sqrt(2 * (c1.r - c2.r) ** 2 + 4 * (c1.g - c2.g) ** 2 + 3 * (c1.b - c2.b) ** 2);
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const hex = (searchParams.get("hex") ?? "").replace("#", "").toUpperCase();
  const threshold = Math.min(parseInt(searchParams.get("threshold") ?? "100"), 300);
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "48"), 120);

  if (!/^[0-9A-F]{6}$/.test(hex)) {
    return NextResponse.json({ error: "Hex invalide" }, { status: 400 });
  }

  const target = `#${hex}`;

  const inspirations = await db.inspiration.findMany({
    where: { status: "READY", isArchived: false, isAccepted: true, colorPalette: { some: {} } },
    include: {
      colorPalette: { orderBy: { order: "asc" } },
      images: {
        select: { thumbnailKey: true, blurHash: true, width: true, height: true, isMain: true },
        orderBy: [{ isMain: "desc" }, { order: "asc" }],
        take: 1,
      },
      categories: { include: { category: { select: { name: true } } }, take: 3 },
      tags: { include: { tag: { select: { name: true } } }, take: 5 },
    },
  });

  const scored = inspirations
    .map((insp) => ({
      inspiration: insp,
      distance: Math.min(...insp.colorPalette.map((c) => colorDistance(target, c.hex))),
    }))
    .filter(({ distance }) => distance <= threshold)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit);

  return NextResponse.json({
    results: scored.map(({ inspiration, distance }) => ({
      ...inspiration,
      _colorDistance: Math.round(distance),
    })),
    target,
    threshold,
  });
}
