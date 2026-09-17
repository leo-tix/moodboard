import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { commentUpdateSchema } from "@/lib/validators/comment";
import {
  resolveCommentContext,
  isAuthor,
  commentSelect,
  toDTO,
} from "@/lib/moodboard/commentsServer";

interface Params { params: Promise<{ id: string; commentId: string }> }

// PATCH /api/moodboards/[id]/comments/[commentId][?token=…]
// - `body`     : l'auteur corrige son propre message ;
// - `resolved` : le propriétaire de la planche clôt un fil, ou son auteur.
//   Le drapeau ne vit que sur la racine — une réponse n'a pas d'état propre.
export async function PATCH(req: NextRequest, { params }: Params) {
  const { id, commentId } = await params;
  const ctx = await resolveCommentContext(req, id);
  if (!ctx) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const row = await db.moodboardComment.findFirst({
    where: { id: commentId, moodboardId: id },
    select: { id: true, authorId: true, guestKey: true, parentId: true },
  });
  if (!row) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const parsed = commentUpdateSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Données invalides" }, { status: 400 });
  }
  const { body, resolved } = parsed.data;

  const mine = isAuthor(row, ctx.actor);
  const isOwner = ctx.actor.kind === "owner";

  if (body !== undefined && !mine) {
    return NextResponse.json({ error: "Seul l'auteur peut modifier ce commentaire." }, { status: 403 });
  }
  if (resolved !== undefined) {
    if (!isOwner && !mine) {
      return NextResponse.json({ error: "Action réservée à l'auteur du fil et au propriétaire." }, { status: 403 });
    }
    if (row.parentId !== null) {
      return NextResponse.json({ error: "Seul un fil entier se résout." }, { status: 400 });
    }
  }

  const updated = await db.moodboardComment.update({
    where: { id: commentId },
    data: {
      ...(body !== undefined ? { body } : {}),
      ...(resolved !== undefined ? { resolved, resolvedAt: resolved ? new Date() : null } : {}),
    },
    select: commentSelect,
  });

  return NextResponse.json({ comment: toDTO(updated, ctx.actor) });
}

// DELETE /api/moodboards/[id]/comments/[commentId][?token=…]
// L'auteur supprime le sien ; le propriétaire de la planche supprime
// n'importe lequel (modération). Supprimer une racine emporte ses réponses
// (cascade Prisma sur parentId).
export async function DELETE(req: NextRequest, { params }: Params) {
  const { id, commentId } = await params;
  const ctx = await resolveCommentContext(req, id);
  if (!ctx) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const row = await db.moodboardComment.findFirst({
    where: { id: commentId, moodboardId: id },
    select: { id: true, authorId: true, guestKey: true },
  });
  if (!row) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  if (ctx.actor.kind !== "owner" && !isAuthor(row, ctx.actor)) {
    return NextResponse.json({ error: "Suppression non autorisée." }, { status: 403 });
  }

  await db.moodboardComment.delete({ where: { id: commentId } });
  return NextResponse.json({ ok: true });
}
