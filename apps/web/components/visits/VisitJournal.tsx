"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { getThumbnailUrl } from "@/lib/storage/urls";

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
// - Réordonnancement : drag-and-drop HTML5 (desktop) + ↑/↓ dans le menu ⋯
//   de chaque bloc (tactile — le drag HTML5 ne fire pas sur touch)
// - Notes : édition inline (sauvegarde au blur), insertion après n'importe
//   quel bloc via son menu ⋯, ou en fin via le bouton "+ Note"

export function VisitJournal({ visitId, initialItems }: VisitJournalProps) {
  const [items, setItems] = useState<JournalItem[]>(initialItems);
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const [menuIdx, setMenuIdx] = useState<number | null>(null);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

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

  // ── Drag and drop (desktop) ──
  const handleDrop = (targetIdx: number) => {
    setDragOverIdx(null);
    if (draggedIdx === null || draggedIdx === targetIdx) return;
    moveItem(draggedIdx, targetIdx);
    setDraggedIdx(null);
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
        {items.map((item, idx) => {
          const isDragging = draggedIdx === idx;
          const isDragOver = dragOverIdx === idx && draggedIdx !== idx;

          const itemMenu = (
            <div className="relative" ref={menuIdx === idx ? menuRef : undefined}>
              <button
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setMenuIdx(menuIdx === idx ? null : idx); }}
                className={cn(
                  "w-6 h-6 flex items-center justify-center rounded-full text-xs transition-all",
                  item.type === "image"
                    ? "bg-black/60 text-white/90 opacity-0 group-hover:opacity-100 pointer-coarse:opacity-100"
                    : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                )}
                title="Options"
              >
                ⋯
              </button>
              {menuIdx === idx && (
                <div
                  className="absolute right-0 top-full mt-1 z-50 w-44 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-default)] shadow-xl overflow-hidden"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                >
                  <button
                    onClick={() => { setMenuIdx(null); moveItem(idx, idx - 1); }}
                    disabled={idx === 0}
                    className="w-full text-left px-3 py-1.5 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] disabled:opacity-30 transition-colors"
                  >
                    ↑ Monter
                  </button>
                  <button
                    onClick={() => { setMenuIdx(null); moveItem(idx, idx + 1); }}
                    disabled={idx === items.length - 1}
                    className="w-full text-left px-3 py-1.5 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] disabled:opacity-30 transition-colors"
                  >
                    ↓ Descendre
                  </button>
                  <button
                    onClick={() => insertNoteAfter(idx)}
                    className="w-full text-left px-3 py-1.5 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] border-t border-[var(--border-subtle)] transition-colors"
                  >
                    ✎ Insérer une note après
                  </button>
                  {item.type === "note" && (
                    <button
                      onClick={() => deleteNote(item.id)}
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
            return (
              <div
                key={`note-${item.id}`}
                draggable={editingNoteId !== item.id}
                onDragStart={() => setDraggedIdx(idx)}
                onDragEnd={() => { setDraggedIdx(null); setDragOverIdx(null); }}
                onDragOver={(e) => { e.preventDefault(); setDragOverIdx(idx); }}
                onDrop={(e) => { e.preventDefault(); handleDrop(idx); }}
                className={cn(
                  "col-span-full rounded-lg border bg-[var(--bg-surface)] px-4 py-3 transition-colors",
                  isDragging ? "opacity-40" : "",
                  isDragOver ? "border-[var(--text-primary)]" : "border-[var(--border-subtle)]"
                )}
              >
                <div className="flex items-start gap-2">
                  <span className="text-[var(--text-tertiary)] text-xs mt-0.5 flex-shrink-0 select-none">✎</span>
                  {editingNoteId === item.id ? (
                    <textarea
                      autoFocus
                      defaultValue={item.content}
                      rows={Math.max(2, item.content.split("\n").length)}
                      onBlur={(e) => saveNote(item.id, e.target.value)}
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
                </div>
              </div>
            );
          }

          // Image
          const ar = item.width && item.height ? item.width / item.height : 1;
          return (
            <div
              key={`img-${item.id}`}
              draggable
              onDragStart={() => setDraggedIdx(idx)}
              onDragEnd={() => { setDraggedIdx(null); setDragOverIdx(null); }}
              onDragOver={(e) => { e.preventDefault(); setDragOverIdx(idx); }}
              onDrop={(e) => { e.preventDefault(); handleDrop(idx); }}
              className={cn(
                "group relative rounded-md overflow-hidden bg-[var(--bg-surface)] transition-all",
                isDragging && "opacity-40",
                isDragOver && "ring-1 ring-[var(--text-primary)]"
              )}
              style={{ aspectRatio: ar }}
            >
              <Link href={`/library/${item.id}`} className="absolute inset-0">
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
            </div>
          );
        })}
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
