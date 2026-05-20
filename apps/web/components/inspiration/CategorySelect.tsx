"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

interface Subcategory {
  id: string;
  name: string;
  slug: string;
}

interface Category {
  id: string;
  name: string;
  slug: string;
  icon: string | null;
  subcategories: Subcategory[];
}

interface CategorySelectProps {
  categories: Category[];
  value: { categoryId: string; subcategoryId: string };
  onChange: (value: { categoryId: string; subcategoryId: string }) => void;
  className?: string;
}

export function CategorySelect({
  categories,
  value,
  onChange,
  className,
}: CategorySelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selectedCategory = categories.find((c) => c.id === value.categoryId);
  const selectedSub = selectedCategory?.subcategories.find(
    (s) => s.id === value.subcategoryId
  );

  // Ferme au clic extérieur
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const selectCategory = (categoryId: string) => {
    onChange({ categoryId, subcategoryId: "" });
  };

  const selectSub = (subcategoryId: string) => {
    onChange({ ...value, subcategoryId });
    setOpen(false);
  };

  const clear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange({ categoryId: "", subcategoryId: "" });
    setOpen(false);
  };

  const label = selectedSub
    ? `${selectedCategory?.icon ?? ""} ${selectedCategory?.name} › ${selectedSub.name}`
    : selectedCategory
    ? `${selectedCategory.icon ?? ""} ${selectedCategory.name}`
    : "Catégorie";

  return (
    <div ref={ref} className={cn("relative", className)}>
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between bg-[var(--bg-base)] border border-[var(--border-subtle)] text-xs rounded px-2.5 py-1.5 focus:outline-none focus:border-[var(--border-default)] transition-colors group"
      >
        <span className={selectedCategory ? "text-[var(--text-primary)]" : "text-[var(--text-tertiary)]"}>
          {label}
        </span>
        <div className="flex items-center gap-1">
          {selectedCategory && (
            <span
              onClick={clear}
              className="text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] px-1"
            >
              ×
            </span>
          )}
          <span className="text-[var(--text-tertiary)] text-[10px]">
            {open ? "▲" : "▼"}
          </span>
        </div>
      </button>

      {/* Dropdown */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="absolute z-50 top-full left-0 mt-1 w-full bg-[var(--bg-elevated)] border border-[var(--border-default)] rounded-md shadow-xl overflow-hidden"
            style={{ minWidth: "320px" }}
          >
            <div className="flex" style={{ maxHeight: "340px" }}>
              {/* Colonne catégories */}
              <div className="w-44 border-r border-[var(--border-subtle)] overflow-y-auto flex-shrink-0">
                <div className="p-1">
                  {categories.map((cat) => (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => selectCategory(cat.id)}
                      className={cn(
                        "w-full text-left flex items-center gap-2 px-2.5 py-2 rounded text-xs transition-colors",
                        value.categoryId === cat.id
                          ? "bg-[var(--bg-overlay)] text-[var(--text-primary)]"
                          : "text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)]"
                      )}
                    >
                      <span className="opacity-60 flex-shrink-0 w-4 text-center">
                        {cat.icon}
                      </span>
                      <span className="truncate">{cat.name}</span>
                      {cat.subcategories.length > 0 && (
                        <span className="ml-auto text-[10px] opacity-30 flex-shrink-0">›</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* Colonne sous-catégories */}
              <div className="flex-1 overflow-y-auto">
                {selectedCategory ? (
                  <div className="p-1">
                    <button
                      type="button"
                      onClick={() => selectSub("")}
                      className={cn(
                        "w-full text-left px-2.5 py-2 rounded text-xs transition-colors mb-0.5",
                        !value.subcategoryId
                          ? "bg-[var(--bg-overlay)] text-[var(--text-primary)]"
                          : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-surface)]"
                      )}
                    >
                      Toutes ({selectedCategory.name})
                    </button>
                    {selectedCategory.subcategories.map((sub) => (
                      <button
                        key={sub.id}
                        type="button"
                        onClick={() => selectSub(sub.id)}
                        className={cn(
                          "w-full text-left px-2.5 py-1.5 rounded text-xs transition-colors",
                          value.subcategoryId === sub.id
                            ? "bg-[var(--bg-overlay)] text-[var(--text-primary)]"
                            : "text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)]"
                        )}
                      >
                        {sub.name}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-full p-4">
                    <p className="text-[10px] text-[var(--text-tertiary)] text-center">
                      Sélectionne une catégorie
                    </p>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
