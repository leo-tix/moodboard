"use client";

import { useEffect, useState } from "react";
import {
  ensureAutoFlush,
  listPending,
  subscribeOutbox,
  type OutboxItem,
} from "./outbox";

// Suit la file de capture hors ligne pour une visite donnée (ou toutes si
// omise). Installe les déclencheurs de resync au montage et se re-rend à chaque
// changement de file. Expose aussi l'état online pour l'affichage.
export function useOutbox(visitId?: string) {
  const [items, setItems] = useState<OutboxItem[]>([]);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    ensureAutoFlush();

    let cancelled = false;
    const refresh = () => {
      listPending(visitId).then((list) => {
        if (!cancelled) setItems(list);
      });
    };
    refresh();
    const unsub = subscribeOutbox(refresh);

    const syncOnline = () => setOnline(navigator.onLine);
    syncOnline();
    window.addEventListener("online", syncOnline);
    window.addEventListener("offline", syncOnline);

    return () => {
      cancelled = true;
      unsub();
      window.removeEventListener("online", syncOnline);
      window.removeEventListener("offline", syncOnline);
    };
  }, [visitId]);

  return { items, count: items.length, online };
}
