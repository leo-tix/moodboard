import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await db.inspiration.findMany({
    where: { status: "READY" },
    select: {
      id: true,
      title: true,
      images: {
        where: { isMain: true },
        select: { thumbnailKey: true },
        take: 1,
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({
    items: rows.map((r) => ({
      id: r.id,
      title: r.title,
      thumbnailKey: r.images[0]?.thumbnailKey ?? null,
    })),
  });
}
