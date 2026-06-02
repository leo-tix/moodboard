"use client";

import { useState } from "react";

interface FilterDrawerProps {
  children: React.ReactNode;
  hasActiveFilters: boolean;
}

/**
 * On mobile : bouton "Filtres" qui ouvre un drawer bottom-sheet.
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
          className={`flex items-center gap-2 text-sm px-4 py-2 rounded-lg border transition-colors ${
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
      {open && (
        <>
          <div
            className="fixed inset-0 bg-black/50 z-40 md:hidden"
            onClick={() => setOpen(false)}
          />
          <div
            className="fixed inset-x-0 bottom-0 z-50 md:hidden bg-[var(--bg-elevated)] border-t border-[var(--border-default)] rounded-t-2xl"
            style={{ maxHeight: "80vh" }}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-subtle)]">
              <p className="text-sm font-medium text-[var(--text-primary)]">Filtres</p>
              <button
                onClick={() => setOpen(false)}
                className="w-8 h-8 flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] rounded-full"
              >
                ✕
              </button>
            </div>
            <div className="overflow-y-auto p-5" style={{ maxHeight: "calc(80vh - 64px)", overscrollBehavior: "contain" }}>
              {children}
            </div>
          </div>
        </>
      )}

      {/* ── Desktop sidebar ── */}
      <div className="hidden md:block">
        {children}
      </div>
    </>
  );
}
