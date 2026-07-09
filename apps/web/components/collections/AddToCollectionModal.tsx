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
  /** Ouvre directement le formulaire de création (ex: drop sur "+ Nouvelle collection") */
  autoOpenCreate?: boolean;
}

export function AddToCollectionModal({
  inspirationIds,
  onClose,
  onAdded,
  autoOpenCreate = false,
}: AddToCollectionModalProps) {
  const [collections, setCollections] = useState<CollectionMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [showCreate, setShowCreate] = useState(autoOpenCreate);
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

      {/* Modal — bottom sheet sur mobile, dialogue centré sur desktop */}
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 24 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 24 }}
        transition={{ duration: 0.16 }}
        className="fixed z-[61] bg-[var(--bg-elevated)] border border-[var(--border-default)] shadow-2xl flex flex-col inset-x-0 bottom-0 w-full rounded-t-2xl md:inset-x-auto md:bottom-auto md:top-1/2 md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:w-72 md:rounded-lg"
        style={{ maxHeight: "80vh", paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {/* Drag handle — mobile uniquement */}
        <div className="flex md:hidden justify-center pt-2.5 pb-0.5 flex-shrink-0">
          <div className="w-8 h-1 rounded-full bg-[var(--border-default)]" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2 md:py-3 border-b border-[var(--border-subtle)] flex-shrink-0">
          <p className="text-sm md:text-xs font-medium text-[var(--text-primary)]">
            Ajouter à une collection
            {inspirationIds.length > 1 && (
              <span className="ml-1.5 text-[var(--text-tertiary)] font-normal">
                ({inspirationIds.length} images)
              </span>
            )}
          </p>
          <button
            onClick={onClose}
            className="w-9 h-9 md:w-auto md:h-auto flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors leading-none"
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
