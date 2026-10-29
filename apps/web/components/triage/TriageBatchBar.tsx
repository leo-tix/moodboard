"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { CategorySelect, type Category } from "@/components/inspiration/CategorySelect";
import { TagInput } from "@/components/inspiration/TagInput";

interface TriageBatchBarProps {
  selectedIds: string[];
  onClear:     () => void;
  /** Image(s) acceptée(s)/archivée(s) ou supprimée(s) — à retirer de la file côté appelant */
  onDecided:   (ids: string[]) => void;
  /** Métadonnées appliquées (catégorie/tags) — pas de retrait de la file */
  onMetaSaved: () => void;
}

const fieldClass =
  "w-full bg-[var(--bg-base)] border border-[var(--border-subtle)] text-[var(--text-primary)] text-xs rounded px-2.5 py-1.5 focus:outline-none focus:border-[var(--border-default)] transition-colors placeholder:text-[var(--text-tertiary)]";
const sectionLabel = "block text-[9px] text-[var(--text-tertiary)] uppercase tracking-widest mb-1.5";

// Barre d'édition en masse pour la vue galerie du triage — même famille
// visuelle que BatchEditBar (bibliothèque), mais orientée décision
// (Accepter/Archiver en masse) plutôt que restauration d'archives.
export function TriageBatchBar({ selectedIds, onClear, onDecided, onMetaSaved }: TriageBatchBarProps) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [category, setCategory] = useState({ categoryId: "", subcategoryId: "" });
  const [addTags, setAddTags] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    fetch("/api/categories").then((r) => r.json()).then(setCategories).catch(() => {});
  }, []);

  const hasPatch = category.categoryId || addTags.length > 0;

  const applyMeta = async () => {
    if (!hasPatch) return;
    setSaving(true);
    try {
      await fetch("/api/inspirations/batch", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ids: selectedIds,
          patch: {
            ...(category.categoryId
              ? { addCategory: { categoryId: category.categoryId, subcategoryId: category.subcategoryId || null } }
              : {}),
            ...(addTags.length > 0 ? { addTags } : {}),
          },
        }),
      });
      setCategory({ categoryId: "", subcategoryId: "" });
      setAddTags([]);
      onMetaSaved();
    } finally {
      setSaving(false);
    }
  };

  const decide = async (action: "accept" | "archive") => {
    const setBusy = action === "accept" ? setAccepting : setArchiving;
    setBusy(true);
    try {
      await fetch("/api/triage/batch", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selectedIds, action }),
      });
      onDecided(selectedIds);
    } finally {
      setBusy(false);
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
      onDecided(selectedIds);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <motion.div
      initial={{ y: 100, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 100, opacity: 0 }}
      transition={{ type: "spring", bounce: 0.1, duration: 0.35 }}
      className="fixed bottom-14 md:bottom-0 left-0 md:left-14 xl:left-56 right-0 z-50"
    >
      <div
        className="bg-[var(--bg-elevated)]/95 backdrop-blur border-t border-[var(--border-default)] rounded-t-2xl md:rounded-none px-4 pt-3 pb-3"
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      >
        {/* ── Mobile : pile verticale ── */}
        <div className="md:hidden flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-[var(--text-primary)]">
              {selectedIds.length} sélectionnée{selectedIds.length > 1 ? "s" : ""}
            </p>
            <button onClick={onClear} className="text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors">
              Désélectionner
            </button>
          </div>

          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => decide("archive")} loading={archiving} variant="secondary" className="flex-1">
              <span className="inline-flex items-center gap-1.5"><X size={14} strokeWidth={2} /> Archiver</span>
            </Button>
            <Button size="sm" onClick={() => decide("accept")} loading={accepting} className="flex-1">
              <span className="inline-flex items-center gap-1.5"><Check size={14} strokeWidth={2} /> Accepter</span>
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className={sectionLabel}>Catégorie</label>
              {categories.length > 0 ? (
                <CategorySelect categories={categories} value={category} onChange={setCategory} dropUp showCreateButton />
              ) : (
                <div className={`${fieldClass} text-[var(--text-tertiary)]`}>Chargement…</div>
              )}
            </div>
            <div>
              <label className={sectionLabel}>Tags</label>
              <TagInput value={addTags} onChange={setAddTags} placeholder="Entrée pour valider…" />
            </div>
          </div>
          <Button size="sm" onClick={applyMeta} loading={saving} disabled={!hasPatch} variant="secondary" className="w-full">
            Appliquer les métadonnées
          </Button>

          {confirmDelete ? (
            <div className="flex items-center justify-end gap-2">
              <span className="text-xs text-red-400">Confirmer ?</span>
              <button onClick={deleteAll} disabled={deleting} className="text-xs font-medium text-red-400 hover:text-red-300">
                {deleting ? "…" : "Oui"}
              </button>
              <button onClick={() => setConfirmDelete(false)} className="text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]">
                Non
              </button>
            </div>
          ) : (
            <button onClick={() => setConfirmDelete(true)} className="text-xs text-[var(--text-tertiary)] hover:text-red-400 transition-colors text-right">
              Supprimer tout
            </button>
          )}
        </div>

        {/* ── Desktop : rangée horizontale ── */}
        <div className="hidden md:flex items-start gap-4 max-w-5xl">
          <div className="flex-shrink-0 pt-4">
            <p className="text-sm font-medium text-[var(--text-primary)]">
              {selectedIds.length} sélectionnée{selectedIds.length > 1 ? "s" : ""}
            </p>
            <button onClick={onClear} className="text-[10px] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors mt-0.5">
              Tout désélectionner
            </button>
          </div>

          <div className="w-px self-stretch bg-[var(--border-subtle)] flex-shrink-0" />

          <div className="w-44 flex-shrink-0">
            <label className={sectionLabel}>Catégorie</label>
            {categories.length > 0 ? (
              <CategorySelect categories={categories} value={category} onChange={setCategory} dropUp showCreateButton />
            ) : (
              <div className={`${fieldClass} text-[var(--text-tertiary)]`}>Chargement…</div>
            )}
          </div>

          <div className="w-44 flex-shrink-0">
            <label className={sectionLabel}>Ajouter des tags</label>
            <TagInput value={addTags} onChange={setAddTags} placeholder="Entrée pour valider…" />
          </div>

          <div className="flex-shrink-0 flex flex-col justify-center gap-2 pt-3">
            <Button size="sm" onClick={applyMeta} loading={saving} disabled={!hasPatch} variant="secondary">
              Appliquer
            </Button>
            {confirmDelete ? (
              <div className="flex items-center gap-1.5 justify-end">
                <span className="text-[10px] text-red-400">Confirmer ?</span>
                <button onClick={deleteAll} disabled={deleting} className="text-[10px] text-red-400 hover:text-red-300">
                  {deleting ? "…" : "Oui"}
                </button>
                <button onClick={() => setConfirmDelete(false)} className="text-[10px] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]">
                  Non
                </button>
              </div>
            ) : (
              <button onClick={() => setConfirmDelete(true)} className="text-[10px] text-[var(--text-tertiary)] hover:text-red-400 transition-colors text-right">
                Supprimer tout
              </button>
            )}
          </div>

          <div className="w-px self-stretch bg-[var(--border-subtle)] flex-shrink-0" />

          <div className="flex-shrink-0 flex flex-col justify-center gap-2 pt-3">
            <Button size="sm" onClick={() => decide("accept")} loading={accepting}>
              <span className="inline-flex items-center gap-1.5"><Check size={14} strokeWidth={2} /> Accepter</span>
            </Button>
            <Button size="sm" onClick={() => decide("archive")} loading={archiving} variant="secondary">
              <span className="inline-flex items-center gap-1.5"><X size={14} strokeWidth={2} /> Archiver</span>
            </Button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
