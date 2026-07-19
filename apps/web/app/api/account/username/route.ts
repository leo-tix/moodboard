import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { usernameSchema } from "@/lib/validators/auth";

// GET /api/account/username?value= — disponibilité + validité d'un handle.
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const value = new URL(req.url).searchParams.get("value")?.trim().toLowerCase() ?? "";
  const parsed = usernameSchema.safeParse(value);
  if (!parsed.success) {
    return NextResponse.json({ available: false, error: parsed.error.issues[0]?.message });
  }

  const taken = await db.user.findFirst({
    where: { username: parsed.data, NOT: { id: session.user.id } },
    select: { id: true },
  });
  return NextResponse.json({ available: !taken, error: taken ? "Déjà pris" : undefined });
}
