"use client";

import { AnimatePresence, motion } from "framer-motion";
import { RotateCw } from "lucide-react";
import { flushOutbox } from "@/lib/offline/outbox";
import { useOutbox } from "@/lib/offline/useOutbox";

// Pastille d'état de la file hors ligne, ancrée au-dessus du FAB de capture.
// Ne s'affiche que s'il y a des captures en attente pour cette visite.
// - hors ligne  → "N en attente · hors ligne"
// - en ligne, des erreurs → "N en attente · réessayer" (bouton de rejeu manuel)
// - en ligne, sans erreur → "Synchronisation… (N)"
export function OutboxIndicator({ visitId }: { visitId: string }) {
  const { items, count, online } = useOutbox(visitId);
  const hasError = items.some((i) => i.attempts > 0);

  let label: string;
  if (!online) label = `${count} en attente · hors ligne`;
  else if (hasError) label = `${count} en attente · réessayer`;
  else label = `Synchronisation… (${count})`;

  return (
    <AnimatePresence>
      {count > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ type: "tween", duration: 0.18, ease: [0.2, 0, 0, 1] }}
          className="fixed right-4 md:right-6 z-[64] flex items-center gap-2 rounded-full bg-[var(--bg-elevated)] border border-[var(--border-default)] shadow-xl px-3 py-1.5 text-xs text-[var(--text-secondary)]"
          style={{ bottom: "calc(8.5rem + env(safe-area-inset-bottom))" }}
        >
          <span
            className={
              !online
                ? "w-2 h-2 rounded-full bg-[var(--text-tertiary)]"
                : hasError
                  ? "w-2 h-2 rounded-full bg-red-400"
                  : "w-2 h-2 rounded-full bg-amber-400 animate-pulse"
            }
          />
          <span>{label}</span>
          {online && hasError && (
            <button
              type="button"
              onClick={() => void flushOutbox()}
              className="ml-0.5 text-[var(--text-primary)] hover:opacity-80 flex items-center"
            >
              <RotateCw size={13} strokeWidth={2} />
            </button>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
