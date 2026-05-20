"use client";

import { useState, useCallback } from "react";
import { AnimatePresence } from "framer-motion";
import { InspirationGrid, type InspirationGridItem } from "./InspirationGrid";
import { BatchEditBar } from "./BatchEditBar";

interface LibraryClientProps {
  inspirations: InspirationGridItem[];
}

export function LibraryClient({ inspirations }: LibraryClientProps) {
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setSelectMode(false);
  }, []);

  const enterSelectMode = () => {
    setSelectMode(true);
    setSelectedIds(new Set());
  };

  return (
    <>
      {/* Controls */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          {selectMode && selectedIds.size > 0 && (
            <p className="text-xs text-[var(--text-tertiary)]">
              {selectedIds.size} sélectionnée{selectedIds.size > 1 ? "s" : ""}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {selectMode && (
            <button
              onClick={() => {
                const allIds = new Set(inspirations.map((i) => i.id));
                setSelectedIds((prev) =>
                  prev.size === allIds.size ? new Set() : allIds
                );
              }}
              className="text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors"
            >
              {selectedIds.size === inspirations.length ? "Tout désélectionner" : "Tout sélectionner"}
            </button>
          )}
          <button
            onClick={selectMode ? clearSelection : enterSelectMode}
            className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] px-3 py-1.5 rounded-md border border-[var(--border-subtle)] hover:border-[var(--border-default)] transition-colors"
          >
            {selectMode ? "Annuler" : "Sélectionner"}
          </button>
        </div>
      </div>

      <InspirationGrid
        inspirations={inspirations}
        columns={4}
        selectable={selectMode}
        selectedIds={selectedIds}
        onSelect={toggleSelect}
      />

      <AnimatePresence>
        {selectedIds.size > 0 && (
          <BatchEditBar
            selectedIds={Array.from(selectedIds)}
            onClear={clearSelection}
            onSaved={() => {
              clearSelection();
              // Reload page data
              window.location.reload();
            }}
          />
        )}
      </AnimatePresence>
    </>
  );
}
