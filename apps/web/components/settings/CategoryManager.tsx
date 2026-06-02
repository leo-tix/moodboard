"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/Button";
import { motion, AnimatePresence } from "framer-motion";

interface Subcategory {
  id: string;
  name: string;
  slug: string;
  order: number;
}

interface Category {
  id: string;
  name: string;
  slug: string;
  icon: string | null;
  description: string | null;
  order: number;
  subcategories: Subcategory[];
  _count: { inspirationCategories: number };
}

interface CatEditFields {
  name: string;
  icon: string;
  description: string;
}

export function CategoryManager() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // ── Inline editable fields — always visible, debounced auto-save ──
  const [editMap, setEditMap] = useState<Record<string, CatEditFields>>({});
  // Ref always points to the latest editMap (avoids stale closures in setTimeout)
  const editMapRef = useRef<Record<string, CatEditFields>>({});
  editMapRef.current = editMap;
  const debounceTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const [savingCat, setSavingCat] = useState<string | null>(null);

  // ── New category form ──
  const [newCat, setNewCat] = useState({ name: "", icon: "", description: "" });
  const [addingCat, setAddingCat] = useState(false);
  const [showNewCatForm, setShowNewCatForm] = useState(false);

  // ── New subcategory per category ──
  const [newSubName, setNewSubName] = useState<Record<string, string>>({});
  const [addingSub, setAddingSub] = useState<string | null>(null);

  // ── Delete confirm ──
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const fieldClass =
    "bg-[var(--bg-base)] border border-[var(--border-subtle)] text-[var(--text-primary)] text-xs rounded px-2.5 py-1.5 focus:outline-none focus:border-[var(--border-default)] transition-colors placeholder:text-[var(--text-tertiary)]";

  // ── Merge categories into editMap without overwriting in-flight edits ──
  const mergeEditMap = useCallback((cats: Category[]) => {
    setEditMap((prev) => {
      const next = { ...prev };
      for (const c of cats) {
        if (!next[c.id]) {
          next[c.id] = {
            name: c.name,
            icon: c.icon ?? "",
            description: c.description ?? "",
          };
        }
      }
      return next;
    });
  }, []);

  useEffect(() => {
    fetch("/api/categories")
      .then((r) => r.json())
      .then((cats: Category[]) => {
        setCategories(cats);
        mergeEditMap(cats);
      })
      .finally(() => setLoading(false));
  }, [mergeEditMap]);

  const reload = useCallback(async () => {
    const cats: Category[] = await fetch("/api/categories").then((r) => r.json());
    setCategories(cats);
    mergeEditMap(cats);
  }, [mergeEditMap]);

  // ── Debounced auto-save ──
  const handleCatFieldChange = useCallback(
    (catId: string, field: keyof CatEditFields, value: string) => {
      // Update local state immediately
      setEditMap((prev) => ({
        ...prev,
        [catId]: { ...prev[catId], [field]: value },
      }));

      // Debounce PATCH
      if (debounceTimers.current[catId]) clearTimeout(debounceTimers.current[catId]);
      debounceTimers.current[catId] = setTimeout(async () => {
        const data = editMapRef.current[catId];
        if (!data) return;
        setSavingCat(catId);
        try {
          await fetch(`/api/categories/${catId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: data.name.trim() || undefined,
              icon: data.icon.trim() || undefined,
              description: data.description.trim() || undefined,
            }),
          });
        } finally {
          setSavingCat(null);
        }
      }, 800);
    },
    [] // editMapRef.current is always fresh — no stale closure
  );

  const createCategory = async () => {
    if (!newCat.name.trim()) return;
    setAddingCat(true);
    try {
      const res = await fetch("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newCat.name.trim(),
          icon: newCat.icon.trim() || undefined,
          description: newCat.description.trim() || undefined,
        }),
      });
      if (res.ok) {
        setNewCat({ name: "", icon: "", description: "" });
        setShowNewCatForm(false);
        await reload();
      }
    } finally {
      setAddingCat(false);
    }
  };

  const deleteCategory = async (id: string) => {
    setDeleting(id);
    try {
      await fetch(`/api/categories/${id}`, { method: "DELETE" });
      setConfirmDelete(null);
      // Remove from editMap
      setEditMap((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      await reload();
    } finally {
      setDeleting(null);
    }
  };

  const createSubcategory = async (categoryId: string) => {
    const name = newSubName[categoryId]?.trim();
    if (!name) return;
    setAddingSub(categoryId);
    try {
      await fetch(`/api/categories/${categoryId}/subcategories`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      setNewSubName((prev) => ({ ...prev, [categoryId]: "" }));
      await reload();
    } finally {
      setAddingSub(null);
    }
  };

  if (loading) {
    return (
      <div className="p-8 text-sm text-[var(--text-tertiary)]">Chargement…</div>
    );
  }

  return (
    <div className="p-4 md:p-8 max-w-2xl">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-lg font-medium text-[var(--text-primary)]">Catégories</h1>
          <p className="text-xs text-[var(--text-tertiary)] mt-0.5">
            {categories.length} catégorie{categories.length !== 1 ? "s" : ""}
          </p>
        </div>
        <Button size="sm" onClick={() => setShowNewCatForm((v) => !v)}>
          + Nouvelle catégorie
        </Button>
      </div>

      {/* ── Formulaire nouvelle catégorie ── */}
      <AnimatePresence>
        {showNewCatForm && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden mb-6"
          >
            <div className="border border-[var(--border-subtle)] rounded-lg p-4 bg-[var(--bg-surface)] space-y-3">
              <p className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-widest">
                Nouvelle catégorie
              </p>
              <div className="flex gap-2">
                <input
                  className={`${fieldClass} w-12 text-center`}
                  placeholder="○"
                  maxLength={2}
                  value={newCat.icon}
                  onChange={(e) => setNewCat((p) => ({ ...p, icon: e.target.value }))}
                />
                <input
                  className={`${fieldClass} flex-1`}
                  placeholder="Nom de la catégorie"
                  value={newCat.name}
                  onChange={(e) => setNewCat((p) => ({ ...p, name: e.target.value }))}
                  onKeyDown={(e) => e.key === "Enter" && createCategory()}
                  autoFocus
                />
              </div>
              <input
                className={`${fieldClass} w-full`}
                placeholder="Description (optionnel)"
                value={newCat.description}
                onChange={(e) => setNewCat((p) => ({ ...p, description: e.target.value }))}
              />
              <div className="flex gap-2 justify-end">
                <Button size="sm" variant="ghost" onClick={() => setShowNewCatForm(false)}>
                  Annuler
                </Button>
                <Button size="sm" onClick={createCategory} loading={addingCat}>
                  Créer
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Liste des catégories ── */}
      <div className="space-y-2">
        {categories.map((cat) => {
          const isExpanded = expandedId === cat.id;
          const fields = editMap[cat.id] ?? {
            name: cat.name,
            icon: cat.icon ?? "",
            description: cat.description ?? "",
          };

          return (
            <div
              key={cat.id}
              className="border border-[var(--border-subtle)] rounded-lg overflow-hidden bg-[var(--bg-surface)]"
            >
              {/* Header — icon + name always editable */}
              <div className="flex items-center gap-2 px-3 py-2.5">
                {/* Icon */}
                <input
                  className={`${fieldClass} w-10 text-center flex-shrink-0`}
                  maxLength={2}
                  value={fields.icon}
                  onChange={(e) => handleCatFieldChange(cat.id, "icon", e.target.value)}
                  placeholder="○"
                  title="Icône"
                />

                {/* Name */}
                <input
                  className={`${fieldClass} flex-1 min-w-0`}
                  value={fields.name}
                  onChange={(e) => handleCatFieldChange(cat.id, "name", e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                  placeholder="Nom…"
                />

                {/* Meta + status */}
                <span className="text-[10px] text-[var(--text-tertiary)] flex-shrink-0">
                  {cat._count.inspirationCategories} réf.
                </span>
                {savingCat === cat.id && (
                  <span className="text-[10px] text-[var(--text-tertiary)] flex-shrink-0 animate-pulse">
                    ●
                  </span>
                )}

                {/* Actions */}
                <button
                  onClick={() => setExpandedId(isExpanded ? null : cat.id)}
                  className="text-[10px] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors px-1.5 py-1 flex-shrink-0"
                  title="Sous-catégories"
                >
                  {cat.subcategories.length} ▾
                </button>

                {confirmDelete === cat.id ? (
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <span className="text-[10px] text-red-400">Supprimer ?</span>
                    <button
                      onClick={() => deleteCategory(cat.id)}
                      disabled={deleting === cat.id}
                      className="text-[10px] text-red-400 hover:text-red-300 px-1"
                    >
                      {deleting === cat.id ? "…" : "Oui"}
                    </button>
                    <button
                      onClick={() => setConfirmDelete(null)}
                      className="text-[10px] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] px-1"
                    >
                      Non
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmDelete(cat.id)}
                    className="text-[10px] text-[var(--text-tertiary)] hover:text-red-400 transition-colors px-1.5 py-1 flex-shrink-0"
                    title="Supprimer"
                  >
                    ✕
                  </button>
                )}
              </div>

              {/* Description — always visible, compact */}
              <div className="px-3 pb-2.5">
                <input
                  className={`${fieldClass} w-full`}
                  placeholder="Description (optionnel)"
                  value={fields.description}
                  onChange={(e) => handleCatFieldChange(cat.id, "description", e.target.value)}
                />
              </div>

              {/* ── Sous-catégories ── */}
              <AnimatePresence>
                {isExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="border-t border-[var(--border-subtle)] px-4 py-3 space-y-2 bg-[var(--bg-base)]">
                      {cat.subcategories.length === 0 && (
                        <p className="text-[11px] text-[var(--text-tertiary)]">
                          Aucune sous-catégorie
                        </p>
                      )}
                      {cat.subcategories.map((sub) => (
                        <div
                          key={sub.id}
                          className="flex items-center gap-2 text-xs text-[var(--text-secondary)]"
                        >
                          <span className="text-[var(--text-tertiary)] text-[10px]">└</span>
                          <span className="flex-1">{sub.name}</span>
                        </div>
                      ))}

                      {/* Ajouter sous-catégorie */}
                      <div className="flex gap-2 pt-1">
                        <input
                          className={`${fieldClass} flex-1`}
                          placeholder="Nouvelle sous-catégorie…"
                          value={newSubName[cat.id] ?? ""}
                          onChange={(e) =>
                            setNewSubName((p) => ({ ...p, [cat.id]: e.target.value }))
                          }
                          onKeyDown={(e) => e.key === "Enter" && createSubcategory(cat.id)}
                        />
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => createSubcategory(cat.id)}
                          loading={addingSub === cat.id}
                        >
                          Ajouter
                        </Button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>

      {categories.length === 0 && (
        <p className="text-sm text-[var(--text-tertiary)] text-center py-12">
          Aucune catégorie. Créez-en une pour commencer.
        </p>
      )}
    </div>
  );
}
