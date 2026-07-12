"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { getThumbnailUrl } from "@/lib/storage/urls";
import { useSortableGrid, type SortableGrid } from "@/hooks/useSortableGrid";
import { DragHandle } from "@/components/ui/DragHandle";
import { NoteEditor, type NoteEditorImage } from "@/components/visits/NoteEditor";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface JournalImage {
  type: "image";
  id: string; // inspirationId
  title: string;
  thumbnailKey: string | null;
  width: number | null;
  height: number | null;
}

export interface JournalNote {
  type: "note";
  id: string; // visitNoteId
  content: string;
}

export type JournalItem = JournalImage | JournalNote;

interface VisitJournalProps {
  visitId: string;
  initialItems: JournalItem[];
}

// ── Composant ─────────────────────────────────────────────────────────────────
// Carnet de visite : séquence ordonnée d'images et de blocs de notes.
// - Grille responsive ; les notes occupent toute la largeur (col-span-full)
// - Réordonnancement : overlay flottant + fantôme (souris n'importe où sur le
//   bloc, tactile via poignée dédiée — voir useSortableGrid) + ↑/↓ dans le
//   menu ⋯ de chaque bloc en alternative
// - Notes : édition inline (sauvegarde au blur), insertion après n'importe
//   quel bloc via son menu ⋯, ou en fin via le bouton "+ Note"

export function VisitJournal({ visitId, initialItems }: VisitJournalProps) {
  const [items, setItems] = useState<JournalItem[]>(initialItems);
  const [menuIdx, setMenuIdx] = useState<number | null>(null);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const keyOf = (item: JournalItem) => `${item.type}-${item.id}`;

  useEffect(() => {
    if (menuIdx === null) return;
    const handler = (e: MouseEvent | TouchEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuIdx(null);
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("touchstart", handler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("touchstart", handler);
    };
  }, [menuIdx]);

  // ── Persistance de l'ordre ──
  const persistOrder = (list: JournalItem[]) => {
    fetch(`/api/visits/${visitId}/reorder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: list.map((item, i) => ({ type: item.type, id: item.id, order: i })),
      }),
    }).catch(() => {});
  };

  const moveItem = (from: number, to: number) => {
    if (to < 0 || to >= items.length || from === to) return;
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setItems(next);
    persistOrder(next);
  };

  // ── Réordonnancement (overlay + fantôme, voir useSortableGrid) ──
  // Le bloc draguée est cloné dans un overlay flottant qui suit le pointeur ;
  // le fantôme et ses voisins se réorganisent proprement via `layout` de
  // Framer. `data-sortable-key` = clé (type+id) du bloc.
  const sortable = useSortableGrid({
    onReorder: (draggedKey, targetKey) => {
      setItems((prev) => {
        const from = prev.findIndex((it) => keyOf(it) === draggedKey);
        const to = prev.findIndex((it) => keyOf(it) === targetKey);
        if (from === -1 || to === -1 || from === to) return prev;
        const next = [...prev];
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        return next;
      });
    },
    onDrop: () => {
      // Le réordonnancement a déjà été appliqué en direct — persister l'ordre final.
      persistOrder(itemsRef.current);
    },
  });

  const draggedItem = sortable.draggingKey
    ? items.find((it) => keyOf(it) === sortable.draggingKey) ?? null
    : null;

  // Proposées dans le picker "+Image" des notes — insertion inline (wrap
  // texte), ne duplique pas le bloc image pleine largeur du carnet.
  const visitImages = items
    .filter((it): it is JournalImage => it.type === "image")
    .map((it) => ({ id: it.id, thumbnailKey: it.thumbnailKey }));

  // ── Notes CRUD ──
  const insertNoteAfter = async (idx: number | null) => {
    setMenuIdx(null);
    const insertAt = idx === null ? items.length : idx + 1;
    const res = await fetch(`/api/visits/${visitId}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "" }),
    });
    if (!res.ok) return;
    const note = await res.json();
    const next = [...items];
    next.splice(insertAt, 0, { type: "note", id: note.id, content: "" });
    setItems(next);
    persistOrder(next);
    setEditingNoteId(note.id);
  };

  // `content` est du HTML (Tiptap) — on ne peut pas juger de la vacuité avec
  // un simple `.trim()` (un doc vide sérialise en "<p></p>", jamais "").
  const isEmptyHtml = (html: string) => !html.replace(/<[^>]*>/g, "").trim();

  const saveNote = async (noteId: string, html: string) => {
    setEditingNoteId(null);
    if (isEmptyHtml(html)) {
      // Note vide au blur → suppression (évite les blocs fantômes)
      deleteNote(noteId);
      return;
    }
    setItems((prev) =>
      prev.map((it) => (it.type === "note" && it.id === noteId ? { ...it, content: html } : it)),
    );
    await fetch(`/api/visits/${visitId}/notes/${noteId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: html }),
    }).catch(() => {});
  };

  const deleteNote = async (noteId: string) => {
    setMenuIdx(null);
    setItems((prev) => prev.filter((it) => !(it.type === "note" && it.id === noteId)));
    await fetch(`/api/visits/${visitId}/notes/${noteId}`, { method: "DELETE" }).catch(() => {});
  };

  // ── Rendu ──
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <p className="text-[var(--text-tertiary)] text-sm">Aucune image dans cette visite</p>
        <button
          onClick={() => insertNoteAfter(null)}
          className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
        >
          + Ajouter une note
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
        {items.map((item, idx) => (
          <JournalItemBlock
            key={keyOf(item)}
            item={item}
            idx={idx}
            total={items.length}
            editingNoteId={editingNoteId}
            setEditingNoteId={setEditingNoteId}
            menuOpen={menuIdx === idx}
            menuRef={menuIdx === idx ? menuRef : undefined}
            onToggleMenu={() => setMenuIdx(menuIdx === idx ? null : idx)}
            onMoveUp={() => { setMenuIdx(null); moveItem(idx, idx - 1); }}
            onMoveDown={() => { setMenuIdx(null); moveItem(idx, idx + 1); }}
            onInsertNoteAfter={() => insertNoteAfter(idx)}
            onDeleteNote={() => deleteNote(item.id)}
            onSaveNote={(content) => saveNote(item.id, content)}
            sortable={sortable}
            isDragging={sortable.draggingKey === keyOf(item)}
            visitImages={visitImages}
          />
        ))}
      </div>

      {/* Clone flottant suivant le pointeur pendant le drag (voir useSortableGrid) */}
      {draggedItem && (
        <div ref={sortable.overlayRef} style={sortable.overlayStyle}>
          {draggedItem.type === "image" ? (
            <div className="w-full h-full rounded-md overflow-hidden bg-[var(--bg-surface)] shadow-2xl shadow-black/50 rotate-[1.5deg]">
              {draggedItem.thumbnailKey && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={getThumbnailUrl(draggedItem.thumbnailKey)} alt={draggedItem.title} className="w-full h-full object-cover" draggable={false} />
              )}
            </div>
          ) : (
            <div className="w-full h-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] px-4 py-3 shadow-2xl shadow-black/50 rotate-[1deg] overflow-hidden">
              <p className="text-sm text-[var(--text-secondary)] leading-relaxed whitespace-pre-wrap line-clamp-4">{draggedItem.content}</p>
            </div>
          )}
        </div>
      )}

      {/* Ajouter une note en fin de carnet */}
      <div className="mt-4 flex justify-center">
        <button
          onClick={() => insertNoteAfter(null)}
          className="px-3 py-1.5 text-xs text-[var(--text-tertiary)] hover:text-[var(--text-primary)] border border-dashed border-[var(--border-default)] hover:border-[var(--border-strong)] rounded-md transition-colors"
        >
          + Note
        </button>
      </div>
    </div>
  );
}

// ── Bloc individuel (image ou note) ─────────────────────────────────────────────
// Composant séparé du parent pour garder la logique de chaque bloc isolée.

function JournalItemBlock({
  item,
  idx,
  total,
  editingNoteId,
  setEditingNoteId,
  menuOpen,
  menuRef,
  onToggleMenu,
  onMoveUp,
  onMoveDown,
  onInsertNoteAfter,
  onDeleteNote,
  onSaveNote,
  sortable,
  isDragging,
  visitImages,
}: {
  item: JournalItem;
  idx: number;
  total: number;
  editingNoteId: string | null;
  setEditingNoteId: (id: string | null) => void;
  menuOpen: boolean;
  menuRef?: React.RefObject<HTMLDivElement | null>;
  onToggleMenu: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onInsertNoteAfter: () => void;
  onDeleteNote: () => void;
  onSaveNote: (content: string) => void;
  sortable: SortableGrid;
  isDragging: boolean;
  visitImages: NoteEditorImage[];
}) {
  const sortableKey = `${item.type}-${item.id}`;

  const itemMenu = (
    <div className="relative" ref={menuRef}>
      <button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggleMenu(); }}
        className={cn(
          "w-9 h-9 md:w-6 md:h-6 flex items-center justify-center rounded-full text-sm md:text-xs transition-all",
          item.type === "image"
            ? "bg-black/60 text-white/90 opacity-0 group-hover:opacity-100 pointer-coarse:opacity-100"
            : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
        )}
        title="Options"
      >
        ⋯
      </button>
      {menuOpen && (
        <div
          className="absolute right-0 top-full mt-1 z-50 w-44 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-default)] shadow-xl overflow-hidden"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
        >
          <button
            onClick={onMoveUp}
            disabled={idx === 0}
            className="w-full text-left px-3 py-1.5 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] disabled:opacity-30 transition-colors"
          >
            ↑ Monter
          </button>
          <button
            onClick={onMoveDown}
            disabled={idx === total - 1}
            className="w-full text-left px-3 py-1.5 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] disabled:opacity-30 transition-colors"
          >
            ↓ Descendre
          </button>
          <button
            onClick={onInsertNoteAfter}
            className="w-full text-left px-3 py-1.5 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] border-t border-[var(--border-subtle)] transition-colors"
          >
            ✎ Insérer une note après
          </button>
          {item.type === "note" && (
            <button
              onClick={onDeleteNote}
              className="w-full text-left px-3 py-1.5 text-[11px] text-red-400 hover:bg-[var(--bg-surface)] border-t border-[var(--border-subtle)] transition-colors"
            >
              Supprimer la note
            </button>
          )}
        </div>
      )}
    </div>
  );

  if (item.type === "note") {
    const isEditing = editingNoteId === item.id;
    // En édition, le bloc n'est pas triable (on saisit du texte).
    const dragBindings = isEditing
      ? {}
      : { ...sortable.getContainerProps(sortableKey) };
    // Pendant le drag, le fantôme d'une note se réduit à une fine barre
    // d'insertion : sinon un gros bloc pleine largeur pousse toutes les
    // images à chaque micro-déplacement et il devient impossible de viser.
    // Le clone flottant (rendu par le parent) reste la note complète.
    if (isDragging) {
      return (
        <motion.div layout className="col-span-full py-1">
          <div className="h-1.5 rounded-full bg-[var(--text-primary)]/40" />
        </motion.div>
      );
    }
    return (
      <motion.div
        layout
        {...dragBindings}
        className="col-span-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-3 transition-colors relative"
      >
        <div
          className="flex items-start gap-2"
          onClick={() => { if (!isEditing && !sortable.wasDragging()) setEditingNoteId(item.id); }}
        >
          <span className="text-[var(--text-tertiary)] text-xs mt-0.5 flex-shrink-0 select-none">✎</span>
          <NoteEditor
            content={item.content}
            editable={isEditing}
            onBlurSave={(html) => onSaveNote(html)}
            placeholder="Note vide — cliquer pour éditer"
            visitImages={visitImages}
          />
          {itemMenu}
          {!isEditing && (
            <DragHandle {...sortable.getHandleProps(sortableKey)} className="absolute bottom-1.5 right-1.5" title="Glisser pour réordonner" />
          )}
        </div>
      </motion.div>
    );
  }

  // Image
  const ar = item.width && item.height ? item.width / item.height : 1;
  return (
    <motion.div
      layout
      {...sortable.getContainerProps(sortableKey)}
      className={cn(
        // Surtout PAS `transition-all` : Framer pilote `transform` à la main
        // pendant l'animation `layout`, et un `transition: all` CSS ré-anime ce
        // même transform en parallèle → conflit, saccades ("bazar"). Les cartes
        // de planches sont fluides justement parce qu'elles n'animent que la
        // couleur. On se limite donc à la couleur ici aussi.
        "group relative rounded-md overflow-hidden bg-[var(--bg-surface)] transition-colors",
        isDragging && "opacity-40"
      )}
      style={{ aspectRatio: ar }}
    >
      <Link
        href={`/library/${item.id}`}
        className="absolute inset-0"
        draggable={false}
        onContextMenu={(e) => e.preventDefault()}
        style={{ WebkitTouchCallout: "none" }}
        onClick={(e) => { if (sortable.wasDragging()) e.preventDefault(); }}
      >
        {item.thumbnailKey ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={getThumbnailUrl(item.thumbnailKey)}
            alt={item.title}
            loading="lazy"
            draggable={false}
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-[var(--text-tertiary)] text-xs">—</span>
          </div>
        )}
      </Link>
      <div className="absolute top-1.5 right-1.5 z-10">{itemMenu}</div>
      <DragHandle {...sortable.getHandleProps(sortableKey)} className="absolute bottom-1.5 right-1.5 z-10" title="Glisser pour réordonner" />
    </motion.div>
  );
}
