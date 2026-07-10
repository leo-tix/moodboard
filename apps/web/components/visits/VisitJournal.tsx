"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { motion, type PanInfo } from "framer-motion";
import { cn } from "@/lib/utils";
import { getThumbnailUrl } from "@/lib/storage/urls";
import { useDragHandle } from "@/hooks/useDragHandle";
import { DragHandle } from "@/components/ui/DragHandle";

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
// - Réordonnancement : drag Framer Motion (souris n'importe où sur le bloc,
//   tactile via poignée dédiée — voir useDragHandle) + ↑/↓ dans le menu ⋯
//   de chaque bloc en alternative
// - Notes : édition inline (sauvegarde au blur), insertion après n'importe
//   quel bloc via son menu ⋯, ou en fin via le bouton "+ Note"

export function VisitJournal({ visitId, initialItems }: VisitJournalProps) {
  const [items, setItems] = useState<JournalItem[]>(initialItems);
  const [menuIdx, setMenuIdx] = useState<number | null>(null);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // Clé (type+id) du bloc en cours de drag — pas un index, qui change à
  // chaque resplice en direct.
  const draggedIdxRef = useRef<string | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  // Déduplique les réordonnancements en direct : ne resplice que quand le
  // bloc survolé change réellement, pas à chaque frame de pointermove.
  const lastReorderIdxRef = useRef<number | null>(null);

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

  // ── Drag Framer Motion — hit-testing par coordonnées (elementFromPoint),
  // pas par les événements HTML5 dragover/drop natifs (ne fonctionnent pas au
  // tactile). Même pattern que la bibliothèque et les planches.
  const resolveDropIndex = (x: number, y: number): number | null => {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-drop-key]");
    const raw = el?.getAttribute("data-drop-key");
    if (!raw?.startsWith("item-")) return null;
    const idx = parseInt(raw.slice(5), 10);
    return Number.isNaN(idx) ? null : idx;
  };

  // Resplice immédiatement le state local dès qu'on survole un autre bloc,
  // pour que le carnet se réordonne visuellement en temps réel pendant le
  // drag (animation FLIP via le prop `layout`, voir useDragHandle). L'ordre
  // final n'est persisté qu'au drop. Identifié par clé (type+id) plutôt que
  // par index : l'index du bloc draguée change à chaque resplice.
  const applyLiveReorder = (targetIdx: number) => {
    const draggedKey = draggedIdxRef.current;
    if (draggedKey === null) return;
    setItems((prev) => {
      const fromIndex = prev.findIndex((it) => `${it.type}-${it.id}` === draggedKey);
      if (fromIndex === -1 || targetIdx < 0 || targetIdx >= prev.length || fromIndex === targetIdx) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(targetIdx, 0, moved);
      return next;
    });
  };

  const handleItemDragStart = (idx: number) => {
    const it = itemsRef.current[idx];
    draggedIdxRef.current = it ? `${it.type}-${it.id}` : null;
    lastReorderIdxRef.current = null;
  };

  const handleItemDrag = (x: number, y: number) => {
    const idx = resolveDropIndex(x, y);
    if (idx === null) return;
    const draggedNow = itemsRef.current.findIndex((it) => `${it.type}-${it.id}` === draggedIdxRef.current);
    if (idx === draggedNow || lastReorderIdxRef.current === idx) return;
    lastReorderIdxRef.current = idx;
    applyLiveReorder(idx);
  };

  const handleItemDragEnd = () => {
    const draggedKey = draggedIdxRef.current;
    draggedIdxRef.current = null;
    lastReorderIdxRef.current = null;
    if (!draggedKey) return;
    persistOrder(itemsRef.current);
  };

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

  const saveNote = async (noteId: string, content: string) => {
    setEditingNoteId(null);
    const trimmed = content.trim();
    if (!trimmed) {
      // Note vide au blur → suppression (évite les blocs fantômes)
      deleteNote(noteId);
      return;
    }
    setItems((prev) =>
      prev.map((it) => (it.type === "note" && it.id === noteId ? { ...it, content: trimmed } : it)),
    );
    await fetch(`/api/visits/${visitId}/notes/${noteId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: trimmed }),
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
            key={`${item.type}-${item.id}`}
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
            onCardDragStart={() => handleItemDragStart(idx)}
            onCardDrag={handleItemDrag}
            onCardDragEnd={handleItemDragEnd}
          />
        ))}
      </div>

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
// Composant séparé du parent : useDragHandle doit être appelé une fois par
// bloc, ce qui exige son propre scope de composant (règle des hooks React).

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
  onCardDragStart,
  onCardDrag,
  onCardDragEnd,
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
  onCardDragStart: () => void;
  onCardDrag: (x: number, y: number) => void;
  onCardDragEnd: (x: number, y: number) => void;
}) {
  const { dragProps, onCardPointerDown, handleProps } = useDragHandle(true);
  const justDraggedRef = useRef(false);

  const itemDragProps = {
    "data-drop-key": `item-${idx}`,
    ...dragProps,
    onPointerDown: onCardPointerDown,
    onDragStart: () => { justDraggedRef.current = true; onCardDragStart(); },
    onDrag: (_e: unknown, info: PanInfo) => onCardDrag(info.point.x, info.point.y),
    onDragEnd: (_e: unknown, info: PanInfo) => {
      onCardDragEnd(info.point.x, info.point.y);
      setTimeout(() => { justDraggedRef.current = false; }, 150);
    },
  };

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
    return (
      <motion.div
        {...(!isEditing ? itemDragProps : {})}
        className="col-span-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-3 transition-colors relative"
      >
        <div className="flex items-start gap-2">
          <span className="text-[var(--text-tertiary)] text-xs mt-0.5 flex-shrink-0 select-none">✎</span>
          {isEditing ? (
            <textarea
              autoFocus
              defaultValue={item.content}
              rows={Math.max(2, item.content.split("\n").length)}
              onBlur={(e) => onSaveNote(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") (e.target as HTMLTextAreaElement).blur();
              }}
              className="flex-1 bg-transparent text-sm text-[var(--text-primary)] leading-relaxed focus:outline-none resize-y placeholder:text-[var(--text-tertiary)]"
              placeholder="Écris ta note…"
            />
          ) : (
            <p
              onClick={() => setEditingNoteId(item.id)}
              className="flex-1 text-sm text-[var(--text-secondary)] leading-relaxed whitespace-pre-wrap cursor-text min-h-[1.5rem]"
            >
              {item.content || <span className="text-[var(--text-tertiary)] italic">Note vide — cliquer pour éditer</span>}
            </p>
          )}
          {itemMenu}
          {!isEditing && (
            <DragHandle {...handleProps} className="absolute bottom-1.5 right-1.5" title="Glisser pour réordonner" />
          )}
        </div>
      </motion.div>
    );
  }

  // Image
  const ar = item.width && item.height ? item.width / item.height : 1;
  return (
    <motion.div
      {...itemDragProps}
      className="group relative rounded-md overflow-hidden bg-[var(--bg-surface)] transition-all"
      style={{ aspectRatio: ar }}
    >
      <Link
        href={`/library/${item.id}`}
        className="absolute inset-0"
        draggable={false}
        onContextMenu={(e) => e.preventDefault()}
        style={{ WebkitTouchCallout: "none" }}
        onClick={(e) => { if (justDraggedRef.current) e.preventDefault(); }}
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
      <DragHandle {...handleProps} className="absolute bottom-1.5 right-1.5 z-10" title="Glisser pour réordonner" />
    </motion.div>
  );
}
