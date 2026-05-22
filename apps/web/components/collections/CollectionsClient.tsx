"use client";

import { useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { getThumbnailUrl } from "@/lib/storage/urls";
import type { CollectionSuggestion } from "@/lib/collections/suggestions";

interface CollectionWithCover {
  id: string;
  name: string;
  description: string | null;
  _count: { items: number };
  items: {
    inspiration: {
      images: { thumbnailKey: string | null }[];
    };
  }[];
}

interface CollectionsClientProps {
  initialCollections: CollectionWithCover[];
  suggestions: CollectionSuggestion[];
}

// ─── Cover mosaic helper ───────────────────────────────────────────────────────

function CoverMosaic({
  thumbs,
  name,
  empty,
}: {
  thumbs: string[];
  name: string;
  empty?: boolean;
}) {
  if (empty || thumbs.length === 0) {
    return (
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-[var(--text-tertiary)] text-xs">Vide</span>
      </div>
    );
  }
  if (thumbs.length === 1) {
    return (
      <img
        src={getThumbnailUrl(thumbs[0])}
        alt={name}
        loading="lazy"
        className="absolute inset-0 w-full h-full object-cover"
      />
    );
  }
  return (
    <div className="grid grid-cols-2 grid-rows-2 h-full gap-px">
      {thumbs.slice(0, 4).map((key, i) => (
        <div key={i} className="relative overflow-hidden bg-[var(--bg-elevated)]">
          <img
            src={getThumbnailUrl(key)}
            alt=""
            loading="lazy"
            className="absolute inset-0 w-full h-full object-cover"
          />
        </div>
      ))}
    </div>
  );
}

// ─── Type badge ────────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<CollectionSuggestion["type"], string> = {
  category: "Catégorie",
  tag: "Tag",
  year: "Année",
  author: "Auteur",
};

// ─── Main component ────────────────────────────────────────────────────────────

export function CollectionsClient({
  initialCollections,
  suggestions,
}: CollectionsClientProps) {
  const [collections, setCollections] = useState(initialCollections);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [creating, setCreating] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [creatingFromSuggestion, setCreatingFromSuggestion] = useState<string | null>(null);
  const [dismissedSuggestions, setDismissedSuggestions] = useState<Set<string>>(new Set());
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const startRename = (col: CollectionWithCover) => {
    setRenamingId(col.id);
    setRenameValue(col.name);
    setDeleteId(null);
  };

  const commitRename = async (id: string) => {
    const trimmed = renameValue.trim();
    if (!trimmed) { setRenamingId(null); return; }
    await fetch(`/api/collections/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: trimmed }),
    });
    setCollections((prev) =>
      prev.map((c) => (c.id === id ? { ...c, name: trimmed } : c))
    );
    setRenamingId(null);
  };

  const create = async () => {
    if (!newName.trim() || creating) return;
    setCreating(true);
    try {
      const res = await fetch("/api/collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), description: newDesc.trim() || null }),
      });
      const col = await res.json();
      setCollections((prev) => [...prev, { ...col, items: [] }]);
      setNewName("");
      setNewDesc("");
      setShowCreate(false);
    } finally {
      setCreating(false);
    }
  };

  const createFromSuggestion = async (suggestion: CollectionSuggestion) => {
    setCreatingFromSuggestion(suggestion.label);
    try {
      // 1. Créer la collection
      const res = await fetch("/api/collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: suggestion.label }),
      });
      const col = await res.json();

      // 2. Ajouter les images
      await fetch(`/api/collections/${col.id}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inspirationIds: suggestion.inspirationIds }),
      });

      // 3. Mettre à jour l'état local
      setCollections((prev) => [
        ...prev,
        {
          ...col,
          _count: { items: suggestion.inspirationIds.length },
          items: suggestion.previewThumbs.slice(0, 4).map((thumbnailKey) => ({
            inspiration: { images: [{ thumbnailKey }] },
          })),
        },
      ]);
      setDismissedSuggestions((prev) => new Set([...prev, suggestion.label]));
    } finally {
      setCreatingFromSuggestion(null);
    }
  };

  const deleteCollection = async (id: string) => {
    setDeleting(true);
    try {
      await fetch(`/api/collections/${id}`, { method: "DELETE" });
      setCollections((prev) => prev.filter((c) => c.id !== id));
      setDeleteId(null);
    } finally {
      setDeleting(false);
    }
  };

  // Filtre les suggestions dont le label existe déjà dans les collections ou a été créé/ignoré
  const existingNames = new Set(collections.map((c) => c.name.toLowerCase()));
  const visibleSuggestions = suggestions.filter(
    (s) => !existingNames.has(s.label.toLowerCase()) && !dismissedSuggestions.has(s.label)
  );

  return (
    <div className="space-y-10">
      {/* ── Collections existantes ── */}
      <div>
        {collections.length === 0 && !showCreate ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <p className="text-[var(--text-tertiary)] text-sm mb-4">
              Aucune collection pour le moment.
            </p>
            <button
              onClick={() => setShowCreate(true)}
              className="px-4 py-2 text-xs bg-[var(--bg-surface)] border border-[var(--border-default)] text-[var(--text-secondary)] rounded-md hover:text-[var(--text-primary)] hover:border-[var(--border-strong)] transition-colors"
            >
              + Créer une collection
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {/* Bouton créer */}
            <button
              onClick={() => setShowCreate(true)}
              className="aspect-square rounded-md border border-dashed border-[var(--border-default)] hover:border-[var(--border-strong)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors flex flex-col items-center justify-center gap-1.5"
            >
              <span className="text-xl opacity-40">+</span>
              <span className="text-[10px]">Nouvelle</span>
            </button>

            {collections.map((col) => {
              const thumbs = col.items
                .map((item) => item.inspiration.images[0]?.thumbnailKey)
                .filter((t): t is string => !!t);

              return (
                <div key={col.id} className="group relative">
                  <Link href={`/collections/${col.id}`} className="block">
                    <div className="aspect-square rounded-md overflow-hidden bg-[var(--bg-surface)] mb-2 relative">
                      <CoverMosaic thumbs={thumbs} name={col.name} empty={thumbs.length === 0} />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
                    </div>
                  </Link>

                  {/* Nom — inline rename */}
                  {renamingId === col.id ? (
                    <input
                      autoFocus
                      className="w-full text-xs font-medium bg-transparent border-b border-[var(--accent,#a78bfa)] text-[var(--text-primary)] focus:outline-none py-0.5"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={() => commitRename(col.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitRename(col.id);
                        if (e.key === "Escape") setRenamingId(null);
                      }}
                    />
                  ) : (
                    <div className="flex items-center gap-1 group/name">
                      <p className="text-xs font-medium text-[var(--text-primary)] leading-tight truncate flex-1">
                        {col.name}
                      </p>
                      <button
                        onClick={() => startRename(col)}
                        className="opacity-0 group-hover/name:opacity-100 transition-opacity text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] text-[9px] flex-shrink-0"
                        title="Renommer"
                      >
                        ✎
                      </button>
                    </div>
                  )}

                  <p className="text-[10px] text-[var(--text-tertiary)] mt-0.5">
                    {col._count.items} image{col._count.items !== 1 ? "s" : ""}
                  </p>

                  {deleteId === col.id ? (
                    <div className="flex items-center gap-1.5 mt-1">
                      <span className="text-[9px] text-red-400">Supprimer ?</span>
                      <button
                        onClick={() => deleteCollection(col.id)}
                        disabled={deleting}
                        className="text-[9px] text-red-400 hover:text-red-300"
                      >
                        {deleting ? "…" : "Oui"}
                      </button>
                      <button
                        onClick={() => setDeleteId(null)}
                        className="text-[9px] text-[var(--text-tertiary)]"
                      >
                        Non
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setDeleteId(col.id)}
                      className="text-[9px] text-[var(--text-tertiary)] hover:text-red-400 transition-colors mt-0.5 opacity-0 group-hover:opacity-100"
                    >
                      Supprimer
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Suggestions ── */}
      {visibleSuggestions.length > 0 && (
        <div>
          <div className="flex items-baseline gap-3 mb-4">
            <h2 className="text-sm font-medium text-[var(--text-primary)]">
              Collections suggérées
            </h2>
            <p className="text-[10px] text-[var(--text-tertiary)]">
              Générées à partir de tes métadonnées
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {visibleSuggestions.map((s) => {
              const isCreating = creatingFromSuggestion === s.label;
              return (
                <div
                  key={`${s.type}-${s.label}`}
                  className="group relative"
                >
                  {/* Cover */}
                  <div className="aspect-square rounded-md overflow-hidden bg-[var(--bg-surface)] mb-2 relative border border-dashed border-[var(--border-subtle)]">
                    <CoverMosaic thumbs={s.previewThumbs} name={s.label} />
                    {/* Overlay avec badge type */}
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors" />
                    <div className="absolute top-1.5 left-1.5">
                      <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-black/50 text-white/70 backdrop-blur-sm">
                        {TYPE_LABELS[s.type]}
                      </span>
                    </div>
                  </div>

                  <p className="text-xs font-medium text-[var(--text-primary)] leading-tight truncate">
                    {s.label}
                  </p>
                  <p className="text-[10px] text-[var(--text-tertiary)] mt-0.5 mb-1.5">
                    {s.sublabel}
                  </p>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => createFromSuggestion(s)}
                      disabled={isCreating}
                      className="text-[9px] text-[var(--accent,#a78bfa)] hover:opacity-80 transition-opacity disabled:opacity-40"
                    >
                      {isCreating ? "Création…" : "+ Créer cette collection"}
                    </button>
                    <button
                      onClick={() =>
                        setDismissedSuggestions((prev) => new Set([...prev, s.label]))
                      }
                      className="text-[9px] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors ml-auto"
                      title="Ignorer cette suggestion"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Modal création manuelle ── */}
      <AnimatePresence>
        {showCreate && (
          <>
            <div
              className="fixed inset-0 bg-black/50 z-40"
              onClick={() => setShowCreate(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 6 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 6 }}
              transition={{ duration: 0.16 }}
              className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-80 bg-[var(--bg-elevated)] border border-[var(--border-default)] rounded-lg shadow-2xl p-5"
            >
              <p className="text-sm font-medium text-[var(--text-primary)] mb-4">
                Nouvelle collection
              </p>

              <div className="space-y-3">
                <div>
                  <label className="block text-[9px] text-[var(--text-tertiary)] uppercase tracking-widest mb-1">
                    Nom
                  </label>
                  <input
                    autoFocus
                    className="w-full bg-transparent border-b border-[var(--border-default)] text-sm text-[var(--text-primary)] py-1 focus:outline-none focus:border-[var(--accent,#a78bfa)] transition-colors"
                    placeholder="Nom de la collection…"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") create();
                      if (e.key === "Escape") setShowCreate(false);
                    }}
                  />
                </div>
                <div>
                  <label className="block text-[9px] text-[var(--text-tertiary)] uppercase tracking-widest mb-1">
                    Description (optionnel)
                  </label>
                  <input
                    className="w-full bg-transparent border-b border-[var(--border-default)] text-xs text-[var(--text-primary)] py-1 focus:outline-none focus:border-[var(--border-strong)] transition-colors placeholder:text-[var(--text-tertiary)]"
                    placeholder="—"
                    value={newDesc}
                    onChange={(e) => setNewDesc(e.target.value)}
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 mt-5">
                <button
                  onClick={() => setShowCreate(false)}
                  className="text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                >
                  Annuler
                </button>
                <button
                  onClick={create}
                  disabled={creating || !newName.trim()}
                  className="px-4 py-1.5 text-xs bg-[var(--bg-overlay)] border border-[var(--border-default)] text-[var(--text-primary)] rounded hover:border-[var(--border-strong)] disabled:opacity-40 transition-colors"
                >
                  {creating ? "Création…" : "Créer"}
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
