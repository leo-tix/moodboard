"use client";

import { useState, useEffect, useCallback } from "react";
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

  // Called when the user makes a final selection in the dropdown (sub-cat click or "Toutes")
  const handleConfirm = useCallback((confirmed: CategoryValue) => {
    if (!confirmed.categoryId) return;
    const exists = value.find((s) => s.categoryId === confirmed.categoryId);
    if (exists) {
      // Update subcategory if same category already selected
      onChange(value.map((s) =>
        s.categoryId === confirmed.categoryId
          ? { ...s, subcategoryId: confirmed.subcategoryId || null }
          : s
      ));
    } else {
      onChange([...value, { categoryId: confirmed.categoryId, subcategoryId: confirmed.subcategoryId || null }]);
    }
    // Reset picker for the next selection
    setDraft({ categoryId: "", subcategoryId: "" });
  }, [value, onChange]);

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

      {/* Picker — always visible, selection = immediate add */}
      <CategorySelect
        categories={localCats}
        value={draft}
        onChange={setDraft}
        onConfirm={handleConfirm}
        showCreateButton
        onCategoryCreated={(cat) => setLocalCats((prev) => [...prev, cat])}
      />
    </div>
  );
}
