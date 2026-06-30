import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { randomBytes, createHash } from "crypto";

// POST — génère un nouveau token (révoque l'ancien)
export async function POST(_req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const plain = `mb_${randomBytes(32).toString("hex")}`;
  const hash  = createHash("sha256").update(plain).digest("hex");

  await db.apiToken.deleteMany({ where: { userId: session.user.id } });
  await db.apiToken.create({
    data: { userId: session.user.id, tokenHash: hash, name: "Extension Chrome" },
  });

  return NextResponse.json({ token: plain });
}

// DELETE — révoque
export async function DELETE(_req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  await db.apiToken.deleteMany({ where: { userId: session.user.id } });
  return NextResponse.json({ ok: true });
}
