"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/Button";
import { CategorySelect } from "./CategorySelect";
import { TagInput } from "./TagInput";
import { AddToCollectionModal } from "@/components/collections/AddToCollectionModal";

interface Category {
  id: string;
  name: string;
  slug: string;
  icon: string | null;
  subcategories: { id: string; name: string; slug: string }[];
}

interface BatchEditBarProps {
  selectedIds:     string[];
  onClear:         () => void;
  onSaved:         () => void;
  isArchivedMode?: boolean;
}

const fieldClass =
  "w-full bg-[var(--bg-base)] border border-[var(--border-subtle)] text-[var(--text-primary)] text-xs rounded px-2.5 py-1.5 focus:outline-none focus:border-[var(--border-default)] transition-colors placeholder:text-[var(--text-tertiary)]";
const sectionLabel = "block text-[9px] text-[var(--text-tertiary)] uppercase tracking-widest mb-1.5";

export function BatchEditBar({ selectedIds, onClear, onSaved, isArchivedMode = false }: BatchEditBarProps) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState({ categoryId: "", subcategoryId: "" });
  const [addTags, setAddTags] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showCollectionModal, setShowCollectionModal] = useState(false);

  useEffect(() => {
    fetch("/api/categories")
      .then((r) => r.json())
      .then(setCategories)
      .catch(console.error);
  }, []);

  const hasPatch = title.trim() || category.categoryId || addTags.length > 0;

  const restore = async () => {
    setRestoring(true);
    try {
      await fetch("/api/inspirations/batch", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selectedIds, patch: { restore: true } }),
      });
      onSaved();
    } finally {
      setRestoring(false);
    }
  };

  const save = async () => {
    if (!hasPatch) return;
    setSaving(true);
    try {
      await fetch("/api/inspirations/batch", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ids: selectedIds,
          patch: {
            ...(title.trim() ? { title: title.trim() } : {}),
            ...(category.categoryId
              ? { addCategory: { categoryId: category.categoryId, subcategoryId: category.subcategoryId || null } }
              : {}),
            ...(addTags.length > 0 ? { addTags } : {}),
          },
        }),
      });
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  const deleteAll = async () => {
    setDeleting(true);
    try {
      await fetch("/api/inspirations/batch", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selectedIds }),
      });
      onSaved();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
    <motion.div
      initial={{ y: 100, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 100, opacity: 0 }}
      transition={{ type: "spring", bounce: 0.1, duration: 0.35 }}
      className="fixed bottom-14 md:bottom-0 left-0 md:left-14 xl:left-56 right-0 z-50"
    >
      <div className="bg-[var(--bg-elevated)]/95 backdrop-blur border-t border-[var(--border-default)] px-4 py-3"
           style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>

        {/* Mobile: compact header row */}
        <div className="flex items-center justify-between mb-2 md:hidden">
          <p className="text-sm font-medium text-[var(--text-primary)]">
            {selectedIds.length} sélectionnée{selectedIds.length > 1 ? "s" : ""}
          </p>
          <button onClick={onClear} className="text-[10px] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors">
            Désélectionner
          </button>
        </div>

        <div className="flex items-start gap-4 max-w-5xl overflow-x-auto scrollbar-none" style={{ touchAction: "pan-x" }}>
          {/* Count + controls — desktop only */}
          <div className="hidden md:block flex-shrink-0 pt-4">
            <p className="text-sm font-medium text-[var(--text-primary)]">
              {selectedIds.length} sélectionnée{selectedIds.length > 1 ? "s" : ""}
            </p>
            <button
              onClick={onClear}
              className="text-[10px] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors mt-0.5"
            >
              Tout désélectionner
            </button>
          </div>

          <div className="hidden md:block w-px self-stretch bg-[var(--border-subtle)] flex-shrink-0" />

          {/* Title */}
          <div className="w-44 flex-shrink-0">
            <label className={sectionLabel}>Titre (identique)</label>
            <input
              className={fieldClass}
              placeholder="Laisser vide = inchangé"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          {/* Category — dropUp so dropdown opens upward */}
          <div className="flex-1 min-w-0 max-w-xs">
            <label className={sectionLabel}>Catégorie</label>
            {categories.length > 0 ? (
              <CategorySelect
                categories={categories}
                value={category}
                onChange={setCategory}
                dropUp
                showCreateButton
              />
            ) : (
              <div className={`${fieldClass} text-[var(--text-tertiary)]`}>Chargement…</div>
            )}
          </div>

          {/* Tags */}
          <div className="flex-1 min-w-0 max-w-xs">
            <label className={sectionLabel}>Ajouter des tags</label>
            <TagInput value={addTags} onChange={setAddTags} placeholder="Entrée pour valider…" />
          </div>

          <div className="w-px self-stretch bg-[var(--border-subtle)] flex-shrink-0" />

          {/* Actions */}
          <div className="flex-shrink-0 flex flex-col justify-center gap-2 pt-3">
            {/* Mode archives : Restaurer en priorité */}
            {isArchivedMode && (
              <Button size="sm" onClick={restore} loading={restoring}>
                ↩ Restaurer vers triage
              </Button>
            )}

            {!isArchivedMode && (
              <Button size="sm" onClick={save} loading={saving} disabled={!hasPatch}>
                Appliquer
              </Button>
            )}
            {!isArchivedMode && (
              <button
                type="button"
                onClick={() => setShowCollectionModal(true)}
                className="text-[10px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors text-right"
              >
                ▣ Collections
              </button>
            )}
            {confirmDelete ? (
              <div className="flex items-center gap-1.5 justify-end">
                <span className="text-[10px] text-red-400">Confirmer ?</span>
                <button
                  onClick={deleteAll}
                  disabled={deleting}
                  className="text-[10px] text-red-400 hover:text-red-300"
                >
                  {deleting ? "…" : "Oui"}
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="text-[10px] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                >
                  Non
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="text-[10px] text-[var(--text-tertiary)] hover:text-red-400 transition-colors text-right"
              >
                Supprimer tout
              </button>
            )}
          </div>
        </div>
      </div>
    </motion.div>

    <AnimatePresence>
      {showCollectionModal && (
        <AddToCollectionModal
          inspirationIds={selectedIds}
          onClose={() => setShowCollectionModal(false)}
          onAdded={() => onSaved()}
        />
      )}
    </AnimatePresence>
    </>
  );
}
