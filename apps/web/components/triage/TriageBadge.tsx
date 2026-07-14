"use client";

import { useEffect, useState, useCallback } from "react";
import { TRIAGE_COUNT_CHANGED_EVENT } from "@/lib/triage/events";

// Rafraîchi comme suit pour rester "à jour en temps réel" sans WebSocket :
// - au montage
// - sur TRIAGE_COUNT_CHANGED_EVENT (dispatché par TriageClient à chaque
//   décision accept/archive/undo — le cas le plus fréquent, quasi instantané)
// - au retour de focus/visibilité de l'onglet (rattrape les changements
//   survenus ailleurs : autre onglet, import Chrome extension/PWA, fin de
//   traitement asynchrone d'un upload)
// - poll léger (30s) pendant que l'onglet est visible, filet de sécurité
export function TriageBadge() {
  const [count, setCount] = useState<number | null>(null);

  const refresh = useCallback(() => {
    fetch("/api/triage/count")
      .then((r) => r.json())
      .then((d) => setCount(d.count ?? 0))
      .catch(() => {});
  }, []);

  useEffect(() => {
    refresh();

    const onVisibility = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener(TRIAGE_COUNT_CHANGED_EVENT, refresh);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisibility);

    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, 30_000);

    return () => {
      window.removeEventListener(TRIAGE_COUNT_CHANGED_EVENT, refresh);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearInterval(interval);
    };
  }, [refresh]);

  if (!count) return null;

  return (
    <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-[var(--accent,#a78bfa)] text-[var(--bg-base)] text-[10px] font-bold flex items-center justify-center tabular-nums leading-none">
      {count > 99 ? "99+" : count}
    </span>
  );
}
