"use client";

import { useRef, useState } from "react";
import { ArrowUpDown, Check, Trash2, Eye } from "lucide-react";
import { useSortableGrid } from "@/hooks/useSortableGrid";
import { DragHandle } from "@/components/ui/DragHandle";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { Pencil, X } from "lucide-react";
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
  const [reorderMode, setReorderMode] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState<string | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);

  // Réorganisation de la LISTE. L'ordre est persisté au relâchement, comme
  // pour les images d'une collection (même hook, même contrat).
  const collectionsRef = useRef(collections);
  collectionsRef.current = collections;
  const sortable = useSortableGrid({
    onReorder: (deId, versId) => {
      setCollections((prev) => {
        const de = prev.findIndex((c) => c.id === deId);
        const vers = prev.findIndex((c) => c.id === versId);
        if (de === -1 || vers === -1 || de === vers) return prev;
        const next = [...prev];
        const [bouge] = next.splice(de, 1);
        next.splice(vers, 0, bouge);
        return next;
      });
    },
    onDrop: () => {
      void fetch("/api/collections/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order: collectionsRef.current.map((c) => c.id) }),
      });
    },
  });

  const basculerSelection = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const quitterSelection = () => { setSelectMode(false); setSelected(new Set()); setBulkError(null); };

  const supprimerSelection = async () => {
    const ids = Array.from(selected);
    setBulkBusy("suppression"); setBulkError(null);
    // Séquentiel plutôt que `Promise.all` : chaque suppression purge des objets
    // R2 côté serveur, et lancer dix requêtes lourdes en parallèle depuis un
    // téléphone est le meilleur moyen d'en voir échouer une au hasard.
    const echecs: string[] = [];
    for (const id of ids) {
      const res = await fetch(`/api/collections/${id}`, { method: "DELETE" }).catch(() => null);
      if (!res || !res.ok) echecs.push(id);
    }
    // On ne retire QUE ce qui est réellement parti : afficher une liste
    // amputée d'éléments encore en base serait un mensonge.
    const partis = new Set(ids.filter((id) => !echecs.includes(id)));
    setCollections((prev) => prev.filter((c) => !partis.has(c.id)));
    if (echecs.length) setBulkError(`${echecs.length} collection${echecs.length > 1 ? "s n'ont" : " n'a"} pas pu être supprimée${echecs.length > 1 ? "s" : ""}.`);
    else quitterSelection();
    setBulkBusy(null);
  };

  const changerVisibilite = async (visibility: "PRIVATE" | "CONNECTIONS" | "PUBLIC") => {
    const ids = Array.from(selected);
    setBulkBusy("visibilite"); setBulkError(null);
    let echecs = 0;
    for (const id of ids) {
      // Le segment est le nom de ROUTE en minuscules (`collections`), pas le
      // nom d'énumération ACL : `segmentToResource` ne connaît que le premier.
      const res = await fetch(`/api/share/collections/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visibility }),
      }).catch(() => null);
      if (!res || !res.ok) echecs++;
    }
    if (echecs) setBulkError(`${echecs} collection${echecs > 1 ? "s" : ""} non modifiée${echecs > 1 ? "s" : ""}.`);
    else quitterSelection();
    setBulkBusy(null);
  };

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
          <>
          <div className="flex items-center justify-end gap-3 mb-3 min-h-[1.5rem]">
            {bulkError && <span className="text-[11px] text-red-400 mr-auto">{bulkError}</span>}
            {selectMode && selected.size > 0 && (
              <>
                <div className="flex items-center gap-1">
                  <Eye size={12} strokeWidth={2} className="text-[var(--text-tertiary)]" />
                  {([["PRIVATE", "Privé"], ["CONNECTIONS", "Connexions"], ["PUBLIC", "Public"]] as const).map(([v, label]) => (
                    <button
                      key={v}
                      onClick={() => void changerVisibilite(v)}
                      disabled={!!bulkBusy}
                      className="px-2 py-1 rounded text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] transition-colors disabled:opacity-40"
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => void supprimerSelection()}
                  disabled={!!bulkBusy}
                  className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-300 transition-colors disabled:opacity-40"
                >
                  <Trash2 size={12} strokeWidth={2} />
                  {bulkBusy === "suppression" ? "Suppression…" : `Supprimer ${selected.size}`}
                </button>
              </>
            )}
            {!selectMode && collections.length > 1 && (
              <button
                onClick={() => setReorderMode((v) => !v)}
                className="flex items-center gap-1.5 text-xs text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
              >
                <ArrowUpDown size={12} strokeWidth={2} />
                {reorderMode ? "Terminer" : "Réorganiser"}
              </button>
            )}
            {!reorderMode && collections.length > 0 && (
              <button
                onClick={() => (selectMode ? quitterSelection() : setSelectMode(true))}
                className="text-xs text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
              >
                {selectMode ? "Annuler" : "Sélectionner"}
              </button>
            )}
          </div>
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
                <div
                  key={col.id}
                  {...(reorderMode ? sortable.getContainerProps(col.id) : {})}
                  className={`group relative ${reorderMode ? "cursor-grab" : ""} ${sortable.draggingKey === col.id ? "opacity-40" : ""}`}
                >
                  <Link
                    href={`/collections/${col.id}`}
                    className="block"
                    // En réorganisation comme en sélection, le clic ne doit pas
                    // NAVIGUER : c'est le même carré qui sert de poignée et de
                    // case à cocher.
                    onClick={(e) => {
                      if (reorderMode) { e.preventDefault(); return; }
                      if (selectMode) { e.preventDefault(); basculerSelection(col.id); }
                    }}
                  >
                    <div className="aspect-square rounded-md overflow-hidden bg-[var(--bg-surface)] mb-2 relative">
                      <CoverMosaic thumbs={thumbs} name={col.name} empty={thumbs.length === 0} />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
                      {selectMode && (
                        <div className={`absolute inset-0 transition-colors ${selected.has(col.id) ? "bg-black/30" : "bg-black/0"}`}>
                          <span className={`absolute top-1.5 right-1.5 w-5 h-5 rounded-full border-2 flex items-center justify-center ${selected.has(col.id) ? "bg-[var(--accent,#a78bfa)] border-[var(--accent,#a78bfa)] text-white" : "border-white/80"}`}>
                            {selected.has(col.id) && <Check size={11} strokeWidth={3} />}
                          </span>
                        </div>
                      )}
                      {reorderMode && (
                        <div className="absolute top-1.5 left-1.5 z-10">
                          <DragHandle {...sortable.getHandleProps(col.id)} />
                        </div>
                      )}
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
                        className="opacity-0 group-hover/name:opacity-100 pointer-coarse:opacity-100 transition-opacity text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] flex-shrink-0 inline-flex items-center"
                        title="Renommer"
                      >
                        <Pencil size={11} strokeWidth={1.75} />
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
                      className="text-[9px] text-[var(--text-tertiary)] hover:text-red-400 transition-colors mt-0.5 opacity-0 group-hover:opacity-100 pointer-coarse:opacity-100"
                    >
                      Supprimer
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          {/* Clone flottant du glisser-déposer (positionné par le hook). */}
          <div ref={sortable.overlayRef} style={sortable.overlayStyle} />
          </>
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
                      className="text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors ml-auto inline-flex items-center"
                      title="Ignorer cette suggestion"
                    >
                      <X size={12} strokeWidth={2} />
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
