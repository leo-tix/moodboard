"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Search, UserPlus, Check, X, Clock } from "lucide-react";
import { UserAvatar } from "@/components/social/UserAvatar";

type UserLite = { id: string; name: string | null; username: string | null; image: string | null };
type Entry = { connectionId: string; user: UserLite; since: string };
type Conns = { connections: Entry[]; incoming: Entry[]; outgoing: Entry[] };
type Member = UserLite & { relation: "connected" | "incoming" | "outgoing" | "none" };
type Rel = { rel: Member["relation"]; connId?: string };

const ghost =
  "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] disabled:opacity-40 transition-colors";
const primary =
  "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--text-primary)] text-[var(--bg-base)] hover:opacity-90 disabled:opacity-40 transition-opacity";

export function NetworkClient() {
  const [conns, setConns] = useState<Conns | null>(null);
  const [q, setQ] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadConns = useCallback(async () => {
    const r = await fetch("/api/connections");
    if (r.ok) setConns(await r.json());
  }, []);

  const search = useCallback(async (value: string) => {
    const r = await fetch(`/api/members?q=${encodeURIComponent(value)}`);
    if (r.ok) setMembers((await r.json()).members ?? []);
  }, []);

  useEffect(() => { void loadConns(); }, [loadConns]);
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => void search(q.trim()), 300);
  }, [q, search]);

  // Map userId → relation + connectionId (source fiable = mes connexions chargées).
  const relOf = (id: string): Rel => {
    if (!conns) return { rel: "none" };
    for (const e of conns.connections) if (e.user.id === id) return { rel: "connected", connId: e.connectionId };
    for (const e of conns.incoming) if (e.user.id === id) return { rel: "incoming", connId: e.connectionId };
    for (const e of conns.outgoing) if (e.user.id === id) return { rel: "outgoing", connId: e.connectionId };
    return { rel: "none" };
  };

  const act = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try { await fn(); await loadConns(); await search(q.trim()); } finally { setBusy(null); }
  };
  const connect = (userId: string) =>
    act("c" + userId, async () => {
      await fetch("/api/connections", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId }) });
    });
  const respond = (connId: string, action: "accept" | "decline") =>
    act(connId, async () => {
      await fetch(`/api/connections/${connId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
    });
  const remove = (connId: string) =>
    act(connId, async () => { await fetch(`/api/connections/${connId}`, { method: "DELETE" }); });

  const Row = ({ u, right }: { u: UserLite; right: React.ReactNode }) => (
    <div className="flex items-center gap-3 py-2">
      <UserAvatar name={u.name} username={u.username} image={u.image} size={38} />
      <div className="min-w-0 flex-1">
        {u.username ? (
          <Link href={`/u/${u.username}`} className="block text-sm text-[var(--text-primary)] truncate hover:underline">
            {u.name || `@${u.username}`}
          </Link>
        ) : (
          <span className="block text-sm text-[var(--text-primary)] truncate">{u.name || "Sans nom"}</span>
        )}
        {u.username && <span className="block text-[11px] text-[var(--text-tertiary)] truncate">@{u.username}</span>}
      </div>
      <div className="flex-shrink-0">{right}</div>
    </div>
  );

  const memberAction = (m: Member) => {
    const { rel, connId } = relOf(m.id);
    if (rel === "connected") return <span className="text-xs text-[var(--text-tertiary)] inline-flex items-center gap-1"><Check size={13} /> Connecté</span>;
    if (rel === "outgoing" && connId) return <button className={ghost} disabled={busy === connId} onClick={() => remove(connId)}><Clock size={13} /> Envoyée</button>;
    if (rel === "incoming" && connId)
      return (
        <span className="inline-flex gap-1.5">
          <button className={primary} disabled={busy === connId} onClick={() => respond(connId, "accept")}><Check size={13} /> Accepter</button>
          <button className={ghost} disabled={busy === connId} onClick={() => respond(connId, "decline")}><X size={13} /></button>
        </span>
      );
    return <button className={primary} disabled={busy === "c" + m.id} onClick={() => connect(m.id)}><UserPlus size={13} /> Se connecter</button>;
  };

  const section = (title: string, count: number, children: React.ReactNode) =>
    count > 0 ? (
      <section className="space-y-0.5">
        <p className="text-[10px] uppercase tracking-widest text-[var(--text-tertiary)] mb-1.5">{title} · {count}</p>
        {children}
      </section>
    ) : null;

  return (
    <div className="space-y-8">
      {/* Recherche de membres */}
      <section>
        <div className="relative mb-2">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Rechercher un membre…"
            className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] focus:border-[var(--border-default)] text-[var(--text-primary)] text-sm rounded-md pl-9 pr-3 py-2 focus:outline-none transition-colors placeholder:text-[var(--text-tertiary)]"
          />
        </div>
        <div className="divide-y divide-[var(--border-subtle)]">
          {members.map((m) => <Row key={m.id} u={m} right={memberAction(m)} />)}
          {q && members.length === 0 && <p className="text-xs text-[var(--text-tertiary)] py-3">Aucun membre trouvé.</p>}
        </div>
      </section>

      {conns && section("Demandes reçues", conns.incoming.length,
        <div className="divide-y divide-[var(--border-subtle)]">
          {conns.incoming.map((e) => (
            <Row key={e.connectionId} u={e.user} right={
              <span className="inline-flex gap-1.5">
                <button className={primary} disabled={busy === e.connectionId} onClick={() => respond(e.connectionId, "accept")}><Check size={13} /> Accepter</button>
                <button className={ghost} disabled={busy === e.connectionId} onClick={() => respond(e.connectionId, "decline")}><X size={13} /></button>
              </span>
            } />
          ))}
        </div>
      )}

      {conns && section("En attente", conns.outgoing.length,
        <div className="divide-y divide-[var(--border-subtle)]">
          {conns.outgoing.map((e) => (
            <Row key={e.connectionId} u={e.user} right={
              <button className={ghost} disabled={busy === e.connectionId} onClick={() => remove(e.connectionId)}><Clock size={13} /> Annuler</button>
            } />
          ))}
        </div>
      )}

      {conns && section("Mes connexions", conns.connections.length,
        <div className="divide-y divide-[var(--border-subtle)]">
          {conns.connections.map((e) => (
            <Row key={e.connectionId} u={e.user} right={
              <button className={ghost} disabled={busy === e.connectionId} onClick={() => remove(e.connectionId)}>Retirer</button>
            } />
          ))}
        </div>
      )}

      {conns && conns.connections.length === 0 && conns.incoming.length === 0 && conns.outgoing.length === 0 && (
        <p className="text-sm text-[var(--text-tertiary)]">Pas encore de connexions. Recherche des membres ci-dessus pour te connecter.</p>
      )}
    </div>
  );
}
