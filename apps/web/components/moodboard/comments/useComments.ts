"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchComments,
  createComment,
  patchComment,
  deleteComment,
  type CommentThread,
} from "@/lib/moodboard/comments";

// État partagé des commentaires d'une planche — utilisé à l'identique par
// l'éditeur (le propriétaire lit les retours) et par la visionneuse publique
// (l'invité les écrit). `shareToken` est non nul uniquement dans le second cas :
// c'est lui qui autorise l'invité auprès de l'API.

interface Options {
  moodboardId: string;
  shareToken: string | null;
  /** false → aucun appel réseau (commentaires fermés et rien à afficher). */
  enabled: boolean;
}

/** Rafraîchissement d'arrière-plan : les retours arrivent pendant qu'on travaille. */
const POLL_MS = 30_000;

export function useMoodboardComments({ moodboardId, shareToken, enabled }: Options) {
  const [threads, setThreads] = useState<CommentThread[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  // Le serveur a le dernier mot sur le droit d'écrire (lien expiré, retours
  // refermés entre-temps) — on ne s'appuie pas seulement sur la prop initiale.
  const [canWrite, setCanWrite] = useState(false);
  const busyRef = useRef(false);

  // Premier chargement. `enabled` est figé à la vie du composant (il vient des
  // props de page), donc l'état initial suffit au cas désactivé : rien à
  // remettre à zéro ici.
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetchComments(moodboardId, shareToken)
      .then(({ comments, canWrite: w }) => {
        if (cancelled) return;
        setThreads(comments);
        setCanWrite(w);
        setError(null);
      })
      .catch(() => { if (!cancelled) setError("Commentaires indisponibles"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [moodboardId, shareToken, enabled]);

  // Sondage léger, en pause quand l'onglet est masqué ou pendant une écriture
  // (sinon la réponse du sondage écraserait la mise à jour optimiste en cours).
  useEffect(() => {
    if (!enabled) return;
    const tick = () => {
      if (document.visibilityState !== "visible" || busyRef.current) return;
      void fetchComments(moodboardId, shareToken)
        .then(({ comments, canWrite: w }) => { setThreads(comments); setCanWrite(w); })
        .catch(() => { /* réseau : on retentera au prochain tour */ });
    };
    const i = window.setInterval(tick, POLL_MS);
    window.addEventListener("focus", tick);
    return () => { window.clearInterval(i); window.removeEventListener("focus", tick); };
  }, [moodboardId, shareToken, enabled]);

  const guard = useCallback(async <T,>(fn: () => Promise<T>): Promise<T> => {
    busyRef.current = true;
    try { return await fn(); } finally { busyRef.current = false; }
  }, []);

  /** Nouveau fil épinglé en (x, y). */
  const add = useCallback(
    (input: { x: number; y: number; body: string; authorName: string }) =>
      guard(async () => {
        const thread = await createComment(moodboardId, shareToken, input);
        setThreads((prev) => [...prev, { ...thread, replies: [] }]);
        return thread;
      }),
    [moodboardId, shareToken, guard],
  );

  const reply = useCallback(
    (parentId: string, input: { body: string; authorName: string }) =>
      guard(async () => {
        const created = await createComment(moodboardId, shareToken, { ...input, parentId });
        setThreads((prev) =>
          prev.map((t) => (t.id === parentId ? { ...t, replies: [...t.replies, created] } : t)),
        );
        return created;
      }),
    [moodboardId, shareToken, guard],
  );

  const edit = useCallback(
    (commentId: string, body: string) =>
      guard(async () => {
        const updated = await patchComment(moodboardId, shareToken, commentId, { body });
        setThreads((prev) =>
          prev.map((t) =>
            t.id === commentId
              ? { ...t, ...updated }
              : { ...t, replies: t.replies.map((r) => (r.id === commentId ? { ...r, ...updated } : r)) },
          ),
        );
      }),
    [moodboardId, shareToken, guard],
  );

  const toggleResolved = useCallback(
    (threadId: string, resolved: boolean) =>
      guard(async () => {
        const updated = await patchComment(moodboardId, shareToken, threadId, { resolved });
        setThreads((prev) => prev.map((t) => (t.id === threadId ? { ...t, ...updated } : t)));
      }),
    [moodboardId, shareToken, guard],
  );

  const remove = useCallback(
    (commentId: string) =>
      guard(async () => {
        await deleteComment(moodboardId, shareToken, commentId);
        setThreads((prev) =>
          prev
            .filter((t) => t.id !== commentId)
            .map((t) => ({ ...t, replies: t.replies.filter((r) => r.id !== commentId) })),
        );
      }),
    [moodboardId, shareToken, guard],
  );

  return { threads, loading, error, canWrite, add, reply, edit, remove, toggleResolved };
}

export type CommentsController = ReturnType<typeof useMoodboardComments>;
