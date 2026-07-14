"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Heading, Pilcrow, Quote, Mic, Columns2, Image as ImageIcon, MoreHorizontal, ArrowUp, ArrowDown, FilePlus, ArrowLeftRight, X, Trash2, Plus, Link2, Video, ExternalLink, ImageOff } from "lucide-react";
import { parseYouTubeId } from "@/lib/visits/linkPreview";
import { cn } from "@/lib/utils";
import { getThumbnailUrl, getAudioUrl } from "@/lib/storage/urls";
import { useSortableGrid, type SortableGrid } from "@/hooks/useSortableGrid";
import { DragHandle } from "@/components/ui/DragHandle";
import { NoteEditor } from "@/components/visits/NoteEditor";
import { AudioPlayer } from "@/components/visits/AudioPlayer";
import { QuoteEditor } from "@/components/visits/QuoteEditor";
import { TitleEditor } from "@/components/visits/TitleEditor";
import { AudioRecorderInline, type CreatedAudioBlock } from "@/components/visits/AudioRecorderInline";
import { AudioPlayerBoundary } from "@/components/visits/AudioPlayerBoundary";

// ── Types ─────────────────────────────────────────────────────────────────────
// Carnet façon Notion : chaque bloc est PUR (un seul type). Le bloc "2
// colonnes" est le seul bloc composite — il compose deux PILES de blocs purs
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

export interface JournalTitle {
  type: "title";
  id: string; // visitTitleId
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

/** Bloc pur, seul type admissible dans une pile de colonnes. */
export type JournalBlock = JournalImage | JournalNote | JournalTitle | JournalQuote | JournalAudio;

export interface JournalColumns {
  type: "columns";
  id: string; // visitColumnsId
  /** Piles ordonnées — plusieurs blocs à la suite dans un même côté (ex. Titre puis Texte puis Audio). */
  left: JournalBlock[];
  right: JournalBlock[];
}

/**
 * Bloc "lien externe" (kind LINK, carte d'aperçu Open Graph) ou "embed
 * YouTube" (kind YOUTUBE, iframe). Bloc TOP-LEVEL uniquement — pas admissible
 * dans une pile de colonnes (donc absent de JournalBlock), au même titre que
 * le bloc "2 colonnes".
 */
export interface JournalEmbed {
  type: "embed";
  id: string; // visitEmbedId
  kind: "LINK" | "YOUTUBE";
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
}

export type JournalItem = JournalBlock | JournalColumns | JournalEmbed;

interface VisitJournalProps {
  visitId: string;
  initialItems: JournalItem[];
}

// ── Composant ─────────────────────────────────────────────────────────────────
// Carnet de visite : séquence ordonnée de blocs purs (image/texte/titre/
// citation/audio/2 colonnes — voir types ci-dessus).
// - Grille responsive ; seule l'image reste une cellule de grille, les autres
//   types occupent toute la largeur (col-span-full)
// - Réordonnancement : overlay flottant + fantôme (souris n'importe où sur le
//   bloc, tactile via poignée dédiée — voir useSortableGrid) + ↑/↓ dans le
//   menu ⋯ de chaque bloc en alternative. Les blocs imbriqués dans une
//   colonne sont draguables au même titre que les blocs top-level : les
//   déposer sur une pile de colonne les y ajoute, sur un bloc top-level les
//   en fait ressortir à cet endroit précis.

const REF_TYPE: Record<JournalBlock["type"], "IMAGE" | "TEXT" | "TITLE" | "QUOTE" | "AUDIO"> = {
  image: "IMAGE",
  note: "TEXT",
  title: "TITLE",
  quote: "QUOTE",
  audio: "AUDIO",
};

const keyOf = (item: { type: string; id: string }) => `${item.type}-${item.id}`;

// ── Localisation d'un bloc dans l'arbre (top-level ou imbriqué) ──────────────
// Fonctions pures, réutilisées par toutes les opérations de déplacement
// (drag, boutons ↑/↓, sortir/réclamer) pour ne jamais dupliquer la logique de
// recherche/retrait/insertion.

type Loc = { kind: "top"; index: number } | { kind: "column"; columnsId: string; side: "left" | "right"; index: number };

function locateBlock(items: JournalItem[], key: string): Loc | null {
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (keyOf(it) === key) return { kind: "top", index: i };
    if (it.type === "columns") {
      const li = it.left.findIndex((b) => keyOf(b) === key);
      if (li !== -1) return { kind: "column", columnsId: it.id, side: "left", index: li };
      const ri = it.right.findIndex((b) => keyOf(b) === key);
      if (ri !== -1) return { kind: "column", columnsId: it.id, side: "right", index: ri };
    }
  }
  return null;
}

function getBlockAtLoc(items: JournalItem[], loc: Loc): JournalItem | undefined {
  if (loc.kind === "top") return items[loc.index];
  const col = items.find((it) => it.type === "columns" && it.id === loc.columnsId) as JournalColumns | undefined;
  return col?.[loc.side][loc.index];
}

function removeAtLoc(items: JournalItem[], loc: Loc): JournalItem[] {
  if (loc.kind === "top") {
    const next = [...items];
    next.splice(loc.index, 1);
    return next;
  }
  return items.map((it) => {
    if (it.type === "columns" && it.id === loc.columnsId) {
      const arr = [...it[loc.side]];
      arr.splice(loc.index, 1);
      return { ...it, [loc.side]: arr };
    }
    return it;
  });
}

// Patch le contenu d'un bloc "réclamable" (note/titre/citation/audio/image),
// qu'il soit au top-level de la séquence ou imbriqué dans une pile de colonnes.
function patchClaimable<T extends JournalBlock>(
  items: JournalItem[],
  type: T["type"],
  id: string,
  patch: Partial<T>,
): JournalItem[] {
  return items.map((it) => {
    if (it.type === "columns") {
      let changed = false;
      const patchSide = (side: JournalBlock[]) =>
        side.map((b) => {
          if (b.type === type && b.id === id) {
            changed = true;
            return { ...b, ...patch } as JournalBlock;
          }
          return b;
        });
      const left = patchSide(it.left);
      const right = patchSide(it.right);
      return changed ? { ...it, left, right } : it;
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

  // ── Persistance de l'ordre top-level ──
  const persistOrder = (list: JournalItem[]) => {
    fetch(`/api/visits/${visitId}/reorder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: list.map((item, i) => ({ type: item.type, id: item.id, order: i })),
      }),
    }).catch(() => {});
  };

  // Remplace intégralement les deux piles d'UNE colonne (l'API fait un
  // remplacement complet, pas un patch incrémental — plus simple et sans
  // risque de désync entre client/serveur sur des tableaux ordonnés).
  const persistColumnsSides = (columnsId: string, list: JournalItem[]) => {
    const col = list.find((it) => it.type === "columns" && it.id === columnsId) as JournalColumns | undefined;
    if (!col) return;
    fetch(`/api/visits/${visitId}/columns/${columnsId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        left: col.left.map((b) => ({ type: REF_TYPE[b.type], id: b.id })),
        right: col.right.map((b) => ({ type: REF_TYPE[b.type], id: b.id })),
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

  // Réordonne un bloc À L'INTÉRIEUR d'une même pile de colonne (boutons
  // ↑/↓ du menu d'un bloc imbriqué — "switcher de position").
  const moveWithinColumn = (columnsId: string, side: "left" | "right", from: number, to: number) => {
    const col = itemsRef.current.find((it) => it.type === "columns" && it.id === columnsId) as JournalColumns | undefined;
    if (!col || to < 0 || to >= col[side].length || from === to) return;
    const arr = [...col[side]];
    const [moved] = arr.splice(from, 1);
    arr.splice(to, 0, moved);
    const next = itemsRef.current.map((it) => (it.type === "columns" && it.id === columnsId ? { ...it, [side]: arr } : it));
    setItems(next);
    persistColumnsSides(columnsId, next);
  };

  // Échange intégralement les deux piles d'une colonne (bouton "⇄").
  const switchColumnSides = (columnsId: string) => {
    const next = itemsRef.current.map((it) =>
      it.type === "columns" && it.id === columnsId ? { ...it, left: it.right, right: it.left } : it,
    );
    setItems(next);
    persistColumnsSides(columnsId, next);
  };

  // Déplace un bloc (top-level ou imbriqué) dans la pile d'une colonne — à
  // la fin de la pile ciblée. Utilisé par le drag (drop sur une pile) et par
  // la réclamation directe (image/nouveau bloc/audio créés dans un slot).
  const moveBlockToColumn = (fromLoc: Loc, block: JournalBlock, columnsId: string, side: "left" | "right") => {
    const withoutBlock = removeAtLoc(itemsRef.current, fromLoc);
    const next = withoutBlock.map((it) => (it.type === "columns" && it.id === columnsId ? { ...it, [side]: [...it[side], block] } : it));
    setItems(next);
    if (fromLoc.kind === "top") persistOrder(next);
    persistColumnsSides(columnsId, next);
    if (fromLoc.kind === "column" && fromLoc.columnsId !== columnsId) persistColumnsSides(fromLoc.columnsId, next);
  };

  // Sort un bloc imbriqué vers la séquence plate, à une position précise
  // (drag sur un bloc top-level cible) — "redéplacer" un bloc de colonne.
  const moveBlockToTop = (fromLoc: Loc & { kind: "column" }, block: JournalBlock, targetIndex: number) => {
    const withoutBlock = removeAtLoc(itemsRef.current, fromLoc);
    const next = [...withoutBlock];
    next.splice(Math.min(targetIndex, next.length), 0, block);
    setItems(next);
    persistOrder(next);
    persistColumnsSides(fromLoc.columnsId, next);
  };

  // Survol d'une pile de colonne pendant un drag — juste un indice visuel
  // (anneau de surbrillance), mis à jour seulement quand la cible change
  // réellement (pas à chaque pixel, voir la leçon "Maximum update depth
  // exceeded" du drag & drop bibliothèque — ne jamais lever la position brute
  // d'un geste continu dans le state).
  const [dropHoverKey, setDropHoverKey] = useState<string | null>(null);
  const dropHoverRef = useRef<string | null>(null);

  // ── Réordonnancement (overlay + fantôme, voir useSortableGrid) ──
  // Le bloc dragué est cloné dans un overlay flottant qui suit le pointeur ;
  // le fantôme et ses voisins se réorganisent proprement via `layout` de
  // Framer. `data-sortable-key` = clé (type+id) du bloc — posée aussi bien
  // sur les blocs top-level que sur les blocs imbriqués dans une colonne,
  // qui participent donc au MÊME système de drag. Chaque pile de colonne
  // expose `data-drop-key="columns:<id>:<slot>"` — déposer un bloc dessus
  // l'y ajoute (à la fin de la pile) au lieu de le réordonner.
  const sortable = useSortableGrid({
    onReorder: (draggedKey, targetKey) => {
      // Réordonnancement EN DIRECT limité au niveau top-level (un drag
      // impliquant un bloc imbriqué ne bouge rien tant qu'on n'a pas relâché
      // — voir onDrop pour la résolution finale, y compris entre/vers des
      // colonnes).
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
    onHover: (hitEl) => {
      const key = hitEl?.closest<HTMLElement>("[data-drop-key]")?.getAttribute("data-drop-key") ?? null;
      if (key !== dropHoverRef.current) {
        dropHoverRef.current = key;
        setDropHoverKey(key);
      }
    },
    onDrop: (hitEl, _x, _y, draggedKey) => {
      dropHoverRef.current = null;
      setDropHoverKey(null);

      const loc = locateBlock(itemsRef.current, draggedKey);
      if (!loc) {
        persistOrder(itemsRef.current);
        return;
      }
      const draggedBlock = getBlockAtLoc(itemsRef.current, loc);
      if (!draggedBlock || draggedBlock.type === "columns" || draggedBlock.type === "embed") {
        // Colonnes et blocs lien/embed restent top-level : ils ne s'imbriquent
        // jamais dans une colonne. Le réordonnancement top-level a déjà été géré
        // en direct par onReorder.
        persistOrder(itemsRef.current);
        return;
      }

      // 1) Cible = une pile de colonne (vide ou non) → on y ajoute le bloc.
      const zoneEl = hitEl?.closest<HTMLElement>("[data-drop-key]");
      const [, zoneColumnsId, zoneSide] = (zoneEl?.getAttribute("data-drop-key") ?? "").split(":");
      if (zoneColumnsId && (zoneSide === "left" || zoneSide === "right")) {
        if (loc.kind === "column" && loc.columnsId === zoneColumnsId && loc.side === zoneSide) {
          persistOrder(itemsRef.current); // déjà dans cette pile
          return;
        }
        moveBlockToColumn(loc, draggedBlock, zoneColumnsId, zoneSide);
        return;
      }

      // 2) Cible = un bloc top-level précis → on ressort juste après lui
      //    (utile pour "redéplacer" un bloc de colonne à un endroit choisi).
      const blockEl = hitEl?.closest<HTMLElement>("[data-sortable-key]");
      const targetKey = blockEl?.getAttribute("data-sortable-key");
      if (targetKey && targetKey !== draggedKey) {
        const targetLoc = locateBlock(itemsRef.current, targetKey);
        if (targetLoc?.kind === "top") {
          if (loc.kind === "top") {
            persistOrder(itemsRef.current); // déjà géré en direct par onReorder
            return;
          }
          moveBlockToTop(loc, draggedBlock, targetLoc.index);
          return;
        }
      }

      // 3) Aucune cible reconnue : un bloc issu d'une colonne "sort"
      //    simplement en fin de séquence plate (comportement de secours).
      if (loc.kind === "column") {
        moveBlockToTop(loc, draggedBlock, itemsRef.current.length);
        return;
      }
      persistOrder(itemsRef.current);
    },
  });

  const draggedItem = sortable.draggingKey
    ? (getBlockAtLoc(items, locateBlock(items, sortable.draggingKey) ?? { kind: "top", index: -1 }) ?? null)
    : null;

  // Proposées pour remplir une pile "Image" de colonnes — seules les images
  // encore au top-level (non déjà réclamées) sont candidates.
  const visitImages: JournalImage[] = items.filter((it): it is JournalImage => it.type === "image");

  // Chaque type "simple" (créé vide, réclamable) a son propre endpoint REST
  // mais la même forme { content } — un seul mapping pour les fonctions qui
  // en ont besoin.
  const ENDPOINT_BY_TYPE = { note: "notes", title: "titles", quote: "quotes", audio: "audio", embed: "embeds" } as const;

  // ── Création de bloc (titre / texte / citation / colonnes) ──
  const createBlock = async (afterIdx: number | null, type: "note" | "title" | "quote" | "columns") => {
    setMenuIdx(null);
    setInsertMenu(null);
    const insertAt = afterIdx === null ? items.length : afterIdx + 1;
    const endpoint = type === "columns" ? "columns" : ENDPOINT_BY_TYPE[type];
    const body = type === "columns" ? {} : { content: "" };
    const res = await fetch(`/api/visits/${visitId}/${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return;
    const created = await res.json();
    const newItem: JournalItem =
      type === "columns" ? { type: "columns", id: created.id, left: [], right: [] } : { type, id: created.id, content: "" };
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

  const persistTitle = async (titleId: string, text: string) => {
    setItems((prev) => patchClaimable<JournalTitle>(prev, "title", titleId, { content: text }));
    const res = await fetch(`/api/visits/${visitId}/titles/${titleId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: text }),
    }).catch(() => null);
    if (!res?.ok) throw new Error("save failed");
  };

  const saveTitle = async (titleId: string, text: string) => {
    setEditingKey(null);
    if (!text.trim()) {
      deleteBlock("title", titleId);
      return;
    }
    await persistTitle(titleId, text).catch(() => {});
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

  // Supprime un bloc pur (texte/titre/citation/audio) ou un bloc lien/embed, où
  // qu'il soit (le serveur nettoie lui-même toute colonne qui le réclamait).
  const deleteBlock = async (type: "note" | "title" | "quote" | "audio" | "embed", id: string) => {
    setMenuIdx(null);
    const loc = locateBlock(itemsRef.current, `${type}-${id}`);
    const next = loc ? removeAtLoc(itemsRef.current, loc) : itemsRef.current.filter((it) => !(it.type === type && it.id === id));
    setItems(next);
    await fetch(`/api/visits/${visitId}/${ENDPOINT_BY_TYPE[type]}/${id}`, { method: "DELETE" }).catch(() => {});
  };

  // Retire une image DU CARNET sans la supprimer : elle repart dans la
  // bibliothèque (visitId=null côté serveur). Non destructif — choix produit
  // 2026-07-14 (cohérent avec "supprimer un bloc = retirer la référence ici").
  const detachImage = async (imageId: string) => {
    setMenuIdx(null);
    const loc = locateBlock(itemsRef.current, `image-${imageId}`);
    const next = loc ? removeAtLoc(itemsRef.current, loc) : itemsRef.current;
    setItems(next);
    if (loc?.kind === "column") persistColumnsSides(loc.columnsId, next);
    else persistOrder(next);
    await fetch(`/api/visits/${visitId}/inspirations/${imageId}`, { method: "DELETE" }).catch(() => {});
  };

  // Crée un bloc lien externe (LINK) ou embed YouTube (YOUTUBE). Le serveur
  // récupère les métadonnées (Open Graph / oEmbed) et renvoie le bloc complet.
  const createEmbed = async (afterIdx: number | null, kind: "LINK" | "YOUTUBE", url: string) => {
    setMenuIdx(null);
    setInsertMenu(null);
    const insertAt = afterIdx === null ? items.length : afterIdx + 1;
    const res = await fetch(`/api/visits/${visitId}/embeds`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, url }),
    });
    if (!res.ok) return;
    const c = await res.json();
    const newItem: JournalItem = {
      type: "embed",
      id: c.id,
      kind: c.kind,
      url: c.url,
      title: c.title ?? null,
      description: c.description ?? null,
      image: c.image ?? null,
      siteName: c.siteName ?? null,
    };
    const next = [...items];
    next.splice(insertAt, 0, newItem);
    setItems(next);
    persistOrder(next);
  };

  // ── Colonnes CRUD ──
  // Supprime le conteneur "2 colonnes" — tous les blocs qu'il réclamait (des
  // deux piles) redeviennent autonomes en fin de séquence plate (pas de
  // perte de contenu).
  const deleteColumns = async (columnsId: string) => {
    setMenuIdx(null);
    const col = itemsRef.current.find((it) => it.type === "columns" && it.id === columnsId) as JournalColumns | undefined;
    const next = [
      ...itemsRef.current.filter((it) => !(it.type === "columns" && it.id === columnsId)),
      ...(col ? [...col.left, ...col.right] : []),
    ];
    setItems(next);
    persistOrder(next);
    await fetch(`/api/visits/${visitId}/columns/${columnsId}`, { method: "DELETE" }).catch(() => {});
  };

  // Ajoute un bloc DÉJÀ EXISTANT (créé côté API) à la fin d'une pile.
  const appendToColumn = (columnsId: string, side: "left" | "right", block: JournalBlock) => {
    const next = itemsRef.current.map((it) => (it.type === "columns" && it.id === columnsId ? { ...it, [side]: [...it[side], block] } : it));
    setItems(next);
    persistColumnsSides(columnsId, next);
  };

  // Retire un bloc précis d'une pile sans le supprimer : il redevient un
  // bloc autonome en fin de séquence plate ("sortir").
  const unclaimBlock = (columnsId: string, side: "left" | "right", block: JournalBlock) => {
    const loc = locateBlock(itemsRef.current, keyOf(block));
    if (!loc || loc.kind !== "column") return;
    const withoutBlock = removeAtLoc(itemsRef.current, loc);
    const next = [...withoutBlock, block];
    setItems(next);
    persistOrder(next);
    persistColumnsSides(columnsId, next);
  };

  // Ajoute une image déjà attachée à la visite à la fin d'une pile.
  const fillWithImage = (columnsId: string, side: "left" | "right", image: JournalImage) => {
    const withoutImg = itemsRef.current.filter((it) => !(it.type === "image" && it.id === image.id));
    const next = withoutImg.map((it) => (it.type === "columns" && it.id === columnsId ? { ...it, [side]: [...it[side], image] } : it));
    setItems(next);
    persistColumnsSides(columnsId, next);
  };

  // Crée un nouveau bloc titre/texte/citation côté API puis l'ajoute à la
  // fin d'une pile.
  const fillWithNew = async (columnsId: string, side: "left" | "right", type: "note" | "title" | "quote") => {
    const res = await fetch(`/api/visits/${visitId}/${ENDPOINT_BY_TYPE[type]}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "" }),
    });
    if (!res.ok) return;
    const created = await res.json();
    const block = { type, id: created.id, content: "" } as JournalBlock;
    appendToColumn(columnsId, side, block);
    setEditingKey(`${type}-${created.id}`);
  };

  // Ajoute un clip audio tout juste enregistré (déjà créé côté API par
  // AudioRecorderInline) à la fin d'une pile.
  const fillWithAudio = (columnsId: string, side: "left" | "right", created: CreatedAudioBlock) => {
    const block: JournalAudio = { type: "audio", id: created.id, storageKey: created.storageKey, durationSec: created.durationSec, transcript: created.transcript };
    appendToColumn(columnsId, side, block);
  };

  // ── Titre d'image (cartel) ── édition inline au clic, PATCH direct sur
  // l'Inspiration (pas un bloc du carnet — le titre appartient à l'image
  // elle-même, partagé avec la bibliothèque).
  const saveImageTitle = async (imageId: string, title: string) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    setItems((prev) => patchClaimable<JournalImage>(prev, "image", imageId, { title: trimmed }));
    await fetch(`/api/inspirations/${imageId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: trimmed }),
    }).catch(() => {});
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
            onDetachImage={detachImage}
            onCreateEmbed={(kind, url) => createEmbed(idx, kind, url)}
            onSaveNote={saveNote}
            onPersistNote={persistNote}
            onSaveTitle={saveTitle}
            onPersistTitle={persistTitle}
            onSaveQuote={saveQuote}
            onPersistQuote={persistQuote}
            onPersistAudioTranscript={persistAudioTranscript}
            onSaveImageTitle={saveImageTitle}
            onCreateBlock={(type) => createBlock(idx, type)}
            onCreateAudio={(created) => insertAudioBlock(idx, created)}
            onMoveWithinColumn={moveWithinColumn}
            onSwitchColumnSides={switchColumnSides}
            onUnclaimBlock={unclaimBlock}
            onFillWithImage={fillWithImage}
            onFillWithNew={fillWithNew}
            onFillWithAudio={fillWithAudio}
            sortable={sortable}
            isDragging={sortable.draggingKey === keyOf(item)}
            dropHoverKey={dropHoverKey}
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
                {draggedItem.type === "columns"
                  ? "2 colonnes"
                  : draggedItem.type === "embed"
                    ? draggedItem.title || draggedItem.url
                    : "content" in draggedItem
                      ? draggedItem.content
                      : draggedItem.transcript}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Fin de carnet : sur DESKTOP, zone quasi invisible façon Notion qui se
          révèle au survol/focus (ou "/" au clavier). Sur TACTILE (pas de
          survol), un vrai bouton visible "+ Ajouter un bloc" — sinon
          impossible d'ajouter du texte au doigt. */}
      {/* Marge basse importante sur tactile : le FAB de capture (fixe, centré
          en bas) recouvrait sinon ce bouton une fois défilé tout en bas. */}
      <div className="mt-2 relative pointer-coarse:mb-32">
        <button
          type="button"
          onClick={() => setInsertMenu(insertMenu?.afterIdx === null ? null : { afterIdx: null })}
          onKeyDown={(e) => { if (e.key === "/") { e.preventDefault(); setInsertMenu({ afterIdx: null }); } }}
          className="w-full min-h-[3rem] rounded-lg px-4 text-sm text-[var(--text-tertiary)] transition-opacity cursor-text flex items-center gap-2
                     opacity-0 hover:opacity-70 focus-visible:opacity-70
                     pointer-coarse:opacity-100 pointer-coarse:border pointer-coarse:border-dashed pointer-coarse:border-[var(--border-default)] pointer-coarse:justify-center"
        >
          <Plus size={16} strokeWidth={1.75} />
          <span className="pointer-coarse:hidden">Cliquer, ou taper «&nbsp;/&nbsp;» pour ajouter un bloc…</span>
          <span className="hidden pointer-coarse:inline">Ajouter un bloc</span>
        </button>
        {insertMenu?.afterIdx === null && (
          // Sur tactile le menu s'ouvre VERS LE HAUT (bottom-full) — sinon il
          // tombait sous le FAB / hors écran et le choix du type était
          // inatteignable. Desktop : vers le bas comme avant.
          <div ref={insertMenuRef} className="absolute left-4 z-50 bottom-full mb-1 md:bottom-auto md:top-full md:mt-1">
            <InsertTypeMenu visitId={visitId} onCreateBlock={(type) => createBlock(null, type)} onCreateAudio={(a) => insertAudioBlock(null, a)} onCreateEmbed={(kind, url) => createEmbed(null, kind, url)} />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Menu de choix de type de bloc ────────────────────────────────────────────
// Partagé par la zone "+ Bloc" (fin de carnet), le "⋯ Insérer un bloc après"
// de chaque item, et les piles de colonnes.

function InsertTypeMenu({
  visitId,
  onCreateBlock,
  onCreateAudio,
  onCreateEmbed,
}: {
  visitId: string;
  onCreateBlock: (type: "note" | "title" | "quote" | "columns") => void;
  onCreateAudio: (created: CreatedAudioBlock) => void;
  onCreateEmbed: (kind: "LINK" | "YOUTUBE", url: string) => void;
}) {
  const [mode, setMode] = useState<"menu" | "recording" | "LINK" | "YOUTUBE">("menu");

  if (mode === "recording") {
    return <AudioRecorderInline visitId={visitId} onClose={() => setMode("menu")} onCreated={onCreateAudio} />;
  }

  if (mode === "LINK" || mode === "YOUTUBE") {
    return <EmbedUrlInput kind={mode} onCancel={() => setMode("menu")} onSubmit={(url) => onCreateEmbed(mode, url)} />;
  }

  return (
    <div
      className="w-48 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-default)] shadow-xl overflow-hidden"
      onClick={(e) => e.stopPropagation()}
    >
      <button onClick={() => onCreateBlock("title")} className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)] transition-colors">
        <Heading size={14} strokeWidth={1.75} /> Titre
      </button>
      <button onClick={() => onCreateBlock("note")} className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)] transition-colors">
        <Pilcrow size={14} strokeWidth={1.75} /> Texte
      </button>
      <button onClick={() => onCreateBlock("quote")} className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)] transition-colors">
        <Quote size={14} strokeWidth={1.75} /> Citation
      </button>
      <button onClick={() => setMode("recording")} className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)] transition-colors">
        <Mic size={14} strokeWidth={1.75} /> Audio
      </button>
      <button onClick={() => setMode("LINK")} className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)] transition-colors">
        <Link2 size={14} strokeWidth={1.75} /> Lien externe
      </button>
      <button onClick={() => setMode("YOUTUBE")} className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)] transition-colors">
        <Video size={14} strokeWidth={1.75} /> YouTube
      </button>
      <button onClick={() => onCreateBlock("columns")} className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)] transition-colors">
        <Columns2 size={14} strokeWidth={1.75} /> 2 colonnes
      </button>
    </div>
  );
}

// Saisie d'URL pour créer un bloc lien/embed. Validation légère côté client
// (le serveur revérifie) : YouTube exige une URL youtube reconnaissable.
function EmbedUrlInput({
  kind,
  onCancel,
  onSubmit,
}: {
  kind: "LINK" | "YOUTUBE";
  onCancel: () => void;
  onSubmit: (url: string) => void;
}) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const valid = (() => {
    try {
      new URL(url.trim());
    } catch {
      return false;
    }
    return kind === "YOUTUBE" ? parseYouTubeId(url.trim()) !== null : /^https?:\/\//i.test(url.trim());
  })();

  const submit = () => {
    if (!valid || busy) return;
    setBusy(true);
    onSubmit(url.trim());
  };

  return (
    <div className="w-64 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-default)] shadow-xl p-2.5 space-y-2" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)]">
        {kind === "YOUTUBE" ? <Video size={13} strokeWidth={1.75} /> : <Link2 size={13} strokeWidth={1.75} />}
        {kind === "YOUTUBE" ? "Coller un lien YouTube" : "Coller un lien"}
      </div>
      <input
        ref={inputRef}
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") onCancel();
        }}
        placeholder={kind === "YOUTUBE" ? "https://youtube.com/watch?v=…" : "https://…"}
        className="w-full bg-[var(--bg-base)] border border-[var(--border-subtle)] rounded px-2 py-1.5 text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--text-tertiary)] placeholder:text-[var(--text-tertiary)]"
      />
      <div className="flex items-center justify-end gap-1.5">
        <button onClick={onCancel} className="px-2 py-1 text-[10px] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors">
          Annuler
        </button>
        <button
          onClick={submit}
          disabled={!valid || busy}
          className="px-2.5 py-1 text-[10px] rounded bg-[var(--text-primary)] text-[var(--bg-base)] disabled:opacity-40 transition-opacity"
        >
          {busy ? "Ajout…" : "Ajouter"}
        </button>
      </div>
    </div>
  );
}

// Vignette d'une carte de lien : se masque si l'image ne charge pas (404,
// anti-hotlink…) pour éviter l'icône d'image brisée. `no-referrer` contourne
// les protections anti-hotlink basées sur le Referer.
function LinkCardThumb({ src }: { src: string }) {
  const [ok, setOk] = useState(true);
  if (!ok) return null;
  return (
    <div className="w-28 sm:w-40 flex-shrink-0 bg-[var(--bg-surface)]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setOk(false)}
        className="w-full h-full object-cover"
      />
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
  onDetachImage,
  onCreateEmbed,
  onSaveNote,
  onPersistNote,
  onSaveTitle,
  onPersistTitle,
  onSaveQuote,
  onPersistQuote,
  onPersistAudioTranscript,
  onSaveImageTitle,
  onCreateBlock,
  onCreateAudio,
  onMoveWithinColumn,
  onSwitchColumnSides,
  onUnclaimBlock,
  onFillWithImage,
  onFillWithNew,
  onFillWithAudio,
  sortable,
  isDragging,
  dropHoverKey,
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
  onDeleteBlock: (type: "note" | "title" | "quote" | "audio" | "embed", id: string) => void;
  onDeleteColumns: (id: string) => void;
  onDetachImage: (id: string) => void;
  onCreateEmbed: (kind: "LINK" | "YOUTUBE", url: string) => void;
  onSaveNote: (id: string, content: string) => void;
  onPersistNote: (id: string, content: string) => Promise<void>;
  onSaveTitle: (id: string, content: string) => void;
  onPersistTitle: (id: string, content: string) => Promise<void>;
  onSaveQuote: (id: string, content: string) => void;
  onPersistQuote: (id: string, content: string) => Promise<void>;
  onPersistAudioTranscript: (id: string, transcript: string) => Promise<void>;
  onSaveImageTitle: (id: string, title: string) => void;
  onCreateBlock: (type: "note" | "title" | "quote" | "columns") => void;
  onCreateAudio: (created: CreatedAudioBlock) => void;
  onMoveWithinColumn: (columnsId: string, side: "left" | "right", from: number, to: number) => void;
  onSwitchColumnSides: (columnsId: string) => void;
  onUnclaimBlock: (columnsId: string, side: "left" | "right", block: JournalBlock) => void;
  onFillWithImage: (columnsId: string, side: "left" | "right", image: JournalImage) => void;
  onFillWithNew: (columnsId: string, side: "left" | "right", type: "note" | "title" | "quote") => void;
  onFillWithAudio: (columnsId: string, side: "left" | "right", created: CreatedAudioBlock) => void;
  sortable: SortableGrid;
  isDragging: boolean;
  dropHoverKey: string | null;
  visitImages: JournalImage[];
  visitId: string;
}) {
  const sortableKey = keyOf(item);
  const isVisualBlock = item.type === "image" || item.type === "audio" || item.type === "columns" || item.type === "embed";

  const itemMenu = (
    <div className="relative" ref={menuOpen ? menuRef : insertMenuOpen ? insertMenuRef : undefined}>
      <button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggleMenu(); }}
        className={cn(
          "w-9 h-9 md:w-6 md:h-6 flex items-center justify-center rounded-full text-sm md:text-xs transition-all",
          isVisualBlock
            ? "bg-black/60 text-white/90 opacity-0 group-hover:opacity-100 pointer-coarse:opacity-100"
            : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)] opacity-0 group-hover/note:opacity-100 pointer-coarse:opacity-100"
        )}
        title="Options"
      >
        <MoreHorizontal size={16} strokeWidth={2} />
      </button>
      {menuOpen && (
        <div
          className="absolute right-0 top-full mt-1 z-50 w-44 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-default)] shadow-xl overflow-hidden"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
        >
          <button
            onClick={onMoveUp}
            disabled={idx === 0}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] disabled:opacity-30 transition-colors"
          >
            <ArrowUp size={13} strokeWidth={1.75} /> Monter
          </button>
          <button
            onClick={onMoveDown}
            disabled={idx === total - 1}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] disabled:opacity-30 transition-colors"
          >
            <ArrowDown size={13} strokeWidth={1.75} /> Descendre
          </button>
          <button
            onClick={onOpenInsertMenu}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] border-t border-[var(--border-subtle)] transition-colors"
          >
            <FilePlus size={13} strokeWidth={1.75} /> Insérer un bloc après
          </button>
          {(item.type === "note" || item.type === "title" || item.type === "quote" || item.type === "audio" || item.type === "embed") && (
            <button
              onClick={() => onDeleteBlock(item.type, item.id)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-red-400 hover:bg-[var(--bg-surface)] border-t border-[var(--border-subtle)] transition-colors"
            >
              <Trash2 size={13} strokeWidth={1.75} /> Supprimer
            </button>
          )}
          {/* Image : suppression NON destructive — on la retire du carnet, elle
              reste dans la bibliothèque (choix produit 2026-07-14). */}
          {item.type === "image" && (
            <button
              onClick={() => onDetachImage(item.id)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)] border-t border-[var(--border-subtle)] transition-colors"
            >
              <ImageOff size={13} strokeWidth={1.75} /> Retirer du carnet
            </button>
          )}
          {item.type === "columns" && (
            <>
              <button
                onClick={() => onSwitchColumnSides(item.id)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] border-t border-[var(--border-subtle)] transition-colors"
              >
                <ArrowLeftRight size={13} strokeWidth={1.75} /> Échanger gauche/droite
              </button>
              <button
                onClick={() => onDeleteColumns(item.id)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-red-400 hover:bg-[var(--bg-surface)] border-t border-[var(--border-subtle)] transition-colors"
              >
                <Trash2 size={13} strokeWidth={1.75} /> Supprimer les colonnes
              </button>
            </>
          )}
        </div>
      )}
      {insertMenuOpen && (
        <div className="absolute right-0 top-full mt-1 z-50" onClick={(e) => e.stopPropagation()}>
          <InsertTypeMenu visitId={visitId} onCreateBlock={onCreateBlock} onCreateAudio={onCreateAudio} onCreateEmbed={onCreateEmbed} />
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

  if (item.type === "note" || item.type === "title" || item.type === "quote") {
    const key = keyOf(item);
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
          {item.type === "note" && (
            <NoteEditor
              content={item.content}
              editable={isEditing}
              onBlurSave={(html) => onSaveNote(item.id, html)}
              onAutoSave={(html) => onPersistNote(item.id, html)}
              placeholder="Note vide — cliquer pour éditer"
            />
          )}
          {item.type === "title" && (
            <TitleEditor
              content={item.content}
              editable={isEditing}
              onBlurSave={(text) => onSaveTitle(item.id, text)}
              onAutoSave={(text) => onPersistTitle(item.id, text)}
              placeholder="Titre vide — cliquer pour éditer"
            />
          )}
          {item.type === "quote" && (
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
    const isAnyNestedEditing = [...item.left, ...item.right].some(
      (b) => (b.type === "note" || b.type === "title" || b.type === "quote") && editingKey === keyOf(b),
    );
    const dragBindings = isAnyNestedEditing ? {} : { ...sortable.getContainerProps(sortableKey) };
    if (isDragging) return ghostBar;
    return (
      <motion.div layout {...dragBindings} className="col-span-full relative group py-1">
        <div className="grid grid-cols-2 gap-3">
          <ColumnStack
            visitId={visitId}
            columnsId={item.id}
            side="left"
            blocks={item.left}
            visitImages={visitImages}
            editingKey={editingKey}
            setEditingKey={setEditingKey}
            onSaveNote={onSaveNote}
            onPersistNote={onPersistNote}
            onSaveTitle={onSaveTitle}
            onPersistTitle={onPersistTitle}
            onSaveQuote={onSaveQuote}
            onPersistQuote={onPersistQuote}
            onPersistAudioTranscript={onPersistAudioTranscript}
            onDeleteBlock={onDeleteBlock}
            onMoveWithin={(from, to) => onMoveWithinColumn(item.id, "left", from, to)}
            onUnclaim={(block) => onUnclaimBlock(item.id, "left", block)}
            onFillWithImage={(img) => onFillWithImage(item.id, "left", img)}
            onFillWithNew={(type) => onFillWithNew(item.id, "left", type)}
            onFillWithAudio={(a) => onFillWithAudio(item.id, "left", a)}
            dropHoverKey={dropHoverKey}
            sortable={sortable}
          />
          <ColumnStack
            visitId={visitId}
            columnsId={item.id}
            side="right"
            blocks={item.right}
            visitImages={visitImages}
            editingKey={editingKey}
            setEditingKey={setEditingKey}
            onSaveNote={onSaveNote}
            onPersistNote={onPersistNote}
            onSaveTitle={onSaveTitle}
            onPersistTitle={onPersistTitle}
            onSaveQuote={onSaveQuote}
            onPersistQuote={onPersistQuote}
            onPersistAudioTranscript={onPersistAudioTranscript}
            onDeleteBlock={onDeleteBlock}
            onMoveWithin={(from, to) => onMoveWithinColumn(item.id, "right", from, to)}
            onUnclaim={(block) => onUnclaimBlock(item.id, "right", block)}
            onFillWithImage={(img) => onFillWithImage(item.id, "right", img)}
            onFillWithNew={(type) => onFillWithNew(item.id, "right", type)}
            onFillWithAudio={(a) => onFillWithAudio(item.id, "right", a)}
            dropHoverKey={dropHoverKey}
            sortable={sortable}
          />
        </div>
        <div className="absolute -top-1 right-1.5 z-10">{itemMenu}</div>
        <DragHandle {...sortable.getHandleProps(sortableKey)} className="absolute -bottom-1 right-1.5 z-10" title="Glisser pour réordonner" />
      </motion.div>
    );
  }

  // ── Bloc lien externe (carte d'aperçu Open Graph) / embed YouTube (iframe) ──
  if (item.type === "embed") {
    if (isDragging) return ghostBar;
    const domain = (() => {
      try { return new URL(item.url).hostname.replace(/^www\./, ""); } catch { return item.url; }
    })();
    const videoId = item.kind === "YOUTUBE" ? parseYouTubeId(item.url) : null;
    return (
      <motion.div layout {...sortable.getContainerProps(sortableKey)} className="col-span-full relative group py-1">
        {item.kind === "YOUTUBE" ? (
          <div className="rounded-lg overflow-hidden bg-black" style={{ aspectRatio: "16 / 9" }}>
            {videoId ? (
              <iframe
                src={`https://www.youtube-nocookie.com/embed/${videoId}`}
                title={item.title ?? "YouTube"}
                className="w-full h-full"
                loading="lazy"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-[var(--text-tertiary)] text-xs">Vidéo indisponible</div>
            )}
          </div>
        ) : (
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            // Un drag qui vient de se terminer ne doit pas ouvrir le lien.
            onClick={(e) => { if (sortable.wasDragging()) e.preventDefault(); }}
            className="flex items-stretch gap-0 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] overflow-hidden hover:border-[var(--border-default)] transition-colors"
          >
            <div className="flex-1 min-w-0 px-4 py-3 flex flex-col justify-center gap-1">
              <p className="text-sm font-medium text-[var(--text-primary)] line-clamp-1">{item.title || domain}</p>
              {item.description && (
                <p className="text-xs text-[var(--text-secondary)] line-clamp-2 leading-snug">{item.description}</p>
              )}
              <p className="text-[11px] text-[var(--text-tertiary)] flex items-center gap-1 mt-0.5 truncate">
                <ExternalLink size={11} strokeWidth={1.75} /> {item.siteName || domain}
              </p>
            </div>
            {item.image && <LinkCardThumb src={item.image} />}
          </a>
        )}
        <div className="absolute top-2 right-2 z-10">{itemMenu}</div>
        <DragHandle {...sortable.getHandleProps(sortableKey)} className="absolute bottom-2 right-2 z-10" title="Glisser pour réordonner" />
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
        <EditableImageTitle
          title={item.title}
          onSave={(title) => onSaveImageTitle(item.id, title)}
          className="text-[12px] leading-snug text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] transition-colors"
        />
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

// ── Titre d'une image (cartel) éditable au clic ──────────────────────────────
// Le titre appartient à l'Inspiration elle-même (partagé avec la
// bibliothèque), pas au carnet — édition inline directe, pas de vocabulaire
// ●/✓ (sauvegarde immédiate au blur, pas d'auto-save pendant la frappe).

function EditableImageTitle({
  title,
  onSave,
  className,
}: {
  title: string;
  onSave: (title: string) => void;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setValue(title);
  }, [title, editing]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Enter") inputRef.current?.blur();
          if (e.key === "Escape") { setValue(title); setEditing(false); }
        }}
        onBlur={() => {
          setEditing(false);
          const trimmed = value.trim();
          if (trimmed && trimmed !== title) onSave(trimmed);
        }}
        className={cn(className, "w-full bg-transparent border-b border-[var(--border-default)] focus:outline-none focus:border-[var(--text-primary)]")}
      />
    );
  }

  return (
    <p
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); setEditing(true); }}
      className={cn(className, "line-clamp-2 cursor-text")}
      title="Cliquer pour éditer le titre"
    >
      {title}
    </p>
  );
}

// ── Bloc audio (waveform + transcription éditable) ──────────────────────────
// Partagé par le rendu top-level et par une pile de colonne.

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

// ── Pile d'un côté de colonne ─────────────────────────────────────────────────
// Rend la liste ordonnée des blocs purs qui occupent ce côté ("titre puis
// texte puis audio" par exemple), plus une affordance "+" en bas pour en
// ajouter d'autres. Toute la pile expose `data-drop-key` (y compris non
// vide) pour rester une cible de drag valide.

function ColumnStack({
  visitId,
  columnsId,
  side,
  blocks,
  visitImages,
  editingKey,
  setEditingKey,
  onSaveNote,
  onPersistNote,
  onSaveTitle,
  onPersistTitle,
  onSaveQuote,
  onPersistQuote,
  onPersistAudioTranscript,
  onDeleteBlock,
  onMoveWithin,
  onUnclaim,
  onFillWithImage,
  onFillWithNew,
  onFillWithAudio,
  dropHoverKey,
  sortable,
}: {
  visitId: string;
  columnsId: string;
  side: "left" | "right";
  blocks: JournalBlock[];
  visitImages: JournalImage[];
  editingKey: string | null;
  setEditingKey: (key: string | null) => void;
  onSaveNote: (id: string, content: string) => void;
  onPersistNote: (id: string, content: string) => Promise<void>;
  onSaveTitle: (id: string, content: string) => void;
  onPersistTitle: (id: string, content: string) => Promise<void>;
  onSaveQuote: (id: string, content: string) => void;
  onPersistQuote: (id: string, content: string) => Promise<void>;
  onPersistAudioTranscript: (id: string, transcript: string) => Promise<void>;
  onDeleteBlock: (type: "note" | "title" | "quote" | "audio", id: string) => void;
  onMoveWithin: (from: number, to: number) => void;
  onUnclaim: (block: JournalBlock) => void;
  onFillWithImage: (image: JournalImage) => void;
  onFillWithNew: (type: "note" | "title" | "quote") => void;
  onFillWithAudio: (created: CreatedAudioBlock) => void;
  dropHoverKey: string | null;
  sortable: SortableGrid;
}) {
  const [picker, setPicker] = useState<"closed" | "menu" | "image" | "audio">("closed");
  const dropKey = `columns:${columnsId}:${side}`;
  const isDropHover = dropHoverKey === dropKey;

  const adder = (
    <div className="relative">
      {picker === "closed" && (
        <button
          type="button"
          onClick={() => setPicker("menu")}
          className={cn(
            "flex items-center justify-center rounded-lg text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)] transition-colors",
            blocks.length === 0 ? "w-8 h-8 rounded-full text-lg" : "w-full py-2 text-xs border border-dashed border-[var(--border-default)]"
          )}
        >
          {blocks.length === 0 ? "+" : "+ Ajouter"}
        </button>
      )}
      {picker === "menu" && (
        <div className="absolute inset-x-0 top-0 z-20 flex flex-col items-stretch gap-1 bg-[var(--bg-elevated)] rounded-lg border border-[var(--border-default)] p-2">
          <button onClick={() => { onFillWithNew("title"); setPicker("closed"); }} className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)] transition-colors"><Heading size={13} strokeWidth={1.75} /> Titre</button>
          <button onClick={() => { onFillWithNew("note"); setPicker("closed"); }} className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)] transition-colors"><Pilcrow size={13} strokeWidth={1.75} /> Texte</button>
          <button onClick={() => { onFillWithNew("quote"); setPicker("closed"); }} className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)] transition-colors"><Quote size={13} strokeWidth={1.75} /> Citation</button>
          <button onClick={() => setPicker("image")} className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)] transition-colors"><ImageIcon size={13} strokeWidth={1.75} /> Image</button>
          <button onClick={() => setPicker("audio")} className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)] transition-colors"><Mic size={13} strokeWidth={1.75} /> Audio</button>
          <button onClick={() => setPicker("closed")} className="text-[10px] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] mt-0.5">Annuler</button>
        </div>
      )}
      {picker === "image" && (
        <div className="absolute inset-x-0 top-0 z-20 p-2 bg-[var(--bg-elevated)] rounded-lg border border-[var(--border-default)] max-h-48 overflow-y-auto">
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-[10px] uppercase tracking-widest text-[var(--text-tertiary)]">Images de la visite</p>
            <button onClick={() => setPicker("closed")} className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] flex items-center"><X size={14} strokeWidth={2} /></button>
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
        <div className="absolute inset-x-0 top-0 z-20 flex items-center justify-center">
          <AudioRecorderInline
            visitId={visitId}
            onClose={() => setPicker("closed")}
            onCreated={(a) => { onFillWithAudio(a); setPicker("closed"); }}
          />
        </div>
      )}
    </div>
  );

  return (
    <div data-drop-key={dropKey} className={cn("space-y-1.5 rounded-lg transition-colors", isDropHover && "ring-2 ring-[var(--text-primary)] ring-offset-2 ring-offset-[var(--bg-base)]")}>
      {blocks.length === 0 && (
        <div className="relative min-h-[6rem] rounded-lg border border-dashed border-[var(--border-default)] flex items-center justify-center">
          {adder}
          {isDropHover && picker === "closed" && (
            <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-[11px] text-[var(--text-primary)]">
              Déposer ici
            </span>
          )}
        </div>
      )}
      {blocks.map((block, i) => (
        <ColumnStackItem
          key={keyOf(block)}
          block={block}
          idx={i}
          total={blocks.length}
          editingKey={editingKey}
          setEditingKey={setEditingKey}
          onSaveNote={onSaveNote}
          onPersistNote={onPersistNote}
          onSaveTitle={onSaveTitle}
          onPersistTitle={onPersistTitle}
          onSaveQuote={onSaveQuote}
          onPersistQuote={onPersistQuote}
          onPersistAudioTranscript={onPersistAudioTranscript}
          onDeleteBlock={onDeleteBlock}
          onMoveUp={() => onMoveWithin(i, i - 1)}
          onMoveDown={() => onMoveWithin(i, i + 1)}
          onUnclaim={() => onUnclaim(block)}
          sortable={sortable}
          isDragging={sortable.draggingKey === keyOf(block)}
        />
      ))}
      {blocks.length > 0 && adder}
    </div>
  );
}

// ── Bloc imbriqué dans une pile de colonne ───────────────────────────────────
// Wrapper autour du contenu (même rendu que top-level pour chaque type),
// avec son propre petit menu ↑/↓/✕/Supprimer et sa propre poignée de drag —
// participe au même système de drag que les blocs top-level (voir
// useSortableGrid dans VisitJournal).

function ColumnStackItem({
  block,
  idx,
  total,
  editingKey,
  setEditingKey,
  onSaveNote,
  onPersistNote,
  onSaveTitle,
  onPersistTitle,
  onSaveQuote,
  onPersistQuote,
  onPersistAudioTranscript,
  onDeleteBlock,
  onMoveUp,
  onMoveDown,
  onUnclaim,
  sortable,
  isDragging,
}: {
  block: JournalBlock;
  idx: number;
  total: number;
  editingKey: string | null;
  setEditingKey: (key: string | null) => void;
  onSaveNote: (id: string, content: string) => void;
  onPersistNote: (id: string, content: string) => Promise<void>;
  onSaveTitle: (id: string, content: string) => void;
  onPersistTitle: (id: string, content: string) => Promise<void>;
  onSaveQuote: (id: string, content: string) => void;
  onPersistQuote: (id: string, content: string) => Promise<void>;
  onPersistAudioTranscript: (id: string, transcript: string) => Promise<void>;
  onDeleteBlock: (type: "note" | "title" | "quote" | "audio", id: string) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onUnclaim: () => void;
  sortable: SortableGrid;
  isDragging: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const sortableKey = keyOf(block);
  const editingThis = editingKey === sortableKey;

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent | TouchEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("touchstart", handler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("touchstart", handler);
    };
  }, [menuOpen]);

  if (isDragging) {
    return <div className="h-8 rounded-md bg-[var(--text-primary)]/10 border border-dashed border-[var(--text-primary)]/30" />;
  }

  // `stopPropagation` sur le pointerdown : sans ça, l'événement remonte
  // jusqu'au conteneur "2 colonnes" englobant (qui a lui aussi un
  // onPointerDown de drag, pour se réordonner lui-même parmi les blocs
  // top-level) et ÉCRASE l'armement du drag de CE bloc imbriqué — le drag
  // démarré finit par déplacer la colonne entière au lieu du bloc visé.
  const containerProps = sortable.getContainerProps(sortableKey);
  const dragBindings = editingThis
    ? {}
    : {
        ...containerProps,
        onPointerDown: (e: React.PointerEvent) => {
          e.stopPropagation();
          containerProps.onPointerDown(e);
        },
      };

  const menu = (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setMenuOpen((v) => !v); }}
        className="w-6 h-6 rounded-full bg-black/50 text-white/90 flex items-center justify-center opacity-0 group-hover/item:opacity-100 transition-opacity"
        title="Options"
      >
        <MoreHorizontal size={14} strokeWidth={2} />
      </button>
      {menuOpen && (
        <div
          className="absolute right-0 top-full mt-1 z-30 w-40 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-default)] shadow-xl overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <button onClick={() => { setMenuOpen(false); onMoveUp(); }} disabled={idx === 0} className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] disabled:opacity-30 transition-colors">
            <ArrowUp size={13} strokeWidth={1.75} /> Monter
          </button>
          <button onClick={() => { setMenuOpen(false); onMoveDown(); }} disabled={idx === total - 1} className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] disabled:opacity-30 transition-colors">
            <ArrowDown size={13} strokeWidth={1.75} /> Descendre
          </button>
          <button onClick={() => { setMenuOpen(false); onUnclaim(); }} className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] border-t border-[var(--border-subtle)] transition-colors">
            <X size={13} strokeWidth={1.75} /> Retirer de la colonne
          </button>
          {block.type !== "image" && (
            <button onClick={() => { setMenuOpen(false); onDeleteBlock(block.type, block.id); }} className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-red-400 hover:bg-[var(--bg-surface)] border-t border-[var(--border-subtle)] transition-colors">
              <Trash2 size={13} strokeWidth={1.75} /> Supprimer
            </button>
          )}
        </div>
      )}
    </div>
  );

  return (
    <motion.div layout {...dragBindings} className="relative group/item rounded-lg overflow-hidden">
      {block.type === "image" && (
        <div
          // Plafond de hauteur : sans lui, une image portrait (aspect-ratio
          // très petit) s'étire sur toute la largeur de la colonne et peut
          // devenir bien plus haute que le contenu de l'autre côté (texte,
          // citation…) — object-cover recadre proprement au-delà.
          className="rounded-lg overflow-hidden bg-[var(--bg-surface)] max-h-80"
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
      {block.type === "title" && (
        <div className="px-2 py-1.5 rounded-lg hover:bg-white/[0.03] transition-colors" onClick={() => !editingThis && setEditingKey(`title-${block.id}`)}>
          <TitleEditor
            content={block.content}
            editable={editingThis}
            onBlurSave={(text) => onSaveTitle(block.id, text)}
            onAutoSave={(text) => onPersistTitle(block.id, text)}
            placeholder="Titre vide — cliquer pour éditer"
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
      <div className="absolute top-1 right-1 z-10">{menu}</div>
      <DragHandle {...sortable.getHandleProps(sortableKey)} className="absolute bottom-1 right-1 z-10 opacity-0 group-hover/item:opacity-100" title="Glisser" />
    </motion.div>
  );
}
