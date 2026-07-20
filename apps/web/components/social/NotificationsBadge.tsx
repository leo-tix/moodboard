"use client";

import { useCallback, useEffect, useState } from "react";
import { NOTIFS_SEEN_KEY } from "@/components/social/NotificationsClient";

// Pastille « Notifications » de l'onglet social. Compte les notifications plus
// récentes que le dernier « vu » (timestamp localStorage, posé par la page
// /notifications). Poll léger + focus, en pause si onglet masqué.
export function NotificationsBadge() {
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/notifications");
      if (!r.ok) return;
      const items: { ts: string }[] = (await r.json()).notifications ?? [];
      const seen = localStorage.getItem(NOTIFS_SEEN_KEY) ?? "";
      setCount(items.filter((n) => !seen || n.ts > seen).length);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    void refresh();
    const onVis = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("focus", refresh);
    window.addEventListener("notifs-seen", refresh);
    document.addEventListener("visibilitychange", onVis);
    const i = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 45_000);
    return () => { window.removeEventListener("focus", refresh); window.removeEventListener("notifs-seen", refresh); document.removeEventListener("visibilitychange", onVis); window.clearInterval(i); };
  }, [refresh]);

  if (!count) return null;
  return (
    <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-[var(--accent,#a78bfa)] text-[var(--bg-base)] text-[10px] font-bold flex items-center justify-center tabular-nums leading-none">
      {count > 99 ? "99+" : count}
    </span>
  );
}
