import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { profileSchema } from "@/lib/validators/auth";

// PATCH /api/account/profile — met à jour le nom et/ou l'email du compte
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = profileSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Données invalides" },
      { status: 400 },
    );
  }

  const { name, email } = parsed.data;
  const data: { name?: string | null; email?: string } = {};

  if (name !== undefined) data.name = name || null;

  if (email !== undefined) {
    // Vérifie qu'aucun autre compte n'utilise déjà cet email
    const existing = await db.user.findFirst({
      where: { email, NOT: { id: session.user.id } },
      select: { id: true },
    });
    if (existing) {
      return NextResponse.json(
        { error: "Cet email est déjà utilisé" },
        { status: 409 },
      );
    }
    data.email = email;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ ok: true });
  }

  const user = await db.user.update({
    where: { id: session.user.id },
    data,
    select: { name: true, email: true },
  });

  return NextResponse.json({ ok: true, user });
}
