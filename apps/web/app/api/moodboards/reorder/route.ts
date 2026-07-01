import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";

interface ReorderItem {
  id: string;
  order: number;
  folderId?: string | null;
}

// POST /api/moodboards/reorder
// Body: { items: [{ id, order, folderId? }] } — bulk-persists drag-and-drop
// position and/or folder assignment in one transaction.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const items = body.items as ReorderItem[] | undefined;
  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: "items manquant" }, { status: 400 });
  }

  await db.$transaction(
    items.map((item) =>
      db.moodboard.update({
        where: { id: item.id },
        data: {
          order: item.order,
          ...(item.folderId !== undefined ? { folderId: item.folderId } : {}),
        },
      }),
    ),
  );

  return NextResponse.json({ ok: true });
}
