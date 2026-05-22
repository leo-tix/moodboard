import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const limitParam = req.nextUrl.searchParams.get("limit");
  const limit = limitParam ? Math.min(parseInt(limitParam, 10) || 200, 500) : 200;

  const rows = await db.inspiration.findMany({
    where: { status: "READY" },
    select: {
      id: true,
      title: true,
      images: {
        where: { isMain: true },
        select: { thumbnailKey: true, storageKey: true, width: true, height: true },
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
    })),
  });
}
