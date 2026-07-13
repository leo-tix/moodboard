import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { z } from "zod";
import { unclaimBlockFromAllColumns } from "@/lib/visits/columnsUtil";

interface Params { params: Promise<{ id: string; quoteId: string }> }

// PATCH /api/visits/[id]/quotes/[quoteId]
export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id, quoteId } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = z.object({ content: z.string().max(4000) }).safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const owned = await db.visit.findFirst({ where: { id, userId: session.user.id }, select: { id: true } });
  if (!owned) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const quote = await db.visitQuote.findUnique({ where: { id: quoteId } });
  if (!quote || quote.visitId !== id) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const updated = await db.visitQuote.update({ where: { id: quoteId }, data: { content: parsed.data.content } });
  return NextResponse.json(updated);
}

// DELETE /api/visits/[id]/quotes/[quoteId]
export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id, quoteId } = await params;
  const owned = await db.visit.findFirst({ where: { id, userId: session.user.id }, select: { id: true } });
  if (!owned) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const quote = await db.visitQuote.findUnique({ where: { id: quoteId } });
  if (!quote || quote.visitId !== id) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  await db.visitQuote.delete({ where: { id: quoteId } });
  // Retire aussi la citation d'une colonne qui la réclamait, sinon la
  // colonne pointe vers un bloc supprimé.
  await unclaimBlockFromAllColumns(id, "QUOTE", quoteId);
  return NextResponse.json({ ok: true });
}
