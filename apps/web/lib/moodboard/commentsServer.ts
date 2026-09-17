import { createHash } from "crypto";
import { db } from "@/lib/db";
import { auth } from "@/auth";
import { resolveAccess, canView } from "@/lib/access/resolve";
import { GUEST_TOKEN_HEADER, type CommentDTO, type CommentThread } from "@/lib/moodboard/comments";

// Résolution d'accès et garde-fous propres aux commentaires de planche.
//
// Deux chemins d'entrée coexistent :
//  - MEMBRE : session NextAuth + accès de lecture sur la planche (propriétaire,
//    éditeur, grant, visibilité) — c'est ce qui permet de voir les retours des
//    invités depuis l'éditeur ;
//  - INVITÉ : aucun compte, seulement le jeton du lien public dans l'URL. Il
//    doit être valide, non expiré, ET la planche doit avoir explicitement
//    ouvert les commentaires (allowComments).
//
// Le jeton anonyme du navigateur (en-tête x-guest-token) n'intervient JAMAIS
// dans l'autorisation d'accès : il ne sert qu'à reconnaître l'auteur de ses
// propres commentaires.

export type CommentActor =
  | { kind: "owner"; userId: string; name: string; image: string | null }
  | { kind: "member"; userId: string; name: string; image: string | null }
  | { kind: "guest"; guestKey: string | null };

export interface CommentContext {
  moodboardId: string;
  ownerId: string;
  /** Les commentaires sont-ils ouverts sur cette planche ? */
  allowComments: boolean;
  /** Le visiteur peut-il écrire (poster / répondre) ? */
  canWrite: boolean;
  actor: CommentActor;
}

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** Jeton anonyme du navigateur, haché. null si absent. */
export function guestKeyFrom(req: Request): string | null {
  const raw = req.headers.get(GUEST_TOKEN_HEADER)?.trim();
  if (!raw || raw.length < 8 || raw.length > 200) return null;
  return sha256(`guest:${raw}`);
}

/** IP de l'appelant derrière le proxy, hachée (anti-spam seulement). */
export function ipHashFrom(req: Request): string | null {
  const forwarded = req.headers.get("x-forwarded-for");
  const ip = forwarded ? forwarded.split(",")[0]!.trim() : req.headers.get("x-real-ip");
  return ip ? sha256(`ip:${ip}`) : null;
}

/**
 * Résout qui parle et ce qu'il a le droit de faire sur les commentaires d'une
 * planche. Retourne null si la planche est inaccessible au visiteur — la route
 * répond alors 404, sans distinguer « inexistante » de « interdite ».
 */
export async function resolveCommentContext(
  req: Request,
  moodboardId: string,
): Promise<CommentContext | null> {
  const moodboard = await db.moodboard.findUnique({
    where: { id: moodboardId },
    select: { id: true, userId: true, allowComments: true, shareToken: true, shareExpiry: true },
  });
  if (!moodboard) return null;

  const base = {
    moodboardId: moodboard.id,
    ownerId: moodboard.userId,
    allowComments: moodboard.allowComments,
  };

  // ── Membre connecté ──
  const session = await auth();
  if (session?.user?.id) {
    const access = await resolveAccess("MOODBOARD", moodboardId, session.user.id);
    if (canView(access)) {
      const user = await db.user.findUnique({
        where: { id: session.user.id },
        select: { name: true, username: true, image: true },
      });
      const name = user?.name || (user?.username ? `@${user.username}` : "Membre");
      return {
        ...base,
        // Le propriétaire et les éditeurs commentent toujours leur propre
        // planche, même quand les retours d'invités sont fermés.
        canWrite: true,
        actor:
          access === "owner"
            ? { kind: "owner", userId: session.user.id, name, image: user?.image ?? null }
            : { kind: "member", userId: session.user.id, name, image: user?.image ?? null },
      };
    }
  }

  // ── Invité par lien public ──
  const token = new URL(req.url).searchParams.get("token");
  if (!token || !moodboard.shareToken || token !== moodboard.shareToken) return null;
  if (moodboard.shareExpiry && moodboard.shareExpiry < new Date()) return null;

  return {
    ...base,
    canWrite: moodboard.allowComments,
    actor: { kind: "guest", guestKey: guestKeyFrom(req) },
  };
}

// ── Anti-spam ──────────────────────────────────────────────────────────────
// Les invités écrivent sans compte : on borne la cadence par IP et le volume
// total par planche, pour qu'un lien partagé largement ne puisse pas être noyé.

const GUEST_PER_MINUTE = 6;
const MAX_COMMENTS_PER_BOARD = 1000;

export async function guestWriteBlocked(
  moodboardId: string,
  ipHash: string | null,
): Promise<string | null> {
  const total = await db.moodboardComment.count({ where: { moodboardId } });
  if (total >= MAX_COMMENTS_PER_BOARD) {
    return "Cette planche a atteint son nombre maximal de commentaires.";
  }
  if (!ipHash) return null;

  const recent = await db.moodboardComment.count({
    where: { moodboardId, ipHash, createdAt: { gt: new Date(Date.now() - 60_000) } },
  });
  if (recent >= GUEST_PER_MINUTE) {
    return "Trop de commentaires d'affilée — réessaie dans une minute.";
  }
  return null;
}

// ── Sérialisation ──────────────────────────────────────────────────────────

/** Colonnes renvoyées au client — guestKey et ipHash restent au serveur. */
export const commentSelect = {
  id: true,
  parentId: true,
  x: true,
  y: true,
  body: true,
  authorName: true,
  authorId: true,
  guestKey: true,
  resolved: true,
  createdAt: true,
  updatedAt: true,
  author: { select: { image: true } },
} as const;

type CommentRow = {
  id: string;
  parentId: string | null;
  x: number | null;
  y: number | null;
  body: string;
  authorName: string;
  authorId: string | null;
  guestKey: string | null;
  resolved: boolean;
  createdAt: Date;
  updatedAt: Date;
  author: { image: string | null } | null;
};

/** Le visiteur est-il l'auteur de cette ligne ? (compte, ou même navigateur) */
export function isAuthor(row: { authorId: string | null; guestKey: string | null }, actor: CommentActor): boolean {
  if (actor.kind === "guest") return !!actor.guestKey && row.guestKey === actor.guestKey;
  return !!row.authorId && row.authorId === actor.userId;
}

export function toDTO(row: CommentRow, actor: CommentActor): CommentDTO {
  return {
    id: row.id,
    parentId: row.parentId,
    x: row.x,
    y: row.y,
    body: row.body,
    authorName: row.authorName,
    authorImage: row.author?.image ?? null,
    isMember: !!row.authorId,
    mine: isAuthor(row, actor),
    resolved: row.resolved,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Regroupe les lignes plates en fils (racine + réponses chronologiques). */
export function toThreads(rows: CommentRow[], actor: CommentActor): CommentThread[] {
  const roots = rows.filter((r) => r.parentId === null);
  const repliesByParent = new Map<string, CommentRow[]>();
  for (const r of rows) {
    if (!r.parentId) continue;
    const list = repliesByParent.get(r.parentId);
    if (list) list.push(r);
    else repliesByParent.set(r.parentId, [r]);
  }
  return roots.map((root) => ({
    ...toDTO(root, actor),
    replies: (repliesByParent.get(root.id) ?? []).map((r) => toDTO(r, actor)),
  }));
}
