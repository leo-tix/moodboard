"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { getThumbnailUrl, getAudioUrl } from "@/lib/storage/urls";
import { useSortableGrid, type SortableGrid } from "@/hooks/useSortableGrid";
import { DragHandle } from "@/components/ui/DragHandle";
import { NoteEditor } from "@/components/visits/NoteEditor";
import { AudioPlayer } from "@/components/visits/AudioPlayer";
import { QuoteEditor } from "@/components/visits/QuoteEditor";
import { AudioRecorderInline, type CreatedAudioBlock } from "@/components/visits/AudioRecorderInline";
import { AudioPlayerBoundary } from "@/components/visits/AudioPlayerBoundary";

// ── Types ─────────────────────────────────────────────────────────────────────
// Carnet façon Notion : chaque bloc est PUR (un seul type). Le bloc "2
// colonnes" est le seul bloc composite — il compose deux blocs purs
// existants côte à côte (voir schema.prisma pour le détail du modèle).

export interface JournalImage {
  type: "image";
  id: string; // inspirationId
  title: string;
  /** Artiste / auteur de l'œuvre — légende typographique du bloc Œuvre */
  author: string | null;
  year: number | null;
  thumbnailKey: string | null;
  width: number | null;
  height: number | null;
}

export interface JournalNote {
  type: "note";
  id: string; // visitNoteId
  content: string;
}

export interface JournalQuote {
  type: "quote";
  id: string; // visitQuoteId
  content: string;
}

export interface JournalAudio {
  type: "audio";
  id: string; // visitAudioId
  storageKey: string;
  durationSec: number | null;
  transcript: string | null;
}

/** Bloc pur, seul type admissible dans un slot de colonnes. */
export type JournalBlock = JournalImage | JournalNote | JournalQuote | JournalAudio;

export interface JournalColumns {
  type: "columns";
  id: string; // visitColumnsId
  left: JournalBlock | null;
  right: JournalBlock | null;
}

export type JournalItem = JournalBlock | JournalColumns;

interface VisitJournalProps {
  visitId: string;
  initialItems: JournalItem[];
}

// ── Composant ─────────────────────────────────────────────────────────────────
// Carnet de visite : séquence ordonnée de blocs purs (image/texte/citation/
// audio/2 colonnes — voir types ci-dessus).
// - Grille responsive ; seule l'image reste une cellule de grille, les 4
//   autres types occupent toute la largeur (col-span-full)
// - Réordonnancement : overlay flottant + fantôme (souris n'importe où sur le
//   bloc, tactile via poignée dédiée — voir useSortableGrid) + ↑/↓ dans le
//   menu ⋯ de chaque bloc en alternative
// - Texte/citation : édition inline (sauvegarde au blur), insertion après
//   n'importe quel bloc via son menu ⋯, ou en fin via le bouton "+ Bloc"

const REF_TYPE: Record<JournalBlock["type"], "IMAGE" | "TEXT" | "QUOTE" | "AUDIO"> = {
  image: "IMAGE",
  note: "TEXT",
  quote: "QUOTE",
  audio: "AUDIO",
};

// Patch le contenu d'un bloc "réclamable" (note/citation/audio), qu'il soit
// au top-level de la séquence ou imbriqué dans un slot de colonnes.
function patchClaimable<T extends JournalBlock>(
  items: JournalItem[],
  type: T["type"],
  id: string,
  patch: Partial<T>,
): JournalItem[] {
  return items.map((it) => {
    if (it.type === "columns") {
      const left = it.left && it.left.type === type && it.left.id === id ? ({ ...it.left, ...patch } as JournalBlock) : it.left;
      const right = it.right && it.right.type === type && it.right.id === id ? ({ ...it.right, ...patch } as JournalBlock) : it.right;
      return left === it.left && right === it.right ? it : { ...it, left, right };
    }
    if (it.type === type && it.id === id) return { ...it, ...patch } as JournalItem;
    return it;
  });
}

export function VisitJournal({ visitId, initialItems }: VisitJournalProps) {
  const [items, setItems] = useState<JournalItem[]>(initialItems);
  const [menuIdx, setMenuIdx] = useState<number | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [insertMenu, setInsertMenu] = useState<{ afterIdx: number | null } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const insertMenuRef = useRef<HTMLDivElement>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  // Resynchronise avec les données serveur quand elles changent — sans ça,
  // le `router.refresh()` déclenché après une capture FAB (photo ou mémo
  // vocal) rechargeait bien le payload RSC mais ce state, initialisé une
  // seule fois au mount, l'ignorait : il fallait recharger la page à la main
  // pour voir apparaître le nouvel élément.
  const initialItemsRef = useRef(initialItems);
  useEffect(() => {
    if (initialItemsRef.current !== initialItems) {
      initialItemsRef.current = initialItems;
      setItems(initialItems);
    }
  }, [initialItems]);

  const keyOf = (item: JournalItem) => `${item.type}-${item.id}`;

  useEffect(() => {
    if (menuIdx === null && insertMenu === null) return;
    const activeRef = insertMenu !== null ? insertMenuRef : menuRef;
    const handler = (e: MouseEvent | TouchEvent) => {
      if (activeRef.current && !activeRef.current.contains(e.target as Node)) {
        setMenuIdx(null);
        setInsertMenu(null);
      }
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("touchstart", handler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("touchstart", handler);
    };
  }, [menuIdx, insertMenu]);

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

  // Proposées pour remplir un slot "Image" de colonnes — seules les images
  // encore au top-level (non déjà réclamées) sont candidates.
  const visitImages: JournalImage[] = items.filter((it): it is JournalImage => it.type === "image");

  // ── Création de bloc (texte / citation / colonnes) ──
  const createBlock = async (afterIdx: number | null, type: "note" | "quote" | "columns") => {
    setMenuIdx(null);
    setInsertMenu(null);
    const insertAt = afterIdx === null ? items.length : afterIdx + 1;
    const endpoint = type === "note" ? "notes" : type === "quote" ? "quotes" : "columns";
    const body = type === "columns" ? {} : { content: "" };
    const res = await fetch(`/api/visits/${visitId}/${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return;
    const created = await res.json();
    const newItem: JournalItem =
      type === "note"
        ? { type: "note", id: created.id, content: "" }
        : type === "quote"
          ? { type: "quote", id: created.id, content: "" }
          : { type: "columns", id: created.id, left: null, right: null };
    const next = [...items];
    next.splice(insertAt, 0, newItem);
    setItems(next);
    persistOrder(next);
    if (type !== "columns") setEditingKey(`${type}-${created.id}`);
  };

  const insertAudioBlock = (afterIdx: number | null, created: CreatedAudioBlock) => {
    setMenuIdx(null);
    setInsertMenu(null);
    const insertAt = afterIdx === null ? items.length : afterIdx + 1;
    const next = [...items];
    next.splice(insertAt, 0, {
      type: "audio",
      id: created.id,
      storageKey: created.storageKey,
      durationSec: created.durationSec,
      transcript: created.transcript,
    });
    setItems(next);
    persistOrder(next);
  };

  // `content` d'une note est du HTML (Tiptap) — on ne peut pas juger de la
  // vacuité avec un simple `.trim()` (un doc vide sérialise en "<p></p>").
  const isEmptyHtml = (html: string) => !html.replace(/<[^>]*>/g, "").trim();

  // Persistance PENDANT la frappe (auto-save debouncé) — ne ferme pas
  // l'éditeur et ne supprime jamais (un bloc momentanément vide en cours de
  // frappe ne doit pas s'autodétruire).
  const persistNote = async (noteId: string, html: string) => {
    setItems((prev) => patchClaimable<JournalNote>(prev, "note", noteId, { content: html }));
    const res = await fetch(`/api/visits/${visitId}/notes/${noteId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: html }),
    }).catch(() => null);
    if (!res?.ok) throw new Error("save failed");
  };

  const saveNote = async (noteId: string, html: string) => {
    setEditingKey(null);
    if (isEmptyHtml(html)) {
      deleteBlock("note", noteId);
      return;
    }
    await persistNote(noteId, html).catch(() => {});
  };

  const persistQuote = async (quoteId: string, text: string) => {
    setItems((prev) => patchClaimable<JournalQuote>(prev, "quote", quoteId, { content: text }));
    const res = await fetch(`/api/visits/${visitId}/quotes/${quoteId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: text }),
    }).catch(() => null);
    if (!res?.ok) throw new Error("save failed");
  };

  const saveQuote = async (quoteId: string, text: string) => {
    setEditingKey(null);
    if (!text.trim()) {
      deleteBlock("quote", quoteId);
      return;
    }
    await persistQuote(quoteId, text).catch(() => {});
  };

  const persistAudioTranscript = async (audioId: string, transcript: string) => {
    setItems((prev) => patchClaimable<JournalAudio>(prev, "audio", audioId, { transcript }));
    const res = await fetch(`/api/visits/${visitId}/audio/${audioId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcript }),
    }).catch(() => null);
    if (!res?.ok) throw new Error("save failed");
  };

  // Supprime un bloc pur (texte/citation/audio) qu'il soit au top-level ou
  // imbriqué dans un slot de colonnes (le slot repasse à vide).
  const deleteBlock = async (type: "note" | "quote" | "audio", id: string) => {
    setMenuIdx(null);
    setItems((prev) =>
      prev
        .filter((it) => !(it.type === type && it.id === id))
        .map((it) =>
          it.type === "columns"
            ? {
                ...it,
                left: it.left?.type === type && it.left.id === id ? null : it.left,
                right: it.right?.type === type && it.right.id === id ? null : it.right,
              }
            : it,
        ),
    );
    const endpoint = type === "note" ? "notes" : type === "quote" ? "quotes" : "audio";
    await fetch(`/api/visits/${visitId}/${endpoint}/${id}`, { method: "DELETE" }).catch(() => {});
  };

  // ── Colonnes CRUD ──
  // Supprime le conteneur "2 colonnes" — les blocs qu'il réclamait
  // redeviennent autonomes dans la séquence plate (pas de perte de contenu).
  const deleteColumns = async (columnsId: string) => {
    setMenuIdx(null);
    const col = items.find((it) => it.type === "columns" && it.id === columnsId) as JournalColumns | undefined;
    setItems((prev) => {
      const withoutColumns = prev.filter((it) => !(it.type === "columns" && it.id === columnsId));
      const restored = [col?.left, col?.right].filter((b): b is JournalBlock => Boolean(b));
      return [...withoutColumns, ...restored];
    });
    await fetch(`/api/visits/${visitId}/columns/${columnsId}`, { method: "DELETE" }).catch(() => {});
  };

  const patchSlot = (columnsId: string, slot: "left" | "right", type: string | null, id: string | null) =>
    fetch(`/api/visits/${visitId}/columns/${columnsId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slot, type, id }),
    }).catch(() => {});

  // Retire un bloc d'un slot sans le supprimer : il redevient un bloc
  // autonome de la séquence plate.
  const unclaimSlot = async (columnsId: string, slot: "left" | "right") => {
    const col = items.find((it) => it.type === "columns" && it.id === columnsId) as JournalColumns | undefined;
    const block = col ? (slot === "left" ? col.left : col.right) : null;
    setItems((prev) => {
      const cleared = prev.map((it) => (it.type === "columns" && it.id === columnsId ? { ...it, [slot]: null } : it));
      return block ? [...cleared, block] : cleared;
    });
    await patchSlot(columnsId, slot, null, null);
  };

  // Remplit un slot vide avec une image déjà attachée à la visite.
  const fillSlotWithImage = async (columnsId: string, slot: "left" | "right", image: JournalImage) => {
    setItems((prev) => {
      const withoutImg = prev.filter((it) => !(it.type === "image" && it.id === image.id));
      return withoutImg.map((it) => (it.type === "columns" && it.id === columnsId ? { ...it, [slot]: image } : it));
    });
    await patchSlot(columnsId, slot, "IMAGE", image.id);
  };

  // Remplit un slot vide avec un nouveau bloc texte/citation (créé côté API
  // puis immédiatement réclamé par la colonne).
  const fillSlotWithNew = async (columnsId: string, slot: "left" | "right", type: "note" | "quote") => {
    const endpoint = type === "note" ? "notes" : "quotes";
    const res = await fetch(`/api/visits/${visitId}/${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "" }),
    });
    if (!res.ok) return;
    const created = await res.json();
    const block: JournalBlock = type === "note" ? { type: "note", id: created.id, content: "" } : { type: "quote", id: created.id, content: "" };
    setItems((prev) => prev.map((it) => (it.type === "columns" && it.id === columnsId ? { ...it, [slot]: block } : it)));
    await patchSlot(columnsId, slot, REF_TYPE[type], created.id);
    setEditingKey(`${type}-${created.id}`);
  };

  // Remplit un slot vide avec un clip audio tout juste enregistré (déjà créé
  // côté API par AudioRecorderInline).
  const fillSlotWithAudio = async (columnsId: string, slot: "left" | "right", created: CreatedAudioBlock) => {
    const block: JournalAudio = { type: "audio", id: created.id, storageKey: created.storageKey, durationSec: created.durationSec, transcript: created.transcript };
    setItems((prev) => prev.map((it) => (it.type === "columns" && it.id === columnsId ? { ...it, [slot]: block } : it)));
    await patchSlot(columnsId, slot, "AUDIO", created.id);
  };

  // ── Rendu ──
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <p className="text-[var(--text-tertiary)] text-sm">Aucune image dans cette visite</p>
        <button
          onClick={() => createBlock(null, "note")}
          className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
        >
          + Ajouter un bloc
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
            editingKey={editingKey}
            setEditingKey={setEditingKey}
            menuOpen={menuIdx === idx}
            menuRef={menuIdx === idx ? menuRef : undefined}
            insertMenuOpen={insertMenu?.afterIdx === idx}
            insertMenuRef={insertMenu?.afterIdx === idx ? insertMenuRef : undefined}
            onToggleMenu={() => setMenuIdx(menuIdx === idx ? null : idx)}
            onMoveUp={() => { setMenuIdx(null); moveItem(idx, idx - 1); }}
            onMoveDown={() => { setMenuIdx(null); moveItem(idx, idx + 1); }}
            onOpenInsertMenu={() => { setMenuIdx(null); setInsertMenu({ afterIdx: idx }); }}
            onDeleteBlock={deleteBlock}
            onDeleteColumns={deleteColumns}
            onSaveNote={saveNote}
            onPersistNote={persistNote}
            onSaveQuote={saveQuote}
            onPersistQuote={persistQuote}
            onPersistAudioTranscript={persistAudioTranscript}
            onCreateBlock={(type) => createBlock(idx, type)}
            onCreateAudio={(created) => insertAudioBlock(idx, created)}
            onUnclaimSlot={unclaimSlot}
            onFillSlotWithImage={fillSlotWithImage}
            onFillSlotWithNew={fillSlotWithNew}
            onFillSlotWithAudio={fillSlotWithAudio}
            sortable={sortable}
            isDragging={sortable.draggingKey === keyOf(item)}
            visitImages={visitImages}
            visitId={visitId}
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
              <p className="text-sm text-[var(--text-secondary)] leading-relaxed whitespace-pre-wrap line-clamp-4">
                {draggedItem.type === "columns" ? "2 colonnes" : "content" in draggedItem ? draggedItem.content : draggedItem.transcript}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Ajouter un bloc en fin de carnet */}
      <div className="mt-4 flex justify-center relative">
        <button
          onClick={() => setInsertMenu(insertMenu?.afterIdx === null ? null : { afterIdx: null })}
          className="px-3 py-1.5 text-xs text-[var(--text-tertiary)] hover:text-[var(--text-primary)] border border-dashed border-[var(--border-default)] hover:border-[var(--border-strong)] rounded-md transition-colors"
        >
          + Bloc
        </button>
        {insertMenu?.afterIdx === null && (
          <div ref={insertMenuRef} className="absolute top-full mt-1 z-50">
            <InsertTypeMenu visitId={visitId} onCreateBlock={(type) => createBlock(null, type)} onCreateAudio={(a) => insertAudioBlock(null, a)} />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Menu de choix de type de bloc ────────────────────────────────────────────
// Partagé par le bouton "+ Bloc" (fin de carnet), le "⋯ Insérer un bloc
// après" de chaque item, et les slots vides d'un bloc colonnes.

function InsertTypeMenu({
  visitId,
  onCreateBlock,
  onCreateAudio,
  compact,
}: {
  visitId: string;
  onCreateBlock: (type: "note" | "quote" | "columns") => void;
  onCreateAudio: (created: CreatedAudioBlock) => void;
  /** Sans le choix "2 colonnes" — utilisé à l'intérieur d'un slot (pas de colonnes imbriquées). */
  compact?: boolean;
}) {
  const [recording, setRecording] = useState(false);

  if (recording) {
    return <AudioRecorderInline visitId={visitId} onClose={() => setRecording(false)} onCreated={onCreateAudio} />;
  }

  return (
    <div
      className="w-48 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-default)] shadow-xl overflow-hidden"
      onClick={(e) => e.stopPropagation()}
    >
      <button onClick={() => onCreateBlock("note")} className="w-full text-left px-3 py-1.5 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)] transition-colors">
        ¶ Texte
      </button>
      <button onClick={() => onCreateBlock("quote")} className="w-full text-left px-3 py-1.5 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)] transition-colors">
        ❝ Citation
      </button>
      <button onClick={() => setRecording(true)} className="w-full text-left px-3 py-1.5 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)] transition-colors">
        🎙 Audio
      </button>
      {!compact && (
        <button onClick={() => onCreateBlock("columns")} className="w-full text-left px-3 py-1.5 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)] transition-colors">
          ▥ 2 colonnes
        </button>
      )}
    </div>
  );
}

// ── Bloc individuel ───────────────────────────────────────────────────────────
// Composant séparé du parent, dispatche sur les 5 types de blocs purs.

function JournalItemBlock({
  item,
  idx,
  total,
  editingKey,
  setEditingKey,
  menuOpen,
  menuRef,
  insertMenuOpen,
  insertMenuRef,
  onToggleMenu,
  onMoveUp,
  onMoveDown,
  onOpenInsertMenu,
  onDeleteBlock,
  onDeleteColumns,
  onSaveNote,
  onPersistNote,
  onSaveQuote,
  onPersistQuote,
  onPersistAudioTranscript,
  onCreateBlock,
  onCreateAudio,
  onUnclaimSlot,
  onFillSlotWithImage,
  onFillSlotWithNew,
  onFillSlotWithAudio,
  sortable,
  isDragging,
  visitImages,
  visitId,
}: {
  item: JournalItem;
  idx: number;
  total: number;
  editingKey: string | null;
  setEditingKey: (key: string | null) => void;
  menuOpen: boolean;
  menuRef?: React.RefObject<HTMLDivElement | null>;
  insertMenuOpen: boolean;
  insertMenuRef?: React.RefObject<HTMLDivElement | null>;
  onToggleMenu: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onOpenInsertMenu: () => void;
  onDeleteBlock: (type: "note" | "quote" | "audio", id: string) => void;
  onDeleteColumns: (id: string) => void;
  onSaveNote: (id: string, content: string) => void;
  onPersistNote: (id: string, content: string) => Promise<void>;
  onSaveQuote: (id: string, content: string) => void;
  onPersistQuote: (id: string, content: string) => Promise<void>;
  onPersistAudioTranscript: (id: string, transcript: string) => Promise<void>;
  onCreateBlock: (type: "note" | "quote" | "columns") => void;
  onCreateAudio: (created: CreatedAudioBlock) => void;
  onUnclaimSlot: (columnsId: string, slot: "left" | "right") => void;
  onFillSlotWithImage: (columnsId: string, slot: "left" | "right", image: JournalImage) => void;
  onFillSlotWithNew: (columnsId: string, slot: "left" | "right", type: "note" | "quote") => void;
  onFillSlotWithAudio: (columnsId: string, slot: "left" | "right", created: CreatedAudioBlock) => void;
  sortable: SortableGrid;
  isDragging: boolean;
  visitImages: JournalImage[];
  visitId: string;
}) {
  const sortableKey = `${item.type}-${item.id}`;
  const isVisualBlock = item.type === "image" || item.type === "audio" || item.type === "columns";

  const itemMenu = (
    <div className="relative" ref={menuOpen ? menuRef : insertMenuOpen ? insertMenuRef : undefined}>
      <button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggleMenu(); }}
        className={cn(
          "w-9 h-9 md:w-6 md:h-6 flex items-center justify-center rounded-full text-sm md:text-xs transition-all",
          isVisualBlock
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
            onClick={onOpenInsertMenu}
            className="w-full text-left px-3 py-1.5 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] border-t border-[var(--border-subtle)] transition-colors"
          >
            ✎ Insérer un bloc après
          </button>
          {(item.type === "note" || item.type === "quote" || item.type === "audio") && (
            <button
              onClick={() => onDeleteBlock(item.type, item.id)}
              className="w-full text-left px-3 py-1.5 text-[11px] text-red-400 hover:bg-[var(--bg-surface)] border-t border-[var(--border-subtle)] transition-colors"
            >
              Supprimer
            </button>
          )}
          {item.type === "columns" && (
            <button
              onClick={() => onDeleteColumns(item.id)}
              className="w-full text-left px-3 py-1.5 text-[11px] text-red-400 hover:bg-[var(--bg-surface)] border-t border-[var(--border-subtle)] transition-colors"
            >
              Supprimer les colonnes
            </button>
          )}
        </div>
      )}
      {insertMenuOpen && (
        <div className="absolute right-0 top-full mt-1 z-50" onClick={(e) => e.stopPropagation()}>
          <InsertTypeMenu visitId={visitId} onCreateBlock={onCreateBlock} onCreateAudio={onCreateAudio} />
        </div>
      )}
    </div>
  );

  // Pendant le drag, les blocs pleine largeur se réduisent à une fine barre
  // d'insertion : sinon un gros bloc pousse toutes les images à chaque
  // micro-déplacement et il devient impossible de viser. Le clone flottant
  // (rendu par le parent) reste le bloc complet.
  const ghostBar = (
    <motion.div layout className="col-span-full py-1">
      <div className="h-1.5 rounded-full bg-[var(--text-primary)]/40" />
    </motion.div>
  );

  if (item.type === "note" || item.type === "quote") {
    const key = `${item.type}-${item.id}`;
    const isEditing = editingKey === key;
    const dragBindings = isEditing ? {} : { ...sortable.getContainerProps(sortableKey) };
    if (isDragging) return ghostBar;
    return (
      <motion.div
        layout
        {...dragBindings}
        // Design "table de montage" (Phase 2) : les blocs texte flottent sur
        // le fond noir, structurés par les marges seules — plus de bordure ni
        // de fond gris permanent. Le fond n'apparaît qu'au survol (affordance
        // d'édition) et pendant l'édition (délimite la zone de saisie).
        className={cn(
          "col-span-full rounded-lg px-4 py-3 transition-colors relative group/note",
          isEditing ? "bg-[var(--bg-surface)]" : "hover:bg-white/[0.03]"
        )}
      >
        <div
          className="flex items-start gap-2"
          onClick={() => { if (!isEditing && !sortable.wasDragging()) setEditingKey(key); }}
        >
          {item.type === "note" ? (
            <NoteEditor
              content={item.content}
              editable={isEditing}
              onBlurSave={(html) => onSaveNote(item.id, html)}
              onAutoSave={(html) => onPersistNote(item.id, html)}
              placeholder="Note vide — cliquer pour éditer"
            />
          ) : (
            <QuoteEditor
              content={item.content}
              editable={isEditing}
              onBlurSave={(text) => onSaveQuote(item.id, text)}
              onAutoSave={(text) => onPersistQuote(item.id, text)}
              placeholder="Citation vide — cliquer pour éditer"
            />
          )}
          {itemMenu}
          {!isEditing && (
            <DragHandle {...sortable.getHandleProps(sortableKey)} className="absolute bottom-1.5 right-1.5" title="Glisser pour réordonner" />
          )}
        </div>
      </motion.div>
    );
  }

  if (item.type === "audio") {
    if (isDragging) return ghostBar;
    return (
      <motion.div layout {...sortable.getContainerProps(sortableKey)} className="col-span-full relative group">
        <AudioBlockContent audio={item} onPersistTranscript={(t) => onPersistAudioTranscript(item.id, t)} />
        <div className="absolute top-2 right-2 z-10">{itemMenu}</div>
        <DragHandle {...sortable.getHandleProps(sortableKey)} className="absolute bottom-1.5 right-1.5 z-10" title="Glisser pour réordonner" />
      </motion.div>
    );
  }

  if (item.type === "columns") {
    const isAnySlotEditing = [item.left, item.right].some(
      (b) => b && (b.type === "note" || b.type === "quote") && editingKey === `${b.type}-${b.id}`,
    );
    const dragBindings = isAnySlotEditing ? {} : { ...sortable.getContainerProps(sortableKey) };
    if (isDragging) return ghostBar;
    return (
      <motion.div layout {...dragBindings} className="col-span-full relative group py-1">
        <div className="grid grid-cols-2 gap-3">
          <ColumnSlot
            visitId={visitId}
            columnsId={item.id}
            slot="left"
            block={item.left}
            visitImages={visitImages}
            editingKey={editingKey}
            setEditingKey={setEditingKey}
            onSaveNote={onSaveNote}
            onPersistNote={onPersistNote}
            onSaveQuote={onSaveQuote}
            onPersistQuote={onPersistQuote}
            onPersistAudioTranscript={onPersistAudioTranscript}
            onUnclaim={() => onUnclaimSlot(item.id, "left")}
            onFillWithImage={(img) => onFillSlotWithImage(item.id, "left", img)}
            onFillWithNew={(type) => onFillSlotWithNew(item.id, "left", type)}
            onFillWithAudio={(a) => onFillSlotWithAudio(item.id, "left", a)}
          />
          <ColumnSlot
            visitId={visitId}
            columnsId={item.id}
            slot="right"
            block={item.right}
            visitImages={visitImages}
            editingKey={editingKey}
            setEditingKey={setEditingKey}
            onSaveNote={onSaveNote}
            onPersistNote={onPersistNote}
            onSaveQuote={onSaveQuote}
            onPersistQuote={onPersistQuote}
            onPersistAudioTranscript={onPersistAudioTranscript}
            onUnclaim={() => onUnclaimSlot(item.id, "right")}
            onFillWithImage={(img) => onFillSlotWithImage(item.id, "right", img)}
            onFillWithNew={(type) => onFillSlotWithNew(item.id, "right", type)}
            onFillWithAudio={(a) => onFillSlotWithAudio(item.id, "right", a)}
          />
        </div>
        <div className="absolute -top-1 right-1.5 z-10">{itemMenu}</div>
        <DragHandle {...sortable.getHandleProps(sortableKey)} className="absolute -bottom-1 right-1.5 z-10" title="Glisser pour réordonner" />
      </motion.div>
    );
  }

  // ── Bloc Œuvre : image + légende typographique automatique (Titre /
  // Artiste · Année) tirée des métadonnées de l'inspiration — façon cartel
  // de musée, esprit "table de montage" du plan Phase 2.
  const ar = item.width && item.height ? item.width / item.height : 1;
  return (
    <motion.div
      layout
      {...sortable.getContainerProps(sortableKey)}
      className={cn("group relative", isDragging && "opacity-40")}
    >
      <div
        className={cn(
          // Surtout PAS `transition-all` : Framer pilote `transform` à la main
          // pendant l'animation `layout`, et un `transition: all` CSS ré-anime
          // ce même transform en parallèle → conflit, saccades. On se limite
          // à la couleur.
          "relative rounded-md overflow-hidden bg-[var(--bg-surface)] transition-colors"
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
      </div>

      {/* Cartel — masqué s'il n'y a rien d'autre qu'un nom de fichier généré */}
      <div className="mt-1.5 px-0.5 min-h-[1rem]">
        <p className="text-[12px] leading-snug text-[var(--text-secondary)] line-clamp-2 group-hover:text-[var(--text-primary)] transition-colors">
          {item.title}
        </p>
        {(item.author || item.year) && (
          <p className="text-[11px] text-[var(--text-tertiary)] italic mt-0.5 truncate">
            {item.author}
            {item.author && item.year ? " · " : ""}
            {item.year ?? ""}
          </p>
        )}
      </div>
    </motion.div>
  );
}

// ── Bloc audio (waveform + transcription éditable) ──────────────────────────
// Partagé par le rendu top-level et par un slot de colonnes.

function AudioBlockContent({
  audio,
  onPersistTranscript,
}: {
  audio: JournalAudio;
  onPersistTranscript: (text: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(audio.transcript ?? "");

  useEffect(() => {
    if (!editing) setValue(audio.transcript ?? "");
  }, [audio.transcript, editing]);

  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 space-y-1.5">
      <AudioPlayerBoundary src={getAudioUrl(audio.storageKey)}>
        <AudioPlayer src={getAudioUrl(audio.storageKey)} durationSec={audio.durationSec} />
      </AudioPlayerBoundary>
      {editing ? (
        <textarea
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => {
            setEditing(false);
            if (value.trim() !== (audio.transcript ?? "").trim()) onPersistTranscript(value).catch(() => {});
          }}
          rows={2}
          placeholder="Transcription…"
          className="w-full bg-transparent text-xs text-[var(--text-secondary)] focus:outline-none resize-none placeholder:text-[var(--text-tertiary)]"
        />
      ) : (
        <p
          onClick={() => setEditing(true)}
          className={cn(
            "text-xs leading-relaxed cursor-text",
            audio.transcript ? "text-[var(--text-secondary)]" : "text-[var(--text-tertiary)] italic"
          )}
        >
          {audio.transcript || "Transcription vide — cliquer pour éditer"}
        </p>
      )}
    </div>
  );
}

// ── Slot d'un bloc colonnes ──────────────────────────────────────────────────
// Rend le bloc pur qui occupe ce slot (vide = sélecteur de type compact).

function ColumnSlot({
  visitId,
  columnsId,
  slot,
  block,
  visitImages,
  editingKey,
  setEditingKey,
  onSaveNote,
  onPersistNote,
  onSaveQuote,
  onPersistQuote,
  onPersistAudioTranscript,
  onUnclaim,
  onFillWithImage,
  onFillWithNew,
  onFillWithAudio,
}: {
  visitId: string;
  columnsId: string;
  slot: "left" | "right";
  block: JournalBlock | null;
  visitImages: JournalImage[];
  editingKey: string | null;
  setEditingKey: (key: string | null) => void;
  onSaveNote: (id: string, content: string) => void;
  onPersistNote: (id: string, content: string) => Promise<void>;
  onSaveQuote: (id: string, content: string) => void;
  onPersistQuote: (id: string, content: string) => Promise<void>;
  onPersistAudioTranscript: (id: string, transcript: string) => Promise<void>;
  onUnclaim: () => void;
  onFillWithImage: (image: JournalImage) => void;
  onFillWithNew: (type: "note" | "quote") => void;
  onFillWithAudio: (created: CreatedAudioBlock) => void;
}) {
  const [picker, setPicker] = useState<"closed" | "menu" | "image" | "audio">("closed");

  if (!block) {
    return (
      <div className="relative min-h-[6rem] rounded-lg border border-dashed border-[var(--border-default)] flex items-center justify-center">
        {picker === "closed" && (
          <button
            type="button"
            onClick={() => setPicker("menu")}
            className="w-8 h-8 rounded-full text-lg text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)] transition-colors"
          >
            +
          </button>
        )}
        {picker === "menu" && (
          <div className="absolute inset-0 z-20 flex flex-col items-stretch justify-center gap-1 bg-[var(--bg-elevated)] rounded-lg border border-[var(--border-default)] p-2">
            <button onClick={() => { onFillWithNew("note"); setPicker("closed"); }} className="w-full py-1.5 rounded text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)] transition-colors">¶ Texte</button>
            <button onClick={() => { onFillWithNew("quote"); setPicker("closed"); }} className="w-full py-1.5 rounded text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)] transition-colors">❝ Citation</button>
            <button onClick={() => setPicker("image")} className="w-full py-1.5 rounded text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)] transition-colors">🖼 Image</button>
            <button onClick={() => setPicker("audio")} className="w-full py-1.5 rounded text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)] transition-colors">🎙 Audio</button>
            <button onClick={() => setPicker("closed")} className="text-[10px] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] mt-0.5">Annuler</button>
          </div>
        )}
        {picker === "image" && (
          <div className="absolute inset-0 z-20 p-2 bg-[var(--bg-elevated)] rounded-lg border border-[var(--border-default)] overflow-y-auto">
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-[10px] uppercase tracking-widest text-[var(--text-tertiary)]">Images de la visite</p>
              <button onClick={() => setPicker("closed")} className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] text-xs">✕</button>
            </div>
            {visitImages.length === 0 ? (
              <p className="text-[11px] text-[var(--text-tertiary)]">Aucune image disponible.</p>
            ) : (
              <div className="grid grid-cols-3 gap-1">
                {visitImages.map((img) => (
                  <button
                    key={img.id}
                    type="button"
                    onClick={() => { onFillWithImage(img); setPicker("closed"); }}
                    className="aspect-square rounded overflow-hidden bg-[var(--bg-surface)] hover:ring-1 hover:ring-[var(--text-primary)] transition-all"
                  >
                    {img.thumbnailKey && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={getThumbnailUrl(img.thumbnailKey)} alt="" className="w-full h-full object-cover" />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {picker === "audio" && (
          <div className="absolute inset-0 z-20 flex items-center justify-center">
            <AudioRecorderInline
              visitId={visitId}
              onClose={() => setPicker("closed")}
              onCreated={(a) => { onFillWithAudio(a); setPicker("closed"); }}
            />
          </div>
        )}
      </div>
    );
  }

  const editingThis = editingKey === `${block.type}-${block.id}`;

  return (
    <div className="relative group/slot rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={onUnclaim}
        className="absolute top-1 right-1 z-10 w-6 h-6 rounded-full bg-black/50 text-white/90 text-[11px] flex items-center justify-center opacity-0 group-hover/slot:opacity-100 transition-opacity"
        title="Retirer de la colonne"
      >
        ✕
      </button>
      {block.type === "image" && (
        <div
          className="rounded-lg overflow-hidden bg-[var(--bg-surface)]"
          style={{ aspectRatio: block.width && block.height ? block.width / block.height : 1 }}
        >
          {block.thumbnailKey && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={getThumbnailUrl(block.thumbnailKey)} alt={block.title} className="w-full h-full object-cover" />
          )}
        </div>
      )}
      {block.type === "note" && (
        <div className="px-2 py-1.5 rounded-lg hover:bg-white/[0.03] transition-colors" onClick={() => !editingThis && setEditingKey(`note-${block.id}`)}>
          <NoteEditor
            content={block.content}
            editable={editingThis}
            onBlurSave={(html) => onSaveNote(block.id, html)}
            onAutoSave={(html) => onPersistNote(block.id, html)}
            placeholder="Note vide — cliquer pour éditer"
          />
        </div>
      )}
      {block.type === "quote" && (
        <div className="px-2 py-1.5 rounded-lg hover:bg-white/[0.03] transition-colors" onClick={() => !editingThis && setEditingKey(`quote-${block.id}`)}>
          <QuoteEditor
            content={block.content}
            editable={editingThis}
            onBlurSave={(text) => onSaveQuote(block.id, text)}
            onAutoSave={(text) => onPersistQuote(block.id, text)}
            placeholder="Citation vide — cliquer pour éditer"
          />
        </div>
      )}
      {block.type === "audio" && (
        <AudioBlockContent audio={block} onPersistTranscript={(t) => onPersistAudioTranscript(block.id, t)} />
      )}
    </div>
  );
}
