"use client";

import { useEffect, useRef, useState } from "react";
import { Send, X, Search } from "lucide-react";
import { UserAvatar } from "@/components/social/UserAvatar";

type UserLite = { id: string; name: string | null; username: string | null; image: string | null };

// Bouton « Envoyer par message » d'une image (visionneuse) : choisit un membre,
// ouvre/récupère la conversation et envoie l'image.
export function SendImageButton({ imageId, className }: { imageId: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<UserLite[]>([]);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const r = await fetch(`/api/members?q=${encodeURIComponent(q.trim())}`);
      if (r.ok) setResults((await r.json()).members ?? []);
    }, 250);
  }, [q, open]);

  const send = async (userId: string) => {
    setBusy(userId);
    try {
      const c = await (await fetch("/api/conversations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId }) })).json();
      if (c.conversationId) {
        await fetch(`/api/conversations/${c.conversationId}/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sharedImageId: imageId }) });
        setSentTo(userId);
        setTimeout(() => setSentTo(null), 1500);
      }
    } finally { setBusy(null); }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Envoyer par message"
        className={className ?? "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] transition-colors"}
      >
        <Send size={14} strokeWidth={2} /> Envoyer
      </button>

      {open && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-4" role="dialog">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="relative w-full max-w-sm bg-[var(--bg-base)] border border-[var(--border-default)] rounded-2xl p-4 max-h-[70vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-[var(--text-primary)]">Envoyer l&apos;image à…</span>
              <button onClick={() => setOpen(false)} className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"><X size={18} /></button>
            </div>
            <div className="relative mb-2">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher un membre…" className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] focus:border-[var(--border-default)] text-[var(--text-primary)] text-sm rounded-md pl-8 pr-3 py-2 focus:outline-none placeholder:text-[var(--text-tertiary)]" />
            </div>
            <div className="divide-y divide-[var(--border-subtle)]">
              {results.map((m) => (
                <div key={m.id} className="flex items-center gap-2.5 py-2">
                  <UserAvatar name={m.name} username={m.username} image={m.image} size={32} />
                  <span className="flex-1 min-w-0 text-sm text-[var(--text-primary)] truncate">{m.name || `@${m.username}`}</span>
                  <button onClick={() => send(m.id)} disabled={busy === m.id} className="text-[11px] text-[var(--accent,#a78bfa)] hover:opacity-80 disabled:opacity-40">
                    {sentTo === m.id ? "Envoyé ✓" : "Envoyer"}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
