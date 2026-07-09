import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ suggestions: [] }, { status: 401 });
  const userId = session.user.id;

  const { searchParams } = new URL(req.url);
  const field = searchParams.get("field") ?? "";
  const q     = (searchParams.get("q") ?? "").trim();

  let suggestions: string[] = [];

  try {
    switch (field) {
      case "author":
        suggestions = await db.inspiration
          .findMany({
            where: q
              ? { userId, author: { contains: q, mode: "insensitive" } }
              : { userId, author: { not: null } },
            select: { author: true },
            distinct: ["author"],
            take: 8,
            orderBy: { updatedAt: "desc" },
          })
          .then((r) => r.map((i) => i.author).filter((a): a is string => !!a && a.length > 0));
        break;

      case "year": {
        const years = await db.inspiration
          .findMany({
            where: { userId, year: { not: null } },
            select: { year: true },
            distinct: ["year"],
            orderBy: { year: "desc" },
            take: 30,
          })
          .then((r) => r.map((i) => String(i.year!)));
        suggestions = q ? years.filter((y) => y.startsWith(q)) : years;
        break;
      }

      case "title":
        if (!q) break;
        suggestions = await db.inspiration
          .findMany({
            where: { userId, title: { contains: q, mode: "insensitive" } },
            select: { title: true },
            distinct: ["title"],
            take: 6,
            orderBy: { updatedAt: "desc" },
          })
          .then((r) => r.map((i) => i.title).filter((t) => t !== q));
        break;

      case "tag":
        suggestions = await db.tag
          .findMany({
            where: q ? { userId, name: { contains: q, mode: "insensitive" } } : { userId },
            select: { name: true },
            orderBy: { inspirations: { _count: "desc" } },
            take: 10,
          })
          .then((r) => r.map((t) => t.name).filter((n) => n !== q));
        break;
    }
  } catch {
    suggestions = [];
  }

  return NextResponse.json({ suggestions });
}
