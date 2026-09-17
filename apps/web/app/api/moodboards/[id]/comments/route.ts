import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { commentCreateSchema } from "@/lib/validators/comment";
import {
  resolveCommentContext,
  guestWriteBlocked,
  ipHashFrom,
  commentSelect,
  toDTO,
  toThreads,
} from "@/lib/moodboard/commentsServer";

interface Params { params: Promise<{ id: string }> }

// GET /api/moodboards/[id]/comments[?token=<lien public>]
// Fils de commentaires d'une planche. Accessible au membre qui peut la voir
// (c'est ce qui affiche les retours d'invités dans l'éditeur) et à l'invité
// porteur d'un lien public valide.
export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const ctx = await resolveCommentContext(req, id);
  if (!ctx) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const rows = await db.moodboardComment.findMany({
    where: { moodboardId: id },
    select: commentSelect,
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({
    comments: toThreads(rows, ctx.actor),
    allowComments: ctx.allowComments,
    canWrite: ctx.canWrite,
  });
}

// POST /api/moodboards/[id]/comments[?token=…] — nouveau fil (x/y requis) ou
// réponse (parentId requis).
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const ctx = await resolveCommentContext(req, id);
  if (!ctx) return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  if (!ctx.canWrite) {
    return NextResponse.json({ error: "Les commentaires sont fermés sur cette planche." }, { status: 403 });
  }

  const parsed = commentCreateSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Données invalides" }, { status: 400 });
  }
  const { body, authorName, x, y, parentId } = parsed.data;

  const ipHash = ipHashFrom(req);
  if (ctx.actor.kind === "guest") {
    const blocked = await guestWriteBlocked(id, ipHash);
    if (blocked) return NextResponse.json({ error: blocked }, { status: 429 });
  }

  // Une réponse doit viser un commentaire RACINE de CETTE planche : sans ce
  // contrôle, un parentId forgé rattacherait le message à une autre planche
  // (fuite par rebond) ou créerait un fil imbriqué que l'interface ne sait
  // pas afficher.
  if (parentId) {
    const parent = await db.moodboardComment.findFirst({
      where: { id: parentId, moodboardId: id, parentId: null },
      select: { id: true },
    });
    if (!parent) return NextResponse.json({ error: "Fil introuvable" }, { status: 404 });
  }

  // Un membre signe de son nom de compte : il ne choisit pas une identité
  // arbitraire. Seul un invité, qui n'a pas de compte, se nomme lui-même.
  const identity =
    ctx.actor.kind === "guest"
      ? { authorName, authorId: null, guestKey: ctx.actor.guestKey }
      : { authorName: ctx.actor.name, authorId: ctx.actor.userId, guestKey: null };

  const row = await db.moodboardComment.create({
    data: {
      moodboardId: id,
      parentId: parentId ?? null,
      x: parentId ? null : x!,
      y: parentId ? null : y!,
      body,
      ...identity,
      ipHash,
    },
    select: commentSelect,
  });

  return NextResponse.json({ comment: { ...toDTO(row, ctx.actor), replies: [] } }, { status: 201 });
}
