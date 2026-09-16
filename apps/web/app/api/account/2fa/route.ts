import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { countUnusedRecoveryCodes } from "@/lib/auth/recoveryCodes";

// GET /api/account/2fa — état du second facteur pour le compte courant.
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { twoFactorEnabled: true, twoFactorEnabledAt: true, twoFactorSecret: true },
  });
  if (!user) return NextResponse.json({ error: "Compte introuvable" }, { status: 404 });

  return NextResponse.json({
    enabled: user.twoFactorEnabled,
    // Secret enregistré mais pas encore confirmé par un premier code.
    pending: !user.twoFactorEnabled && Boolean(user.twoFactorSecret),
    enabledAt: user.twoFactorEnabledAt?.toISOString() ?? null,
    recoveryCodesLeft: user.twoFactorEnabled ? await countUnusedRecoveryCodes(session.user.id) : 0,
  });
}
