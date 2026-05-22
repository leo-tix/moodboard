"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

export interface Subcategory {
  id: string;
  name: string;
  slug: string;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  icon: string | null;
  subcategories: Subcategory[];
}

export interface CategoryValue {
  categoryId: string;
  subcategoryId: string;
}

interface DropdownPos {
  top?: number;
  bottom?: number;
  left: number;
  width: number;
}

interface CategorySelectProps {
  categories: Category[];
  value: CategoryValue;
  onChange: (value: CategoryValue) => void;
  className?: string;
  dropUp?: boolean;
  showCreateButton?: boolean;
  onCategoryCreated?: (cat: Category) => void;
}

const fieldClass =
  "w-full bg-[var(--bg-base)] border border-[var(--border-subtle)] text-[var(--text-primary)] text-xs rounded px-2.5 py-1.5 focus:outline-none focus:border-[var(--border-default)] transition-colors placeholder:text-[var(--text-tertiary)]";

export function CategorySelect({
  categories: categoriesProp,
  value,
  onChange,
  className,
  dropUp = false,
  showCreateButton = false,
  onCategoryCreated,
}: CategorySelectProps) {
  const [open, setOpen] = useState(false);
  const [cats, setCats] = useState<Category[]>(categoriesProp);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [pos, setPos] = useState<DropdownPos>({ top: 0, left: 0, width: 320 });
  const [mounted, setMounted] = useState(false);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setMounted(true); }, []);
  useEffect(() => { setCats(categoriesProp); }, [categoriesProp]);

  const calculatePos = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const width = Math.max(320, rect.width);

    // Ensure dropdown doesn't go off right edge
    const left = Math.min(rect.left, window.innerWidth - width - 8);

    if (dropUp) {
      setPos({ bottom: window.innerHeight - rect.top + 4, left, width });
    } else {
      // Check if enough room below; if not, flip up
      const spaceBelow = window.innerHeight - rect.bottom;
      if (spaceBelow < 300 && rect.top > 300) {
        setPos({ bottom: window.innerHeight - rect.top + 4, left, width });
      } else {
        setPos({ top: rect.bottom + 4, left, width });
      }
    }
  }, [dropUp]);

  const handleOpen = () => {
    if (!open) calculatePos();
    setOpen((o) => !o);
    setShowCreate(false);
  };

  // Close on outside click or touch (checks both trigger and portal dropdown)
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent | TouchEvent) => {
      const target = (e instanceof TouchEvent ? e.touches[0]?.target : e.target) as Node | null;
      if (!target) return;
      if (
        triggerRef.current?.contains(target) ||
        dropdownRef.current?.contains(target)
      ) return;
      setOpen(false);
      setShowCreate(false);
    };
    document.addEventListener("mousedown", handler as EventListener);
    document.addEventListener("touchstart", handler as EventListener);
    return () => {
      document.removeEventListener("mousedown", handler as EventListener);
      document.removeEventListener("touchstart", handler as EventListener);
    };
  }, [open]);

  const selectedCategory = cats.find((c) => c.id === value.categoryId);
  const selectedSub = selectedCategory?.subcategories.find((s) => s.id === value.subcategoryId);

  const selectCategory = (categoryId: string) => onChange({ categoryId, subcategoryId: "" });
  const selectSub = (subcategoryId: string) => { onChange({ ...value, subcategoryId }); setOpen(false); };
  const clear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange({ categoryId: "", subcategoryId: "" });
    setOpen(false);
  };

  const createCategory = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });
      if (res.ok) {
        const cat: Category = await res.json();
        setCats((prev) => [...prev, cat]);
        onChange({ categoryId: cat.id, subcategoryId: "" });
        onCategoryCreated?.(cat);
        setNewName("");
        setShowCreate(false);
        setOpen(false);
      }
    } finally {
      setCreating(false);
    }
  };

  const label = selectedSub
    ? `${selectedCategory?.icon ?? ""} ${selectedCategory?.name} › ${selectedSub.name}`
    : selectedCategory
    ? `${selectedCategory.icon ?? ""} ${selectedCategory.name}`
    : "Catégorie";

  const dropdown = (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={dropdownRef}
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.12 }}
          style={{
            position: "fixed",
            zIndex: 9999,
            left: pos.left,
            width: pos.width,
            ...(pos.top !== undefined ? { top: pos.top } : {}),
            ...(pos.bottom !== undefined ? { bottom: pos.bottom } : {}),
          }}
          className="bg-[var(--bg-elevated)] border border-[var(--border-default)] rounded-md shadow-2xl overflow-hidden"
        >
          <div className="flex" style={{ maxHeight: "280px" }}>
            {/* Categories column */}
            <div className="w-44 border-r border-[var(--border-subtle)] overflow-y-auto flex-shrink-0">
              <div className="p-1">
                {cats.map((cat) => (
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
                    <span className="opacity-60 flex-shrink-0 w-4 text-center">{cat.icon}</span>
                    <span className="truncate">{cat.name}</span>
                    {cat.subcategories.length > 0 && (
                      <span className="ml-auto text-[10px] opacity-30 flex-shrink-0">›</span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Subcategories column */}
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

          {/* Quick create */}
          {showCreateButton && (
            <div className="border-t border-[var(--border-subtle)] p-2">
              {showCreate ? (
                <div className="flex gap-1.5">
                  <input
                    autoFocus
                    className={`${fieldClass} flex-1`}
                    placeholder="Nom de la catégorie"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") createCategory();
                      if (e.key === "Escape") setShowCreate(false);
                    }}
                  />
                  <button
                    onClick={createCategory}
                    disabled={creating || !newName.trim()}
                    className="px-2.5 py-1.5 bg-[var(--text-primary)] text-[var(--bg-base)] text-xs rounded disabled:opacity-40 flex-shrink-0"
                  >
                    {creating ? "…" : "Créer"}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowCreate(true)}
                  className="w-full text-left text-[10px] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors px-1 py-1"
                >
                  ＋ Nouvelle catégorie
                </button>
              )}
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );

  return (
    <div className={cn("relative", className)}>
      <button
        ref={triggerRef}
        type="button"
        onClick={handleOpen}
        className="w-full flex items-center justify-between bg-[var(--bg-base)] border border-[var(--border-subtle)] text-xs rounded px-2.5 py-1.5 focus:outline-none focus:border-[var(--border-default)] transition-colors"
      >
        <span className={selectedCategory ? "text-[var(--text-primary)]" : "text-[var(--text-tertiary)]"}>
          {label}
        </span>
        <div className="flex items-center gap-1">
          {selectedCategory && (
            <span onClick={clear} className="text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] px-1">×</span>
          )}
          <span className="text-[var(--text-tertiary)] text-[10px]">{open ? "▲" : "▼"}</span>
        </div>
      </button>

      {/* Render dropdown via portal to escape overflow:hidden/auto containers */}
      {mounted && createPortal(dropdown, document.body)}
    </div>
  );
}
