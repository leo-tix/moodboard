"use client";

import { useState, useEffect } from "react";
import { CategorySelect, type Category, type CategoryValue } from "./CategorySelect";

export interface CategorySelection {
  categoryId: string;
  subcategoryId?: string | null;
}

interface CategoryMultiSelectProps {
  categories: Category[];
  value: CategorySelection[];
  onChange: (value: CategorySelection[]) => void;
}

export function CategoryMultiSelect({ categories, value, onChange }: CategoryMultiSelectProps) {
  const [localCats, setLocalCats] = useState<Category[]>(categories);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<CategoryValue>({ categoryId: "", subcategoryId: "" });

  useEffect(() => { setLocalCats(categories); }, [categories]);

  const getCatName = (sel: CategorySelection) => {
    const cat = localCats.find((c) => c.id === sel.categoryId);
    if (!cat) return sel.categoryId;
    const sub = sel.subcategoryId ? cat.subcategories.find((s) => s.id === sel.subcategoryId) : null;
    return sub ? `${cat.icon ?? ""} ${cat.name} › ${sub.name}` : `${cat.icon ?? ""} ${cat.name}`;
  };

  const remove = (categoryId: string) => {
    onChange(value.filter((s) => s.categoryId !== categoryId));
  };

  const confirmAdd = () => {
    if (!draft.categoryId) return;
    // Replace if same category already selected, otherwise append
    const exists = value.find((s) => s.categoryId === draft.categoryId);
    if (exists) {
      onChange(value.map((s) =>
        s.categoryId === draft.categoryId
          ? { ...s, subcategoryId: draft.subcategoryId || null }
          : s
      ));
    } else {
      onChange([...value, { categoryId: draft.categoryId, subcategoryId: draft.subcategoryId || null }]);
    }
    setDraft({ categoryId: "", subcategoryId: "" });
    setAdding(false);
  };

  return (
    <div className="space-y-2">
      {/* Selected chips */}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((sel) => (
            <div
              key={sel.categoryId}
              className="flex items-center gap-1 bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded px-2 py-1 text-xs text-[var(--text-secondary)]"
            >
              <span className="truncate max-w-[160px]">{getCatName(sel)}</span>
              <button
                type="button"
                onClick={() => remove(sel.categoryId)}
                className="text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] ml-0.5 flex-shrink-0"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add selector */}
      {adding ? (
        <div className="space-y-1.5">
          <CategorySelect
            categories={localCats}
            value={draft}
            onChange={setDraft}
            showCreateButton
            onCategoryCreated={(cat) => setLocalCats((prev) => [...prev, cat])}
          />
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={confirmAdd}
              disabled={!draft.categoryId}
              className="px-3 py-1 bg-[var(--text-primary)] text-[var(--bg-base)] text-xs rounded disabled:opacity-40 transition-opacity"
            >
              Ajouter
            </button>
            <button
              type="button"
              onClick={() => { setAdding(false); setDraft({ categoryId: "", subcategoryId: "" }); }}
              className="px-3 py-1 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] text-xs transition-colors"
            >
              Annuler
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors border border-dashed border-[var(--border-subtle)] rounded px-3 py-1.5 w-full"
        >
          + {value.length === 0 ? "Ajouter une catégorie" : "Ajouter une autre catégorie"}
        </button>
      )}
    </div>
  );
}
