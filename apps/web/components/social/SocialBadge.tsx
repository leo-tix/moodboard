"use client";

import { useCallback, useEffect, useState } from "react";

// Pastille de notification (façon TriageBadge, sans WebSocket) :
//  · requests = demandes de connexion entrantes
//  · messages = messages non lus
//  · all      = somme des deux (pour le bouton « Plus » mobile)
export function SocialBadge({ kind }: { kind: "requests" | "messages" | "all" }) {
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    try {
      let n = 0;
      if (kind === "requests" || kind === "all") {
        const d = await (await fetch("/api/connections")).json();
        n += d.incoming?.length ?? 0;
      }
      if (kind === "messages" || kind === "all") {
        const d = await (await fetch("/api/conversations")).json();
        n += d.unreadTotal ?? 0;
      }
      setCount(n);
    } catch { /* ignore */ }
  }, [kind]);

  useEffect(() => {
    void refresh();
    const onVis = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVis);
    const i = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 30_000);
    return () => { window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", onVis); window.clearInterval(i); };
  }, [refresh]);

  if (!count) return null;
  return (
    <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-[var(--accent,#a78bfa)] text-[var(--bg-base)] text-[10px] font-bold flex items-center justify-center tabular-nums leading-none">
      {count > 99 ? "99+" : count}
    </span>
  );
}
