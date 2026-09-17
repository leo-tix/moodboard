// Commentaires épinglés sur une planche — types partagés client/serveur et
// gestion de l'identité « invité ».
//
// Un invité (arrivé par le lien public /share/<token>) n'a pas de compte : il
// se nomme lui-même et son navigateur tire un jeton anonyme, conservé en
// localStorage. Ce jeton n'est JAMAIS un identifiant de session — il ne donne
// aucun accès à la planche ; il sert uniquement à prouver « ce commentaire,
// c'est moi qui l'ai écrit » pour le modifier ou le supprimer ensuite. Le
// serveur n'en garde que le SHA-256 (MoodboardComment.guestKey).

/** Un commentaire tel que renvoyé par l'API (jamais guestKey ni ipHash). */
export interface CommentDTO {
  id: string;
  parentId: string | null;
  /** Ancre canvas — racine uniquement. */
  x: number | null;
  y: number | null;
  body: string;
  authorName: string;
  /** Avatar (storageKey R2) quand l'auteur est un membre ; null pour un invité. */
  authorImage: string | null;
  /** true = l'auteur est un membre connecté, false = invité anonyme. */
  isMember: boolean;
  /** true = l'auteur, c'est le visiteur courant (compte ou jeton invité). */
  mine: boolean;
  resolved: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Un fil : le commentaire racine épinglé + ses réponses, dans l'ordre. */
export interface CommentThread extends CommentDTO {
  replies: CommentDTO[];
}

export const COMMENT_MAX_LENGTH = 2000;
export const COMMENT_NAME_MAX_LENGTH = 60;

// ── Identité invité (navigateur) ───────────────────────────────────────────

const GUEST_TOKEN_KEY = "moodboardGuestToken";
const GUEST_NAME_KEY = "moodboardGuestName";

/** En-tête qui transporte le jeton anonyme vers l'API. */
export const GUEST_TOKEN_HEADER = "x-guest-token";

/**
 * Jeton anonyme du navigateur, créé à la première utilisation. Retourne null
 * côté serveur ou si le stockage local est indisponible (navigation privée
 * verrouillée) — l'appelant retombe alors sur un commentaire non modifiable.
 */
export function getGuestToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const existing = window.localStorage.getItem(GUEST_TOKEN_KEY);
    if (existing) return existing;
    const token = crypto.randomUUID();
    window.localStorage.setItem(GUEST_TOKEN_KEY, token);
    return token;
  } catch {
    return null;
  }
}

/** Nom mémorisé de l'invité, pour ne pas le redemander à chaque commentaire. */
export function getGuestName(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(GUEST_NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setGuestName(name: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(GUEST_NAME_KEY, name.slice(0, COMMENT_NAME_MAX_LENGTH));
  } catch {
    /* stockage indisponible — le nom sera redemandé, rien de cassé */
  }
}

// ── Appels API ─────────────────────────────────────────────────────────────

function headers(): HeadersInit {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  const token = getGuestToken();
  if (token) h[GUEST_TOKEN_HEADER] = token;
  return h;
}

/** `?token=` n'est présent que pour un invité (lien public). */
function url(moodboardId: string, shareToken: string | null, suffix = ""): string {
  const base = `/api/moodboards/${moodboardId}/comments${suffix}`;
  return shareToken ? `${base}?token=${encodeURIComponent(shareToken)}` : base;
}

export interface CommentsPayload {
  comments: CommentThread[];
  /** Le visiteur peut-il écrire ? Le serveur tranche (lien expiré, retours refermés). */
  canWrite: boolean;
}

export async function fetchComments(
  moodboardId: string,
  shareToken: string | null,
): Promise<CommentsPayload> {
  const res = await fetch(url(moodboardId, shareToken), { headers: headers(), cache: "no-store" });
  if (!res.ok) throw new Error("Chargement des commentaires impossible");
  const data = await res.json();
  return { comments: data.comments ?? [], canWrite: !!data.canWrite };
}

export async function createComment(
  moodboardId: string,
  shareToken: string | null,
  input: { body: string; authorName: string; x?: number; y?: number; parentId?: string },
): Promise<CommentThread> {
  const res = await fetch(url(moodboardId, shareToken), {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(input),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Envoi impossible");
  return data.comment;
}

export async function patchComment(
  moodboardId: string,
  shareToken: string | null,
  commentId: string,
  input: { body?: string; resolved?: boolean },
): Promise<CommentDTO> {
  const res = await fetch(url(moodboardId, shareToken, `/${commentId}`), {
    method: "PATCH",
    headers: headers(),
    body: JSON.stringify(input),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Modification impossible");
  return data.comment;
}

export async function deleteComment(
  moodboardId: string,
  shareToken: string | null,
  commentId: string,
): Promise<void> {
  const res = await fetch(url(moodboardId, shareToken, `/${commentId}`), {
    method: "DELETE",
    headers: headers(),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? "Suppression impossible");
  }
}
