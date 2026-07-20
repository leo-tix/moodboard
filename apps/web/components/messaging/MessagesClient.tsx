"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Send, ImageIcon, LayoutDashboard } from "lucide-react";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/social/UserAvatar";

type UserLite = { id: string; name: string | null; username: string | null; image: string | null };
type Convo = { id: string; status: string; isRequest: boolean; other: UserLite | null; last: { body: string | null; senderId: string; sharedResource: string | null; sharedImageId: string | null } | null; unread: number };
type Msg = { id: string; mine: boolean; body: string | null; createdAt: string; image: string | null; imageId: string | null; resource: { label: string; href: string } | null };
type GalleryImg = { imageId: string; title: string; url: string };
type Thread = { conversation: { id: string; status: string; isRequest: boolean; other: UserLite | null }; messages: Msg[] };

export function MessagesClient({ initialConversationId }: { initialConversationId?: string }) {
  const [convos, setConvos] = useState<Convo[]>([]);
  const [selected, setSelected] = useState<string | null>(initialConversationId ?? null);
  const [thread, setThread] = useState<Thread | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const loadConvos = useCallback(async () => {
    const r = await fetch("/api/conversations");
    if (r.ok) setConvos((await r.json()).conversations ?? []);
  }, []);
  const loadThread = useCallback(async (id: string) => {
    const r = await fetch(`/api/conversations/${id}`);
    if (r.ok) { setThread(await r.json()); void loadConvos(); }
  }, [loadConvos]);

  useEffect(() => { void loadConvos(); }, [loadConvos]);
  useEffect(() => { if (selected) void loadThread(selected); else setThread(null); }, [selected, loadThread]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [thread?.messages.length]);

  const send = async () => {
    if (!selected || !text.trim()) return;
    setBusy(true);
    try {
      await fetch(`/api/conversations/${selected}/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body: text.trim() }) });
      setText("");
      await loadThread(selected);
    } finally { setBusy(false); }
  };
  const accept = async () => {
    if (!selected) return;
    await fetch(`/api/conversations/${selected}`, { method: "PATCH" });
    await loadThread(selected);
  };

  // ── Joindre une image depuis la galerie ──
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [gallery, setGallery] = useState<GalleryImg[]>([]);
  const openGallery = async () => {
    setGalleryOpen(true);
    const r = await fetch("/api/gallery");
    if (r.ok) setGallery((await r.json()).images ?? []);
  };
  const sendImage = async (imageId: string) => {
    if (!selected) return;
    setGalleryOpen(false);
    await fetch(`/api/conversations/${selected}/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sharedImageId: imageId }) });
    await loadThread(selected);
  };

  // ── Enregistrer une image reçue dans ma galerie ──
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const saveToGallery = async (imageId: string) => {
    const r = await fetch(`/api/images/${imageId}/save`, { method: "POST" });
    if (r.ok) setSaved((s) => new Set(s).add(imageId));
  };

  // ── Fil ──
  if (selected && thread) {
    const o = thread.conversation.other;
    return (
      <div className="flex flex-col h-[calc(100vh-8rem)]">
        <div className="flex items-center gap-2.5 pb-3 border-b border-[var(--border-subtle)]">
          <button onClick={() => setSelected(null)} className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] md:hidden"><ArrowLeft size={18} /></button>
          {o && <UserAvatar name={o.name} username={o.username} image={o.image} size={32} />}
          <div className="min-w-0">
            {o?.username ? <Link href={`/u/${o.username}`} className="text-sm text-[var(--text-primary)] hover:underline">{o.name || `@${o.username}`}</Link> : <span className="text-sm text-[var(--text-primary)]">{o?.name || "Membre"}</span>}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto py-4 space-y-2">
          {thread.messages.map((m) => (
            <div key={m.id} className={cn("flex", m.mine ? "justify-end" : "justify-start")}>
              <div className={cn("max-w-[75%] rounded-2xl px-3 py-2 text-sm", m.mine ? "bg-[var(--text-primary)] text-[var(--bg-base)]" : "bg-[var(--bg-elevated)] text-[var(--text-primary)]")}>
                {m.image && (
                  <div className="mb-1">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={m.image} alt="" className="rounded-lg max-h-56 object-cover" />
                    {!m.mine && m.imageId && (
                      <button onClick={() => saveToGallery(m.imageId!)} className="mt-1 text-[11px] text-[var(--accent,#a78bfa)] hover:opacity-80">
                        {saved.has(m.imageId) ? "Ajoutée à ta galerie ✓" : "+ Ajouter à ma galerie"}
                      </button>
                    )}
                  </div>
                )}
                {m.resource && (
                  <Link href={m.resource.href} className={cn("flex items-center gap-1.5 mb-1 text-xs underline", m.mine ? "text-[var(--bg-base)]" : "text-[var(--accent,#a78bfa)]")}>
                    <LayoutDashboard size={13} /> {m.resource.label}
                  </Link>
                )}
                {m.body && <span className="whitespace-pre-wrap break-words">{m.body}</span>}
              </div>
            </div>
          ))}
          {thread.messages.length === 0 && <p className="text-center text-xs text-[var(--text-tertiary)] py-8">Début de la conversation.</p>}
          <div ref={endRef} />
        </div>

        {thread.conversation.isRequest ? (
          <div className="border-t border-[var(--border-subtle)] pt-3 flex items-center justify-between gap-3">
            <span className="text-xs text-[var(--text-tertiary)]">Cette personne veut te contacter.</span>
            <button onClick={accept} className="px-3.5 py-2 rounded-lg text-sm font-medium bg-[var(--text-primary)] text-[var(--bg-base)]">Accepter</button>
          </div>
        ) : (
          <div className="border-t border-[var(--border-subtle)] pt-3 flex items-center gap-2">
            <button onClick={openGallery} title="Joindre une image" className="w-9 h-9 rounded-full border border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] flex items-center justify-center shrink-0"><ImageIcon size={16} /></button>
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
              placeholder="Message…"
              className="flex-1 bg-[var(--bg-surface)] border border-[var(--border-subtle)] focus:border-[var(--border-default)] text-[var(--text-primary)] text-sm rounded-full px-4 py-2 focus:outline-none placeholder:text-[var(--text-tertiary)]"
            />
            <button onClick={send} disabled={busy || !text.trim()} className="w-9 h-9 rounded-full bg-[var(--text-primary)] text-[var(--bg-base)] flex items-center justify-center disabled:opacity-40"><Send size={16} /></button>
          </div>
        )}

        {/* Sélecteur de galerie pour joindre une image */}
        {galleryOpen && (
          <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center p-4" role="dialog">
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setGalleryOpen(false)} />
            <div className="relative w-full max-w-lg max-h-[70vh] overflow-y-auto bg-[var(--bg-base)] border border-[var(--border-default)] rounded-2xl p-4">
              <p className="text-sm font-medium text-[var(--text-primary)] mb-3">Joindre une image</p>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {gallery.map((g) => (
                  <button key={g.imageId} onClick={() => sendImage(g.imageId)} className="aspect-square rounded-lg overflow-hidden bg-[var(--bg-elevated)] border border-[var(--border-subtle)] hover:border-[var(--border-default)]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={g.url} alt={g.title} className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
              {gallery.length === 0 && <p className="text-xs text-[var(--text-tertiary)] py-6 text-center">Aucune image dans ta galerie.</p>}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Inbox ──
  return (
    <div className="divide-y divide-[var(--border-subtle)]">
      {convos.map((c) => (
        <button key={c.id} onClick={() => setSelected(c.id)} className="w-full flex items-center gap-3 py-3 text-left hover:bg-[var(--bg-surface)] px-1 rounded-md transition-colors">
          {c.other && <UserAvatar name={c.other.name} username={c.other.username} image={c.other.image} size={40} />}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm text-[var(--text-primary)] truncate">{c.other?.name || `@${c.other?.username}`}</span>
              {c.isRequest && <span className="text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-[var(--bg-elevated)] text-[var(--text-tertiary)]">Demande</span>}
            </div>
            <span className="block text-xs text-[var(--text-tertiary)] truncate">
              {c.last ? (c.last.sharedImageId ? "📷 Image" : c.last.sharedResource ? "Ressource partagée" : c.last.body) : "Nouvelle conversation"}
            </span>
          </div>
          {c.unread > 0 && <span className="w-5 h-5 rounded-full bg-[var(--accent,#a78bfa)] text-white text-[10px] flex items-center justify-center">{c.unread}</span>}
        </button>
      ))}
      {convos.length === 0 && <p className="text-sm text-[var(--text-tertiary)] py-8 text-center">Aucune conversation. Écris à un membre depuis son profil.</p>}
    </div>
  );
}
