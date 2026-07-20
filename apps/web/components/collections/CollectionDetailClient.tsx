"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Pencil, X, ArrowUpDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSortableGrid } from "@/hooks/useSortableGrid";
import { getThumbnailUrl } from "@/lib/storage/urls";
import type { SuggestedAddition } from "@/lib/collections/suggestions";
import type { CollectionMember } from "@/lib/collections/members";
import { MemberAvatars } from "@/components/collections/MemberAvatars";
import { SaveToLibraryButton } from "@/components/collections/SaveToLibraryButton";
import { UserAvatar } from "@/components/social/UserAvatar";

type Adder = { id: string; name: string | null; username: string | null; image: string | null };

interface InspirationItem {
  addedBy?: Adder | null;
  inspiration: {
    id: string;
    userId: string;
    title: string;
    year: number | null;
    images: {
      id: string;
      thumbnailKey: string | null;
      blurHash: string | null;
      width: number | null;
      height: number | null;
    }[];
    categories: { category: { name: string } }[];
    tags: { tag: { name: string } }[];
  };
}

interface CollectionDetailClientProps {
  collectionId: string;
  viewerId: string;
  members: CollectionMember[];
  initialName: string;
  initialDescription: string | null;
  initialItems: InspirationItem[];
  suggestions: SuggestedAddition[];
}

export function CollectionDetailClient({
  collectionId,
  viewerId,
  members,
  initialName,
  initialDescription,
  initialItems,
  suggestions: initialSuggestions,
}: CollectionDetailClientProps) {
  const [items, setItems] = useState(initialItems);
  const [reorderMode, setReorderMode] = useState(false);
  const isShared = members.length > 1;
  const meMember = members.find((m) => m.id === viewerId) ?? null;

  // Réordonnancement DnD (overlay + fantôme, cf. useSortableGrid).
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const sortable = useSortableGrid({
    onReorder: (draggedId, targetId) => {
      setItems((prev) => {
        const from = prev.findIndex((it) => it.inspiration.id === draggedId);
        const to = prev.findIndex((it) => it.inspiration.id === targetId);
        if (from === -1 || to === -1 || from === to) return prev;
        const next = [...prev];
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        return next;
      });
    },
    onDrop: () => {
      const order = itemsRef.current.map((it) => it.inspiration.id);
      void fetch(`/api/collections/${collectionId}/items/reorder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order }),
      });
    },
  });
  const dragged = sortable.draggingKey ? items.find((it) => it.inspiration.id === sortable.draggingKey) : null;
  const [removing, setRemoving] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [suggestions, setSuggestions] = useState(initialSuggestions);
  const [adding, setAdding] = useState<string | null>(null);
  const [name, setName] = useState(initialName);
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(initialName);

  const commitRename = async () => {
    const trimmed = nameValue.trim();
    setIsEditingName(false);
    if (!trimmed || trimmed === name) return;
    setName(trimmed);
    await fetch(`/api/collections/${collectionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: trimmed }),
    });
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const removeOne = async (inspirationId: string) => {
    setRemoving(inspirationId);
    try {
      await fetch(`/api/collections/${collectionId}/items`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inspirationIds: [inspirationId] }),
      });
      setItems((prev) => prev.filter((it) => it.inspiration.id !== inspirationId));
    } finally {
      setRemoving(null);
    }
  };

  const removeSelected = async () => {
    const ids = Array.from(selected);
    setRemoving("batch");
    try {
      await fetch(`/api/collections/${collectionId}/items`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inspirationIds: ids }),
      });
      setItems((prev) => prev.filter((it) => !ids.includes(it.inspiration.id)));
      setSelected(new Set());
      setSelectMode(false);
    } finally {
      setRemoving(null);
    }
  };

  const addSuggestion = async (suggestion: SuggestedAddition) => {
    setAdding(suggestion.id);
    try {
      await fetch(`/api/collections/${collectionId}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inspirationIds: [suggestion.id] }),
      });
      // Retirer de la liste des suggestions
      setSuggestions((prev) => prev.filter((s) => s.id !== suggestion.id));
      // Ajouter aux items localement
      setItems((prev) => [
        ...prev,
        {
          addedBy: meMember,
          inspiration: {
            id: suggestion.id,
            userId: viewerId, // les suggestions viennent de MA bibliothèque
            title: suggestion.title,
            year: suggestion.year,
            images: [
              {
                id: "",
                thumbnailKey: suggestion.thumbnailKey,
                blurHash: suggestion.blurHash,
                width: suggestion.width,
                height: suggestion.height,
              },
            ],
            categories: [],
            tags: [],
          },
        },
      ]);
    } finally {
      setAdding(null);
    }
  };

  const dismissSuggestion = (id: string) => {
    setSuggestions((prev) => prev.filter((s) => s.id !== id));
  };

  // Contexte de navigation pour la visionneuse plein écran (←/→) — sans ça,
  // ouvrir une image depuis une collection retombait sur le repli "toute la
  // bibliothèque" de GalleryStrip (aucun contexte écrit), au lieu de ne
  // parcourir que les images de CETTE collection.
  const handleBeforeNavigate = useCallback(() => {
    try {
      const context = {
        items: items.map(({ inspiration }) => ({
          id: inspiration.id,
          title: inspiration.title,
          thumbnailKey: inspiration.images[0]?.thumbnailKey ?? null,
        })),
      };
      sessionStorage.setItem("moodboard:libraryNav", JSON.stringify(context));
    } catch {
      // sessionStorage unavailable
    }
  }, [items]);

  return (
    <div className="space-y-10">

      {/* ── Titre éditable + membres ── */}
      <div className="flex items-start justify-between gap-3">
      <div className="group/title flex items-center gap-2">
        {isEditingName ? (
          <input
            autoFocus
            className="text-2xl font-light bg-transparent border-b border-[var(--accent,#a78bfa)] text-[var(--text-primary)] focus:outline-none w-full max-w-md"
            value={nameValue}
            onChange={(e) => setNameValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") { setIsEditingName(false); setNameValue(name); }
            }}
          />
        ) : (
          <>
            <h1 className="text-2xl font-light text-[var(--text-primary)]">{name}</h1>
            <button
              onClick={() => { setNameValue(name); setIsEditingName(true); }}
              className="opacity-60 md:opacity-0 md:group-hover/title:opacity-100 transition-opacity text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] inline-flex items-center"
              title="Renommer"
            >
              <Pencil size={15} strokeWidth={1.75} />
            </button>
          </>
        )}
        {initialDescription && (
          <p className="text-sm text-[var(--text-secondary)] ml-1">{initialDescription}</p>
        )}
      </div>
        <div className="pt-1 shrink-0"><MemberAvatars members={members} /></div>
      </div>

      {/* ── Collection items ── */}
      <div>
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <p className="text-[var(--text-tertiary)] text-sm">Cette collection est vide.</p>
            <p className="text-[var(--text-tertiary)] text-xs mt-1">
              Ajoutez des images depuis la bibliothèque ou via les suggestions ci-dessous.
            </p>
          </div>
        ) : (
          <>
            {/* Toolbar */}
            <div className="flex items-center justify-between mb-4">
              <p className="text-xs text-[var(--text-tertiary)]">
                {items.length} image{items.length !== 1 ? "s" : ""}
              </p>
              <div className="flex items-center gap-3">
                {selectMode && selected.size > 0 && (
                  <button
                    onClick={removeSelected}
                    disabled={removing === "batch"}
                    className="text-xs text-red-400 hover:text-red-300 transition-colors disabled:opacity-40"
                  >
                    {removing === "batch"
                      ? "Retrait…"
                      : `Retirer ${selected.size} image${selected.size > 1 ? "s" : ""}`}
                  </button>
                )}
                {!selectMode && items.length > 1 && (
                  <button
                    onClick={() => setReorderMode((v) => !v)}
                    className={cn("text-xs transition-colors inline-flex items-center gap-1", reorderMode ? "text-[var(--accent,#a78bfa)]" : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]")}
                  >
                    {reorderMode ? <><Check size={13} strokeWidth={2} /> Terminé</> : <><ArrowUpDown size={13} strokeWidth={1.9} /> Réorganiser</>}
                  </button>
                )}
                {!reorderMode && (
                  <button
                    onClick={() => {
                      setSelectMode((v) => !v);
                      setSelected(new Set());
                    }}
                    className="text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors"
                  >
                    {selectMode ? "Annuler" : "Sélectionner"}
                  </button>
                )}
              </div>
            </div>

            {/* Grille carrée régulière. Mode « Réorganiser » = glisser-déposer
                (useSortableGrid) ; sinon navigation + sélection + overlays. */}
            {reorderMode ? (
              <>
                <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2">
                  {items.map(({ inspiration }) => {
                    const img = inspiration.images[0];
                    return (
                      <motion.div
                        key={inspiration.id}
                        layout
                        {...sortable.getContainerProps(inspiration.id)}
                        className={cn(
                          "aspect-square rounded-md overflow-hidden bg-[var(--bg-surface)] cursor-grab active:cursor-grabbing touch-none select-none",
                          sortable.draggingKey === inspiration.id && "opacity-30",
                        )}
                      >
                        {img?.thumbnailKey && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={getThumbnailUrl(img.thumbnailKey)} alt="" draggable={false} className="w-full h-full object-cover pointer-events-none" />
                        )}
                      </motion.div>
                    );
                  })}
                </div>
                {dragged?.inspiration.images[0]?.thumbnailKey && (
                  <div ref={sortable.overlayRef} style={sortable.overlayStyle}>
                    <div className="w-full h-full rounded-md overflow-hidden shadow-2xl ring-2 ring-[var(--accent,#a78bfa)]">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={getThumbnailUrl(dragged.inspiration.images[0].thumbnailKey!)} alt="" className="w-full h-full object-cover" />
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2">
                {items.map(({ inspiration, addedBy }) => {
                  const img = inspiration.images[0];
                  const url = img?.thumbnailKey ? getThumbnailUrl(img.thumbnailKey) : null;
                  const isSel = selected.has(inspiration.id);
                  const inner = (
                    <div className={cn("aspect-square rounded-md overflow-hidden bg-[var(--bg-surface)] relative group", isSel && "ring-2 ring-[var(--accent,#a78bfa)]")}>
                      {url && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={url} alt={inspiration.title} loading="lazy" draggable={false} className="w-full h-full object-cover" />
                      )}

                      {selectMode && (
                        <div className={cn("absolute inset-0 transition-colors", isSel ? "bg-black/30" : "bg-black/0 group-hover:bg-black/10")}>
                          <span className={cn("absolute top-1.5 right-1.5 w-5 h-5 rounded-full border-2 flex items-center justify-center", isSel ? "bg-[var(--accent,#a78bfa)] border-[var(--accent,#a78bfa)] text-white" : "border-white/80")}>
                            {isSel && <Check size={11} strokeWidth={3} />}
                          </span>
                        </div>
                      )}

                      {!selectMode && (
                        <button
                          onClick={(e) => { e.preventDefault(); removeOne(inspiration.id); }}
                          disabled={removing === inspiration.id}
                          className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/60 text-white text-[10px] flex items-center justify-center opacity-0 group-hover:opacity-100 pointer-coarse:opacity-100 transition-opacity hover:bg-black/80 disabled:opacity-40 z-10"
                          title="Retirer de la collection"
                        >
                          {removing === inspiration.id ? "…" : <X size={12} strokeWidth={2} />}
                        </button>
                      )}

                      {!selectMode && inspiration.userId !== viewerId && img?.id && (
                        <div className="absolute top-1.5 left-1.5 opacity-0 group-hover:opacity-100 pointer-coarse:opacity-100 transition-opacity z-10" onClick={(e) => e.preventDefault()}>
                          <SaveToLibraryButton collectionId={collectionId} imageId={img.id} />
                        </div>
                      )}

                      {isShared && addedBy && (
                        <div className="absolute bottom-1.5 left-1.5 z-10 rounded-full ring-2 ring-black/30" title={`Ajoutée par ${addedBy.name || `@${addedBy.username}`}`}>
                          <UserAvatar name={addedBy.name} username={addedBy.username} image={addedBy.image} size={22} />
                        </div>
                      )}
                    </div>
                  );
                  return selectMode ? (
                    <button key={inspiration.id} onClick={() => toggleSelect(inspiration.id)} className="block w-full text-left">{inner}</button>
                  ) : (
                    <Link key={inspiration.id} href={`/library/${inspiration.id}`} onClick={handleBeforeNavigate} className="block">{inner}</Link>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Suggestions d'ajout ── */}
      {suggestions.length > 0 && (
        <div>
          <div className="flex items-baseline gap-3 mb-4">
            <h2 className="text-sm font-medium text-[var(--text-primary)]">
              Suggestions d&apos;ajout
            </h2>
            <p className="text-[10px] text-[var(--text-tertiary)]">
              Images partageant les mêmes tags ou catégories
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
            {suggestions.map((s) => {
              const isAdding = adding === s.id;
              return (
                <div key={s.id} className="group relative">
                  {/* Thumbnail */}
                  <div className="aspect-square rounded-md overflow-hidden bg-[var(--bg-surface)] mb-1.5 relative">
                    {s.thumbnailKey ? (
                      <img
                        src={getThumbnailUrl(s.thumbnailKey)}
                        alt={s.title}
                        loading="lazy"
                        className="absolute inset-0 w-full h-full object-cover"
                      />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-[var(--text-tertiary)] text-xs">—</span>
                      </div>
                    )}
                    {/* Overlay */}
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
                    {/* Dismiss */}
                    <button
                      onClick={() => dismissSuggestion(s.id)}
                      className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/50 text-white/70 flex items-center justify-center opacity-0 group-hover:opacity-100 pointer-coarse:opacity-100 transition-opacity hover:bg-black/70 z-10"
                      title="Ignorer"
                    >
                      <X size={11} strokeWidth={2} />
                    </button>
                  </div>

                  {/* Infos */}
                  <Link
                    href={`/library/${s.id}`}
                    className="block text-[10px] font-medium text-[var(--text-primary)] leading-tight line-clamp-1 hover:underline mb-0.5"
                  >
                    {s.title}
                  </Link>
                  <p className="text-[9px] text-[var(--text-tertiary)] mb-1.5">
                    {s.matchReason}
                  </p>

                  {/* Bouton ajouter */}
                  <button
                    onClick={() => addSuggestion(s)}
                    disabled={isAdding}
                    className="text-[9px] text-[var(--accent,#a78bfa)] hover:opacity-80 transition-opacity disabled:opacity-40"
                  >
                    {isAdding ? "Ajout…" : "+ Ajouter"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
