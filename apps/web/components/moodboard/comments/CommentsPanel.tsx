"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, MessageSquarePlus, Trash2, X, Crosshair, Pencil } from "lucide-react";
import { UserAvatar } from "@/components/social/UserAvatar";
import {
  COMMENT_MAX_LENGTH,
  COMMENT_NAME_MAX_LENGTH,
  getGuestName,
  setGuestName,
  type CommentDTO,
  type CommentThread,
} from "@/lib/moodboard/comments";
import type { CommentsController } from "@/components/moodboard/comments/useComments";

// Panneau latéral des commentaires. Un seul composant sert l'éditeur et la
// visionneuse publique : ce qui change entre les deux, c'est l'identité de
// celui qui écrit (`viewerName` fixé pour un membre, saisi librement pour un
// invité) et les droits de modération (`isOwner`).

interface Props {
  controller: CommentsController;
  /** Nom imposé pour un membre connecté ; null → invité, il saisit le sien. */
  viewerName: string | null;
  /** Propriétaire de la planche : peut résoudre et supprimer n'importe quel fil. */
  isOwner: boolean;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Ancre du fil en cours de création (posée par un clic sur le canvas). */
  pendingPin: { x: number; y: number } | null;
  onCancelPending: () => void;
  /** Mode « poser une pastille » actif ? */
  placing: boolean;
  onTogglePlacing: () => void;
  /** Recentre la vue sur l'ancre d'un fil. */
  onFocusThread: (x: number, y: number) => void;
  onClose: () => void;
}

function relTime(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "à l'instant";
  const m = Math.floor(s / 60);
  if (m < 60) return `il y a ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `il y a ${d} j`;
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

// ── Saisie du nom (invités) ───────────────────────────────────────────────

function NameField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      maxLength={COMMENT_NAME_MAX_LENGTH}
      placeholder="Ton nom"
      className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] focus:border-[var(--border-default)] rounded-md px-2.5 py-1.5 text-xs text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
    />
  );
}

// ── Un message (racine ou réponse) ────────────────────────────────────────

function CommentBody({
  comment,
  canModerate,
  onEdit,
  onDelete,
}: {
  comment: CommentDTO;
  canModerate: boolean;
  onEdit: (body: string) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const body = draft.trim();
    if (!body || body === comment.body) { setEditing(false); return; }
    setBusy(true);
    try { await onEdit(body); setEditing(false); } finally { setBusy(false); }
  };

  return (
    <div className="flex gap-2.5">
      <UserAvatar name={comment.authorName} image={comment.authorImage} size={28} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-xs font-medium text-[var(--text-primary)] truncate">
            {comment.authorName}
          </span>
          {!comment.isMember && (
            <span className="text-[9px] uppercase tracking-wider text-[var(--text-tertiary)] border border-[var(--border-subtle)] rounded px-1 py-px shrink-0">
              invité
            </span>
          )}
          <span className="text-[10px] text-[var(--text-tertiary)] shrink-0">{relTime(comment.createdAt)}</span>
        </div>

        {editing ? (
          <div className="mt-1.5 space-y-1.5">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={COMMENT_MAX_LENGTH}
              rows={3}
              className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-md px-2.5 py-1.5 text-xs text-[var(--text-primary)] outline-none resize-none"
            />
            <div className="flex gap-2">
              <button onClick={save} disabled={busy} className="text-[11px] text-[var(--accent,#a78bfa)] disabled:opacity-50">
                Enregistrer
              </button>
              <button onClick={() => { setDraft(comment.body); setEditing(false); }} className="text-[11px] text-[var(--text-tertiary)]">
                Annuler
              </button>
            </div>
          </div>
        ) : (
          <p className="mt-0.5 text-xs text-[var(--text-secondary)] whitespace-pre-wrap break-words">
            {comment.body}
          </p>
        )}

        {!editing && (comment.mine || canModerate) && (
          <div className="mt-1 flex gap-2.5">
            {comment.mine && (
              <button onClick={() => setEditing(true)} className="text-[10px] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] flex items-center gap-1">
                <Pencil size={10} /> Modifier
              </button>
            )}
            <button
              onClick={() => { if (confirm("Supprimer ce commentaire ?")) void onDelete(); }}
              className="text-[10px] text-[var(--text-tertiary)] hover:text-red-400 flex items-center gap-1"
            >
              <Trash2 size={10} /> Supprimer
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Un fil complet ────────────────────────────────────────────────────────

function Thread({
  thread,
  index,
  selected,
  controller,
  viewerName,
  guestName,
  onGuestName,
  isOwner,
  onSelect,
  onFocusThread,
}: {
  thread: CommentThread;
  index: number;
  selected: boolean;
  controller: CommentsController;
  viewerName: string | null;
  guestName: string;
  onGuestName: (v: string) => void;
  isOwner: boolean;
  onSelect: () => void;
  onFocusThread: (x: number, y: number) => void;
}) {
  const [replyDraft, setReplyDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const author = viewerName ?? guestName.trim();
  const canReply = controller.canWrite;

  const sendReply = async () => {
    const body = replyDraft.trim();
    if (!body) return;
    if (!author) { setErr("Indique ton nom pour répondre."); return; }
    setBusy(true);
    setErr(null);
    try {
      if (!viewerName) setGuestName(author);
      await controller.reply(thread.id, { body, authorName: author });
      setReplyDraft("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Envoi impossible");
    } finally {
      setBusy(false);
    }
  };

  return (
    <li
      onClick={onSelect}
      className={[
        "px-3 py-3 border-b border-[var(--border-subtle)] cursor-pointer transition-colors",
        selected ? "bg-[var(--bg-surface)]" : "hover:bg-[var(--bg-surface)]/50",
        thread.resolved && !selected ? "opacity-55" : "",
      ].join(" ")}
    >
      <div className="flex items-center gap-2 mb-2">
        <span
          className={[
            "h-5 min-w-5 px-1 rounded-full rounded-bl-[2px] text-[10px] font-semibold flex items-center justify-center shrink-0",
            thread.resolved
              ? "bg-[var(--bg-elevated)] border border-[var(--border-default)] text-[var(--text-tertiary)]"
              : "bg-[var(--accent,#a78bfa)] text-[#1a1a1a]",
          ].join(" ")}
        >
          {index + 1}
        </span>
        {thread.resolved && <span className="text-[10px] text-[var(--text-tertiary)]">Résolu</span>}
        <span className="flex-1" />
        {thread.x !== null && thread.y !== null && (
          <button
            onClick={(e) => { e.stopPropagation(); onFocusThread(thread.x!, thread.y!); }}
            title="Centrer la vue sur cette pastille"
            className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
          >
            <Crosshair size={13} />
          </button>
        )}
        {(isOwner || thread.mine) && (
          <button
            onClick={(e) => { e.stopPropagation(); void controller.toggleResolved(thread.id, !thread.resolved); }}
            title={thread.resolved ? "Rouvrir le fil" : "Marquer comme résolu"}
            className={thread.resolved ? "text-[var(--accent,#a78bfa)]" : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"}
          >
            <Check size={14} />
          </button>
        )}
      </div>

      <CommentBody
        comment={thread}
        canModerate={isOwner}
        onEdit={(body) => controller.edit(thread.id, body)}
        onDelete={() => controller.remove(thread.id)}
      />

      {thread.replies.length > 0 && (
        <div className="mt-3 pl-3 border-l border-[var(--border-subtle)] space-y-3">
          {thread.replies.map((r) => (
            <CommentBody
              key={r.id}
              comment={r}
              canModerate={isOwner}
              onEdit={(body) => controller.edit(r.id, body)}
              onDelete={() => controller.remove(r.id)}
            />
          ))}
        </div>
      )}

      {selected && canReply && (
        <div className="mt-3 space-y-1.5" onClick={(e) => e.stopPropagation()}>
          {!viewerName && !guestName.trim() && <NameField value={guestName} onChange={onGuestName} />}
          <textarea
            value={replyDraft}
            onChange={(e) => setReplyDraft(e.target.value)}
            maxLength={COMMENT_MAX_LENGTH}
            rows={2}
            placeholder="Répondre…"
            className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] focus:border-[var(--border-default)] rounded-md px-2.5 py-1.5 text-xs text-[var(--text-primary)] outline-none resize-none placeholder:text-[var(--text-tertiary)]"
          />
          {err && <p className="text-[10px] text-red-400">{err}</p>}
          <button
            onClick={sendReply}
            disabled={busy || !replyDraft.trim()}
            className="text-[11px] text-[var(--accent,#a78bfa)] disabled:opacity-40"
          >
            {busy ? "Envoi…" : "Répondre"}
          </button>
        </div>
      )}
    </li>
  );
}

// ── Panneau ───────────────────────────────────────────────────────────────

export function CommentsPanel({
  controller,
  viewerName,
  isOwner,
  selectedId,
  onSelect,
  pendingPin,
  onCancelPending,
  placing,
  onTogglePlacing,
  onFocusThread,
  onClose,
}: Props) {
  const { threads, loading, error, canWrite } = controller;
  const [showResolved, setShowResolved] = useState(false);
  // Nom mémorisé du navigateur, lu à la construction : le panneau n'est monté
  // qu'après un clic, donc jamais rendu côté serveur — pas d'écart d'hydratation.
  const [guestName, setName] = useState(() => (viewerName ? "" : getGuestName()));
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const draftRef = useRef<HTMLTextAreaElement>(null);

  // Le composeur s'ouvre avec l'ancre : on donne le focus tout de suite.
  useEffect(() => { if (pendingPin) draftRef.current?.focus(); }, [pendingPin]);

  // La numérotation des pastilles suit l'ordre de création, quel que soit le
  // filtre : le numéro affiché sur le canvas et celui de la liste concordent.
  const numbered = useMemo(() => threads.map((t, i) => ({ thread: t, index: i })), [threads]);
  const visible = showResolved ? numbered : numbered.filter((n) => !n.thread.resolved);
  const resolvedCount = threads.filter((t) => t.resolved).length;

  const author = viewerName ?? guestName.trim();

  const submit = async () => {
    const body = draft.trim();
    if (!body || !pendingPin) return;
    if (!author) { setErr("Indique ton nom pour commenter."); return; }
    setBusy(true);
    setErr(null);
    try {
      if (!viewerName) setGuestName(author);
      const created = await controller.add({ ...pendingPin, body, authorName: author });
      setDraft("");
      onCancelPending();
      onSelect(created.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Envoi impossible");
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="flex-shrink-0 w-72 border-l border-[var(--border-subtle)] bg-[var(--bg-base)] flex flex-col overflow-hidden">
      {/* En-tête */}
      <div className="flex items-center gap-2 px-3 h-11 border-b border-[var(--border-subtle)] flex-shrink-0">
        <span className="text-xs font-medium text-[var(--text-primary)]">Commentaires</span>
        <span className="text-[10px] text-[var(--text-tertiary)]">
          {threads.length - resolvedCount} ouvert{threads.length - resolvedCount > 1 ? "s" : ""}
        </span>
        <span className="flex-1" />
        <button onClick={onClose} className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)]" title="Fermer">
          <X size={15} />
        </button>
      </div>

      {/* Action : poser une pastille */}
      {canWrite && (
        <div className="px-3 py-2.5 border-b border-[var(--border-subtle)] flex-shrink-0">
          <button
            onClick={onTogglePlacing}
            className={[
              "w-full flex items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-[11px] transition-colors",
              placing || pendingPin
                ? "border-[var(--accent,#a78bfa)] bg-[var(--accent,#a78bfa)]/15 text-[var(--accent,#a78bfa)]"
                : "border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)]",
            ].join(" ")}
          >
            <MessageSquarePlus size={13} />
            {placing || pendingPin ? "Clique sur la planche…" : "Épingler un commentaire"}
          </button>
        </div>
      )}

      {/* Composeur du nouveau fil */}
      {pendingPin && (
        <div className="px-3 py-3 border-b border-[var(--border-subtle)] space-y-2 bg-[var(--bg-surface)]/40 flex-shrink-0">
          {!viewerName && <NameField value={guestName} onChange={setName} />}
          <textarea
            ref={draftRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={COMMENT_MAX_LENGTH}
            rows={3}
            placeholder="Ton commentaire…"
            className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] focus:border-[var(--border-default)] rounded-md px-2.5 py-1.5 text-xs text-[var(--text-primary)] outline-none resize-none placeholder:text-[var(--text-tertiary)]"
          />
          {err && <p className="text-[10px] text-red-400">{err}</p>}
          <div className="flex gap-2">
            <button
              onClick={submit}
              disabled={busy || !draft.trim()}
              className="flex-1 rounded-md bg-[var(--accent,#a78bfa)] text-[#1a1a1a] text-[11px] font-medium py-1.5 disabled:opacity-40"
            >
              {busy ? "Envoi…" : "Publier"}
            </button>
            <button
              onClick={() => { setDraft(""); setErr(null); onCancelPending(); }}
              className="px-3 text-[11px] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
            >
              Annuler
            </button>
          </div>
        </div>
      )}

      {/* Liste */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <p className="px-3 py-6 text-[11px] text-[var(--text-tertiary)] text-center">Chargement…</p>
        ) : error ? (
          <p className="px-3 py-6 text-[11px] text-red-400 text-center">{error}</p>
        ) : visible.length === 0 ? (
          <p className="px-4 py-8 text-[11px] text-[var(--text-tertiary)] text-center leading-relaxed">
            {threads.length === 0
              ? canWrite
                ? "Aucun commentaire. Épingle-en un en cliquant sur la planche."
                : "Aucun commentaire pour l'instant."
              : "Tous les fils sont résolus."}
          </p>
        ) : (
          <ul>
            {visible.map(({ thread, index }) => (
              <Thread
                key={thread.id}
                thread={thread}
                index={index}
                selected={thread.id === selectedId}
                controller={controller}
                viewerName={viewerName}
                guestName={guestName}
                onGuestName={setName}
                isOwner={isOwner}
                onSelect={() => onSelect(thread.id === selectedId ? null : thread.id)}
                onFocusThread={onFocusThread}
              />
            ))}
          </ul>
        )}
      </div>

      {/* Pied : filtre des fils résolus */}
      {resolvedCount > 0 && (
        <button
          onClick={() => setShowResolved((v) => !v)}
          className="flex-shrink-0 border-t border-[var(--border-subtle)] px-3 py-2 text-[10px] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] text-left"
        >
          {showResolved ? "Masquer" : "Afficher"} les {resolvedCount} fil{resolvedCount > 1 ? "s" : ""} résolu{resolvedCount > 1 ? "s" : ""}
        </button>
      )}
    </aside>
  );
}
