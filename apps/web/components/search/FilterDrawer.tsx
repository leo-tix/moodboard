"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

interface FilterDrawerProps {
  children: React.ReactNode;
  hasActiveFilters: boolean;
}

/**
 * On mobile : bouton "Filtres" qui ouvre un bottom sheet animé (pattern
 * Pinterest — les filtres s'appliquent en direct, le bouton du bas ferme
 * pour voir les résultats).
 * On desktop (md+) : rendu direct en sidebar (children visibles en permanence).
 */
export function FilterDrawer({ children, hasActiveFilters }: FilterDrawerProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* ── Mobile toggle button ── */}
      <div className="md:hidden mb-4">
        <button
          onClick={() => setOpen(true)}
          className={`flex items-center gap-2 text-sm px-4 py-2.5 rounded-lg border transition-colors ${
            hasActiveFilters
              ? "border-[var(--accent,#a78bfa)]/50 text-[var(--accent,#a78bfa)] bg-[var(--accent,#a78bfa)]/8"
              : "border-[var(--border-default)] text-[var(--text-secondary)]"
          }`}
        >
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
            <line x1="1" y1="3.5" x2="12" y2="3.5"/>
            <line x1="1" y1="6.5" x2="12" y2="6.5"/>
            <line x1="1" y1="9.5" x2="12" y2="9.5"/>
          </svg>
          Filtres
          {hasActiveFilters && (
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent,#a78bfa)]" />
          )}
        </button>
      </div>

      {/* ── Mobile bottom sheet ── */}
      <AnimatePresence>
        {open && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 z-40 md:hidden"
              onClick={() => setOpen(false)}
            />
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", bounce: 0, duration: 0.3 }}
              className="fixed inset-x-0 bottom-0 z-50 md:hidden bg-[var(--bg-elevated)] border-t border-[var(--border-default)] rounded-t-2xl flex flex-col"
              style={{ maxHeight: "82vh" }}
            >
              {/* Drag handle + header */}
              <div className="flex-shrink-0">
                <div className="flex justify-center pt-2.5 pb-1">
                  <div className="w-8 h-1 rounded-full bg-[var(--border-default)]" />
                </div>
                <div className="flex items-center justify-between px-5 pb-3">
                  <p className="text-sm font-medium text-[var(--text-primary)]">Filtres</p>
                  <button
                    onClick={() => setOpen(false)}
                    className="w-9 h-9 flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] rounded-full"
                    aria-label="Fermer"
                  >
                    ✕
                  </button>
                </div>
              </div>

              {/* Contenu scrollable */}
              <div className="flex-1 overflow-y-auto px-5 pb-3" style={{ overscrollBehavior: "contain" }}>
                {children}
              </div>

              {/* Footer — les filtres s'appliquent en direct, ce bouton révèle les résultats */}
              <div
                className="flex-shrink-0 px-5 pt-3 border-t border-[var(--border-subtle)]"
                style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 12px)" }}
              >
                <button
                  onClick={() => setOpen(false)}
                  className="w-full py-3 bg-[var(--text-primary)] text-[var(--bg-base)] rounded-lg text-sm font-medium active:opacity-90 transition-opacity"
                >
                  Voir les résultats
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ── Desktop sidebar ── */}
      <div className="hidden md:block">
        {children}
      </div>
    </>
  );
}
