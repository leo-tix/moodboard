import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { canEditResource } from "@/lib/access/resolve";
import { z } from "zod";

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

  if (!(await canEditResource("VISIT", id, session.user.id))) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

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
  if (!(await canEditResource("VISIT", id, session.user.id))) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const quote = await db.visitQuote.findUnique({ where: { id: quoteId } });
  if (!quote || quote.visitId !== id) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  await db.visitQuote.delete({ where: { id: quoteId } });
  return NextResponse.json({ ok: true });
}
