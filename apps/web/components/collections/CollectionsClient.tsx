"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import { getThumbnailUrl } from "@/lib/storage/urls";

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
}

export function CollectionsClient({ initialCollections }: CollectionsClientProps) {
  const [collections, setCollections] = useState(initialCollections);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [creating, setCreating] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

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
      setCollections((prev) => [
        ...prev,
        { ...col, items: [] },
      ]);
      setNewName("");
      setNewDesc("");
      setShowCreate(false);
    } finally {
      setCreating(false);
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

  return (
    <div>
      {/* Collections grid */}
      {collections.length === 0 && !showCreate ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
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
          {collections.map((col) => {
            const thumbs = col.items
              .map((item) => item.inspiration.images[0]?.thumbnailKey)
              .filter(Boolean) as string[];

            return (
              <div key={col.id} className="group relative">
                <Link href={`/collections/${col.id}`} className="block">
                  {/* Cover mosaic */}
                  <div className="aspect-square rounded-md overflow-hidden bg-[var(--bg-surface)] mb-2 relative">
                    {thumbs.length === 0 ? (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-[var(--text-tertiary)] text-xs">Vide</span>
                      </div>
                    ) : thumbs.length === 1 ? (
                      <Image
                        src={getThumbnailUrl(thumbs[0])}
                        alt={col.name}
                        fill
                        className="object-cover"
                        sizes="(max-width: 768px) 50vw, 25vw"
                      />
                    ) : (
                      <div className="grid grid-cols-2 grid-rows-2 h-full gap-px">
                        {thumbs.slice(0, 4).map((key, i) => (
                          <div key={i} className="relative overflow-hidden bg-[var(--bg-elevated)]">
                            <Image
                              src={getThumbnailUrl(key)}
                              alt=""
                              fill
                              className="object-cover"
                              sizes="15vw"
                            />
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Hover overlay */}
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
                  </div>

                  {/* Name + count */}
                  <p className="text-xs font-medium text-[var(--text-primary)] leading-tight truncate">
                    {col.name}
                  </p>
                  <p className="text-[10px] text-[var(--text-tertiary)] mt-0.5">
                    {col._count.items} image{col._count.items !== 1 ? "s" : ""}
                  </p>
                </Link>

                {/* Delete button */}
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

      {/* Create modal */}
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
