"use client";

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";

export interface CollectionMeta {
  id: string;
  name: string;
  _count: { items: number };
}

interface AddToCollectionModalProps {
  /** IDs des inspirations à ajouter */
  inspirationIds: string[];
  onClose: () => void;
  /** Appelé après chaque ajout réussi */
  onAdded?: (collectionId: string, collectionName: string) => void;
}

export function AddToCollectionModal({
  inspirationIds,
  onClose,
  onAdded,
}: AddToCollectionModalProps) {
  const [collections, setCollections] = useState<CollectionMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const createInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/collections")
      .then((r) => r.json())
      .then(setCollections)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (showCreate) setTimeout(() => createInputRef.current?.focus(), 50);
  }, [showCreate]);

  const addTo = async (collectionId: string, collectionName: string) => {
    setAdding(collectionId);
    try {
      await fetch(`/api/collections/${collectionId}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inspirationIds }),
      });
      setAdded((prev) => new Set([...prev, collectionId]));
      onAdded?.(collectionId, collectionName);
    } finally {
      setAdding(null);
    }
  };

  const createAndAdd = async () => {
    if (!newName.trim() || creating) return;
    setCreating(true);
    try {
      const res = await fetch("/api/collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });
      const col: CollectionMeta = await res.json();
      setCollections((prev) => [...prev, col]);
      setNewName("");
      setShowCreate(false);
      await addTo(col.id, col.name);
    } finally {
      setCreating(false);
    }
  };

  const content = (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 z-[60]"
        onClick={onClose}
      />

      {/* Modal */}
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 6 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 6 }}
        transition={{ duration: 0.16 }}
        className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[61] w-72 bg-[var(--bg-elevated)] border border-[var(--border-default)] rounded-lg shadow-2xl flex flex-col"
        style={{ maxHeight: "80vh" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-subtle)] flex-shrink-0">
          <p className="text-xs font-medium text-[var(--text-primary)]">
            Ajouter à une collection
            {inspirationIds.length > 1 && (
              <span className="ml-1.5 text-[var(--text-tertiary)] font-normal">
                ({inspirationIds.length} images)
              </span>
            )}
          </p>
          <button
            onClick={onClose}
            className="text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors leading-none"
          >
            ✕
          </button>
        </div>

        {/* Liste des collections */}
        <div className="flex-1 overflow-y-auto py-1">
          {loading ? (
            <p className="text-[11px] text-[var(--text-tertiary)] px-4 py-4">Chargement…</p>
          ) : collections.length === 0 ? (
            <p className="text-[11px] text-[var(--text-tertiary)] px-4 py-4">
              Aucune collection. Créez-en une ci-dessous.
            </p>
          ) : (
            collections.map((col) => {
              const isAdded = added.has(col.id);
              const isAdding = adding === col.id;
              return (
                <button
                  key={col.id}
                  onClick={() => !isAdded && !isAdding && addTo(col.id, col.name)}
                  disabled={isAdded || isAdding}
                  className={`w-full flex items-center justify-between px-4 py-2.5 text-left transition-colors ${
                    isAdded
                      ? "opacity-50 cursor-default"
                      : "hover:bg-[var(--bg-overlay)] cursor-pointer"
                  }`}
                >
                  <span className="text-[12px] text-[var(--text-primary)] truncate">{col.name}</span>
                  <span className="text-[10px] text-[var(--text-tertiary)] flex-shrink-0 ml-2">
                    {isAdded ? (
                      <span className="text-green-400">✓ Ajouté</span>
                    ) : isAdding ? (
                      "…"
                    ) : (
                      `${col._count.items}`
                    )}
                  </span>
                </button>
              );
            })
          )}
        </div>

        {/* Créer nouvelle collection */}
        <div className="flex-shrink-0 px-4 py-3 border-t border-[var(--border-subtle)]">
          <AnimatePresence mode="wait">
            {showCreate ? (
              <motion.div
                key="create-form"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="flex items-center gap-2"
              >
                <input
                  ref={createInputRef}
                  className="flex-1 bg-transparent border-b border-[var(--border-default)] text-xs text-[var(--text-primary)] py-1 focus:outline-none focus:border-[var(--accent,#a78bfa)] transition-colors placeholder:text-[var(--text-tertiary)]"
                  placeholder="Nom de la collection…"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") createAndAdd();
                    if (e.key === "Escape") setShowCreate(false);
                  }}
                />
                <button
                  onClick={createAndAdd}
                  disabled={creating || !newName.trim()}
                  className="text-[10px] text-[var(--accent,#a78bfa)] hover:opacity-80 disabled:opacity-40 transition-opacity"
                >
                  {creating ? "…" : "Créer"}
                </button>
                <button
                  onClick={() => setShowCreate(false)}
                  className="text-[10px] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                >
                  ✕
                </button>
              </motion.div>
            ) : (
              <motion.button
                key="create-btn"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setShowCreate(true)}
                className="text-[10px] text-[var(--accent,#a78bfa)] hover:opacity-80 transition-opacity"
              >
                + Nouvelle collection
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </>
  );

  if (typeof window === "undefined") return null;
  return createPortal(
    <AnimatePresence>{content}</AnimatePresence>,
    document.body
  );
}
