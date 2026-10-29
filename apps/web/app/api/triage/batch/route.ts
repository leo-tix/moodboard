import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { z } from "zod";

const schema = z.object({
  ids: z.array(z.string()).min(1).max(200),
  action: z.enum(["accept", "archive"]),
});

// PATCH /api/triage/batch — accepte ou archive plusieurs images d'un coup
// (vue galerie du triage). Même sémantique que PATCH /api/triage/[id], en
// masse — scoped par userId (anti-IDOR), comme /api/inspirations/batch.
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { ids, action } = parsed.data;

  const res = await db.inspiration.updateMany({
    where: { id: { in: ids }, userId: session.user.id },
    data: {
      isAccepted: action === "accept",
      isArchived: action === "archive",
    },
  });

  return NextResponse.json({ ok: true, updated: res.count });
}
