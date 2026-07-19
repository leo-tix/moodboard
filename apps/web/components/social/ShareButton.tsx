"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Share2, X, Lock, Users, Globe, Search, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/social/UserAvatar";

type Visibility = "PRIVATE" | "CONNECTIONS" | "PUBLIC";
type Role = "VIEWER" | "EDITOR";
type UserLite = { id: string; name: string | null; username: string | null; image: string | null };
type Grant = { user: UserLite; role: Role };

const VIS: { key: Visibility; label: string; hint: string; icon: typeof Lock }[] = [
  { key: "PRIVATE", label: "Privé", hint: "Toi seul", icon: Lock },
  { key: "CONNECTIONS", label: "Connexions", hint: "Tes connexions", icon: Users },
  { key: "PUBLIC", label: "Public", hint: "Tous les membres", icon: Globe },
];

// Panneau de partage unifié : visibilité (Privé/Connexions/Public) + accès
// nominatifs (personnes + rôle). `resource` = segment d'URL (moodboards/visits/
// collections). `allowEditor` : proposer le rôle Éditeur (co-édition câblée).
export function ShareButton({ resource, id, allowEditor = false, label = "Partager" }: { resource: string; id: string; allowEditor?: boolean; label?: string }) {
  const [open, setOpen] = useState(false);
  const [visibility, setVisibility] = useState<Visibility>("PRIVATE");
  const [grants, setGrants] = useState<Grant[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<UserLite[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/share/${resource}/${id}`);
      if (r.ok) { const d = await r.json(); setVisibility(d.visibility ?? "PRIVATE"); setGrants(d.grants ?? []); }
    } finally { setLoading(false); }
  }, [resource, id]);

  useEffect(() => { if (open) void load(); }, [open, load]);
  useEffect(() => {
    if (!open) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      if (!q.trim()) { setResults([]); return; }
      const r = await fetch(`/api/members?q=${encodeURIComponent(q.trim())}`);
      if (r.ok) setResults((await r.json()).members ?? []);
    }, 300);
  }, [q, open]);

  const changeVisibility = async (v: Visibility) => {
    setVisibility(v);
    await fetch(`/api/share/${resource}/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ visibility: v }) });
  };
  const addGrant = async (userId: string, role: Role) => {
    setBusy(userId);
    try { await fetch(`/api/share/${resource}/${id}/grants`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId, role }) }); await load(); }
    finally { setBusy(null); }
  };
  const removeGrant = async (userId: string) => {
    setBusy(userId);
    try { await fetch(`/api/share/${resource}/${id}/grants`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId }) }); await load(); }
    finally { setBusy(null); }
  };

  const grantedIds = new Set(grants.map((g) => g.user.id));

  // Envoi de la ressource en message à un membre (partage via messagerie).
  const grantResourceEnum = resource === "moodboards" ? "MOODBOARD" : resource === "visits" ? "VISIT" : "COLLECTION";
  const [sentTo, setSentTo] = useState<string | null>(null);
  const sendResource = async (userId: string) => {
    setBusy(userId);
    try {
      const r = await fetch("/api/conversations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId }) });
      const d = await r.json().catch(() => ({}));
      if (d.conversationId) {
        await fetch(`/api/conversations/${d.conversationId}/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sharedResource: grantResourceEnum, sharedResourceId: id }) });
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
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] transition-colors"
      >
        <Share2 size={14} strokeWidth={2} /> {label}
      </button>

      {open && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" role="dialog">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="relative w-full max-w-md bg-[var(--bg-base)] border border-[var(--border-default)] rounded-2xl shadow-2xl max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-subtle)] sticky top-0 bg-[var(--bg-base)]">
              <span className="text-sm font-medium text-[var(--text-primary)]">Partage</span>
              <button onClick={() => setOpen(false)} className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"><X size={18} /></button>
            </div>

            <div className="p-4 space-y-5">
              {/* Visibilité */}
              <div className="space-y-1.5">
                {VIS.map((v) => {
                  const active = visibility === v.key;
                  return (
                    <button
                      key={v.key}
                      onClick={() => changeVisibility(v.key)}
                      disabled={loading}
                      className={cn(
                        "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-colors",
                        active ? "border-[var(--border-default)] bg-[var(--bg-elevated)]" : "border-[var(--border-subtle)] hover:bg-[var(--bg-surface)]",
                      )}
                    >
                      <v.icon size={16} className="text-[var(--text-secondary)] shrink-0" />
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm text-[var(--text-primary)]">{v.label}</span>
                        <span className="block text-[11px] text-[var(--text-tertiary)]">{v.hint}</span>
                      </span>
                      {active && <Check size={16} className="text-[var(--accent,#a78bfa)]" />}
                    </button>
                  );
                })}
              </div>

              {/* Accès nominatifs */}
              <div className="space-y-2">
                <p className="text-[10px] uppercase tracking-widest text-[var(--text-tertiary)]">Personnes</p>
                {grants.map((g) => (
                  <div key={g.user.id} className="flex items-center gap-2.5">
                    <UserAvatar name={g.user.name} username={g.user.username} image={g.user.image} size={32} />
                    <span className="flex-1 min-w-0 text-sm text-[var(--text-primary)] truncate">{g.user.name || `@${g.user.username}`}</span>
                    {allowEditor ? (
                      <select
                        value={g.role}
                        disabled={busy === g.user.id}
                        onChange={(e) => addGrant(g.user.id, e.target.value as Role)}
                        className="text-xs bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-md px-1.5 py-1 text-[var(--text-secondary)]"
                      >
                        <option value="VIEWER">Lecteur</option>
                        <option value="EDITOR">Éditeur</option>
                      </select>
                    ) : (
                      <span className="text-[11px] text-[var(--text-tertiary)]">Lecteur</span>
                    )}
                    <button onClick={() => removeGrant(g.user.id)} disabled={busy === g.user.id} className="text-[var(--text-tertiary)] hover:text-red-400"><X size={15} /></button>
                  </div>
                ))}

                {/* Ajouter quelqu'un */}
                <div className="relative mt-1">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Ajouter une personne…"
                    className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] focus:border-[var(--border-default)] text-[var(--text-primary)] text-sm rounded-md pl-8 pr-3 py-2 focus:outline-none placeholder:text-[var(--text-tertiary)]"
                  />
                </div>
                {results.filter((m) => !grantedIds.has(m.id)).map((m) => (
                  <div key={m.id} className="flex items-center gap-2.5 px-1 py-1.5">
                    <UserAvatar name={m.name} username={m.username} image={m.image} size={30} />
                    <span className="flex-1 min-w-0 text-sm text-[var(--text-primary)] truncate">{m.name || `@${m.username}`}</span>
                    <button onClick={() => sendResource(m.id)} disabled={busy === m.id} className="text-[11px] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">
                      {sentTo === m.id ? "Envoyé ✓" : "Envoyer"}
                    </button>
                    <button onClick={() => { addGrant(m.id, "VIEWER"); setQ(""); setResults([]); }} disabled={busy === m.id} className="text-[11px] text-[var(--accent,#a78bfa)]">
                      Ajouter
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
