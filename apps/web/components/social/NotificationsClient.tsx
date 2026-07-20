"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { UserPlus, UserCheck, Share2 } from "lucide-react";
import { UserAvatar } from "@/components/social/UserAvatar";

type Actor = { name: string | null; username: string | null; image: string | null };
type Notif = {
  id: string;
  type: "connect_request" | "connect_accepted" | "shared";
  ts: string;
  actor: Actor;
  href: string;
  resourceLabel?: string;
  resourceKind?: "MOODBOARD" | "VISIT" | "COLLECTION";
  role?: string;
};

export const NOTIFS_SEEN_KEY = "notifsSeenAt";
const KIND_LABEL: Record<NonNullable<Notif["resourceKind"]>, string> = { MOODBOARD: "planche", VISIT: "visite", COLLECTION: "collection" };

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

function label(n: Notif): string {
  const who = n.actor.name || (n.actor.username ? `@${n.actor.username}` : "Un membre");
  if (n.type === "connect_request") return `${who} veut se connecter`;
  if (n.type === "connect_accepted") return `${who} a accepté ta demande`;
  const kind = n.resourceKind ? KIND_LABEL[n.resourceKind] : "ressource";
  const verb = n.role === "EDITOR" ? "t'a invité à co-éditer" : "a partagé";
  return `${who} ${verb} une ${kind}`;
}

export function NotificationsClient() {
  const [items, setItems] = useState<Notif[] | null>(null);
  const [seenAt, setSeenAt] = useState<string>("");

  const load = useCallback(async () => {
    const r = await fetch("/api/notifications");
    if (r.ok) setItems((await r.json()).notifications ?? []);
  }, []);

  useEffect(() => {
    // On mémorise le « lu jusqu'ici » AVANT de marquer vu, pour surligner les
    // nouvelles à cette visite.
    setSeenAt(localStorage.getItem(NOTIFS_SEEN_KEY) ?? "");
    void load();
  }, [load]);

  // Marque tout comme lu à l'ouverture de la page (badge → 0).
  useEffect(() => {
    if (items === null) return;
    localStorage.setItem(NOTIFS_SEEN_KEY, new Date().toISOString());
    window.dispatchEvent(new Event("notifs-seen"));
  }, [items]);

  if (items === null) return <p className="text-sm text-[var(--text-tertiary)] py-8 text-center">Chargement…</p>;
  if (items.length === 0) return <p className="text-sm text-[var(--text-tertiary)] py-10 text-center">Aucune notification pour l&apos;instant.</p>;

  const Icon = { connect_request: UserPlus, connect_accepted: UserCheck, shared: Share2 };

  return (
    <ul className="divide-y divide-[var(--border-subtle)]">
      {items.map((n) => {
        const isNew = !seenAt || n.ts > seenAt;
        const I = Icon[n.type];
        return (
          <li key={n.id}>
            <Link href={n.href} className="flex items-center gap-3 py-3 px-1 rounded-md hover:bg-[var(--bg-surface)] transition-colors">
              <div className="relative shrink-0">
                <UserAvatar name={n.actor.name} username={n.actor.username} image={n.actor.image} size={40} />
                <span className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-[var(--bg-base)] flex items-center justify-center">
                  <I size={11} strokeWidth={2} className="text-[var(--text-secondary)]" />
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-[var(--text-primary)] truncate">{label(n)}</p>
                {n.resourceLabel && <p className="text-xs text-[var(--text-tertiary)] truncate">{n.resourceLabel}</p>}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[11px] text-[var(--text-tertiary)]">{relTime(n.ts)}</span>
                {isNew && <span className="w-2 h-2 rounded-full bg-[var(--accent,#a78bfa)]" />}
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
