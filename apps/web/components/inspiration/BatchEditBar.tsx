"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";
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
  // Bascule mobile entre le panneau "Actions" (défaut — Restaurer/Collections/
  // Supprimer) et "Modifier" (Titre/Catégorie/Tags + Appliquer), retiré
  // ci-avant puis redemandé par l'utilisateur : garder la feuille mobile
  // épurée par défaut tout en gardant l'édition de métadonnées accessible.
  const [mobilePanel, setMobilePanel] = useState<"actions" | "edit">("actions");

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
      <div className="bg-[var(--bg-elevated)]/95 backdrop-blur border-t border-[var(--border-default)] rounded-t-2xl md:rounded-none px-4 pt-2 md:pt-3 pb-3"
           style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>

        {/* ───────── Mobile : feuille verticale, pas de scroll horizontal.
            Bascule "Actions" / "Modifier" à indicateur glissant (framer
            layoutId) : la feuille reste épurée par défaut (Restaurer/
            Collections/Supprimer) tout en gardant l'édition de métadonnées
            en masse (Titre/Catégorie/Tags) à un tap, y compris en mode
            archives. */}
        <div className="md:hidden">
          <div className="flex justify-center pb-2">
            <div className="w-8 h-1 rounded-full bg-[var(--border-default)]" />
          </div>

          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-medium text-[var(--text-primary)]">
              {selectedIds.length} sélectionnée{selectedIds.length > 1 ? "s" : ""}
            </p>
            <button onClick={onClear} className="text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors">
              Désélectionner
            </button>
          </div>

          {/* Bascule à indicateur glissant */}
          <div className="relative flex p-1 mb-3 rounded-lg bg-[var(--bg-surface)]">
            {(["actions", "edit"] as const).map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => setMobilePanel(id)}
                className="relative flex-1 py-1.5 text-xs font-medium rounded-md"
              >
                {mobilePanel === id && (
                  <motion.div
                    layoutId="batchEditBarTabIndicator"
                    className="absolute inset-0 rounded-md bg-[var(--bg-elevated)] shadow-sm"
                    transition={{ type: "spring", bounce: 0.15, duration: 0.25 }}
                  />
                )}
                <span className={cn(
                  "relative z-10 transition-colors",
                  mobilePanel === id ? "text-[var(--text-primary)]" : "text-[var(--text-tertiary)]"
                )}>
                  {id === "actions" ? "Actions" : "Modifier"}
                </span>
              </button>
            ))}
          </div>

          {mobilePanel === "edit" ? (
            <div className="flex flex-col gap-3">
              <div>
                <label className={sectionLabel}>Titre (identique)</label>
                <input
                  className={fieldClass}
                  placeholder="Laisser vide = inchangé"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <div>
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
                <div>
                  <label className={sectionLabel}>Tags</label>
                  <TagInput value={addTags} onChange={setAddTags} placeholder="Entrée pour valider…" />
                </div>
              </div>
              <Button onClick={save} loading={saving} disabled={!hasPatch} className="w-full">
                Appliquer
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {isArchivedMode && (
                <Button onClick={restore} loading={restoring} className="w-full">
                  <span className="inline-flex items-center gap-1.5"><Undo2 size={14} strokeWidth={1.75} /> Restaurer vers triage</span>
                </Button>
              )}

              <div className="flex items-center justify-between gap-3 px-0.5">
                {!isArchivedMode ? (
                  <button
                    type="button"
                    onClick={() => setShowCollectionModal(true)}
                    className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                  >
                    ▣ Ajouter à une collection
                  </button>
                ) : <span />}

                {confirmDelete ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-red-400">Confirmer ?</span>
                    <button onClick={deleteAll} disabled={deleting} className="text-xs font-medium text-red-400 hover:text-red-300">
                      {deleting ? "…" : "Oui"}
                    </button>
                    <button onClick={() => setConfirmDelete(false)} className="text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]">
                      Non
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmDelete(true)}
                    className="text-xs text-[var(--text-tertiary)] hover:text-red-400 transition-colors"
                  >
                    Supprimer tout
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ───────── Desktop : rangée horizontale compacte (espace large,
            pas besoin de scroll ni de pile verticale). ───────── */}
        <div className="hidden md:flex items-start gap-4 max-w-5xl">
          <div className="flex-shrink-0 pt-4">
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

          <div className="w-px self-stretch bg-[var(--border-subtle)] flex-shrink-0" />

          {/* Titre/Catégorie/Tags : toujours visibles (y compris en mode
              archives) — Appliquer est désormais toujours disponible aussi
              (voir Actions ci-dessous), ces champs ne sont donc plus jamais
              un cul-de-sac. Édition en masse redemandée par l'utilisateur
              après avoir été retirée par erreur du mode archives. */}
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
          <div className="w-44 flex-shrink-0">
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
          <div className="w-44 flex-shrink-0">
            <label className={sectionLabel}>Ajouter des tags</label>
            <TagInput value={addTags} onChange={setAddTags} placeholder="Entrée pour valider…" />
          </div>

          <div className="w-px self-stretch bg-[var(--border-subtle)] flex-shrink-0" />

          {/* Actions */}
          <div className="flex-shrink-0 flex flex-col justify-center gap-2 pt-3">
            {isArchivedMode && (
              <Button size="sm" onClick={restore} loading={restoring}>
                <span className="inline-flex items-center gap-1.5"><Undo2 size={14} strokeWidth={1.75} /> Restaurer vers triage</span>
              </Button>
            )}
            <Button size="sm" onClick={save} loading={saving} disabled={!hasPatch}>
              Appliquer
            </Button>
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
