"use client";

import { useEffect, useRef, useState } from "react";
import { useSortableGrid } from "@/hooks/useSortableGrid";
import { BentoGrid } from "@/components/visits/bento/BentoGrid";
import { EditDrawer } from "@/components/visits/bento/EditDrawer";
import { BlockTypeModal } from "@/components/visits/BlockTypeModal";
import { VoiceMemoRecorder, type CreatedAudioBlock } from "@/components/visits/VoiceMemoRecorder";
import { JournalAuthorProvider } from "@/components/visits/JournalAuthorContext";
import { DEFAULT_SPAN, nextSpan, tileKey } from "@/lib/visits/bentoSpans";
import type { BentoTile, JournalTileType } from "@/lib/visits/bentoTypes";

// ── Carnet de visite — grille modulaire façon Bento.me (2026-07-15) ─────────
// Remplace l'ancien système de blocs empilés + colonnes par une grille dense
// à tuiles de format fixe (1x1/2x1/1x2/2x2), drag & drop, poignée de
// redimensionnement (cycle les formats), édition via panneau latéral
// (EditDrawer). Voir apps/web/lib/visits/bentoSpans.ts et bentoTypes.ts.

interface VisitJournalProps {
  visitId: string;
  initialTiles: BentoTile[];
  /** Auteur du carnet (photo affichée sur les blocs mémo vocal, alignée sur le design des planches). */
  authorName?: string | null;
  authorImage?: string | null;
}

const TEXT_ROUTE: Record<"note" | "title" | "quote", string> = { note: "notes", title: "titles", quote: "quotes" };
const isEmptyHtml = (html: string) => !html.replace(/<[^>]*>/g, "").trim();

export function VisitJournal({ visitId, initialTiles, authorName, authorImage }: VisitJournalProps) {
  const [tiles, setTiles] = useState<BentoTile[]>(initialTiles);
  const [editingTile, setEditingTile] = useState<BentoTile | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [voiceMemoOpen, setVoiceMemoOpen] = useState(false);

  // Resynchronise si le serveur renvoie de nouvelles données (ex. capture
  // photo/mémo depuis VisitCaptureFab, qui fait un router.refresh() après
  // upload plutôt que de manipuler l'état local de ce composant).
  const isFirstSync = useRef(true);
  useEffect(() => {
    setTiles(initialTiles);
    // Filet de sécurité de buildBentoLayout : un bloc créé hors de ce
    // composant (FAB, rejeu offline) atterrit en fin de grille avec son
    // format par défaut, mais SANS entrée dans Visit.journalLayout tant que
    // personne ne l'a persisté — on l'adopte silencieusement ici pour que le
    // filet n'ait plus besoin de s'activer au prochain chargement.
    if (isFirstSync.current) { isFirstSync.current = false; return; }
    persistLayout(initialTiles);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTiles]);

  const persistLayout = (list: BentoTile[]) => {
    fetch(`/api/visits/${visitId}/layout`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ layout: list.map((t) => ({ type: t.type, id: t.id, w: t.w, h: t.h })) }),
    }).catch(() => {});
  };

  const sortable = useSortableGrid({
    onReorder: (draggedKey, targetKey) => {
      setTiles((prev) => {
        const from = prev.findIndex((t) => tileKey(t) === draggedKey);
        const to = prev.findIndex((t) => tileKey(t) === targetKey);
        if (from === -1 || to === -1) return prev;
        const next = [...prev];
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        return next;
      });
    },
    onDrop: () => {
      // `tiles` a déjà été réordonné en direct par onReorder pendant le
      // drag — il ne reste qu'à persister l'état final.
      persistLayout(tiles);
    },
  });

  // ── Création ──────────────────────────────────────────────────────────────

  const addTextTile = async (type: "title" | "note" | "quote") => {
    setPickerOpen(false);
    const res = await fetch(`/api/visits/${visitId}/${TEXT_ROUTE[type]}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "" }),
    }).catch(() => null);
    if (!res?.ok) return;
    const created = await res.json();
    const span = DEFAULT_SPAN[type];
    const tile: BentoTile = { type, id: created.id, w: span.w, h: span.h, content: { type, id: created.id, content: "" } };
    const next = [...tiles, tile];
    setTiles(next);
    persistLayout(next);
    setEditingTile(tile);
  };

  const handleAudioCreated = (created: CreatedAudioBlock) => {
    setVoiceMemoOpen(false);
    const span = DEFAULT_SPAN.audio;
    const tile: BentoTile = {
      type: "audio",
      id: created.id,
      w: span.w,
      h: span.h,
      content: { type: "audio", id: created.id, storageKey: created.storageKey, durationSec: created.durationSec, transcript: created.transcript ?? null },
    };
    const next = [...tiles, tile];
    setTiles(next);
    persistLayout(next);
  };

  const handleSelectEmbed = async (kind: "LINK" | "YOUTUBE", url: string) => {
    setPickerOpen(false);
    const res = await fetch(`/api/visits/${visitId}/embeds`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, url }),
    }).catch(() => null);
    if (!res?.ok) return;
    const created = await res.json();
    const span = DEFAULT_SPAN.embed;
    const tile: BentoTile = {
      type: "embed",
      id: created.id,
      w: span.w,
      h: span.h,
      content: { type: "embed", id: created.id, kind: created.kind, url: created.url, title: created.title, description: created.description, image: created.image, siteName: created.siteName },
    };
    const next = [...tiles, tile];
    setTiles(next);
    persistLayout(next);
  };

  const handleSelectMap = async (locationName: string, latitude: number, longitude: number) => {
    setPickerOpen(false);
    const res = await fetch(`/api/visits/${visitId}/map`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locationName, latitude, longitude }),
    }).catch(() => null);
    if (!res?.ok) return;
    const created = await res.json();
    const span = DEFAULT_SPAN.map;
    const tile: BentoTile = {
      type: "map",
      id: created.id,
      w: span.w,
      h: span.h,
      content: { type: "map", id: created.id, locationName: created.locationName, latitude: created.latitude, longitude: created.longitude },
    };
    const next = [...tiles, tile];
    setTiles(next);
    persistLayout(next);
  };

  // ── Suppression ───────────────────────────────────────────────────────────

  const DELETE_ROUTE: Record<Exclude<JournalTileType, "image">, string> = {
    note: "notes",
    title: "titles",
    quote: "quotes",
    audio: "audio",
    embed: "embeds",
    map: "map",
  };

  const handleDelete = async (tile: BentoTile) => {
    const next = tiles.filter((t) => tileKey(t) !== tileKey(tile));
    setTiles(next);
    persistLayout(next);
    if (editingTile && tileKey(editingTile) === tileKey(tile)) setEditingTile(null);
    if (tile.type === "image") {
      await fetch(`/api/visits/${visitId}/inspirations/${tile.id}`, { method: "DELETE" }).catch(() => {});
    } else {
      await fetch(`/api/visits/${visitId}/${DELETE_ROUTE[tile.type]}/${tile.id}`, { method: "DELETE" }).catch(() => {});
    }
  };

  // ── Redimensionnement ────────────────────────────────────────────────────

  const handleResize = (tile: BentoTile) => {
    const span = nextSpan(tile.type, { w: tile.w, h: tile.h });
    const next = tiles.map((t) => (tileKey(t) === tileKey(tile) ? { ...t, w: span.w, h: span.h } : t));
    setTiles(next);
    persistLayout(next);
  };

  // ── Édition de texte (drawer) ────────────────────────────────────────────

  const patchTileContent = (type: JournalTileType, id: string, patch: Record<string, unknown>) => {
    setTiles((prev) => prev.map((t) => (t.type === type && t.id === id ? ({ ...t, content: { ...t.content, ...patch } } as BentoTile) : t)));
  };

  const persistNote = async (id: string, html: string) => {
    patchTileContent("note", id, { content: html });
    await fetch(`/api/visits/${visitId}/notes/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: html }) }).catch(() => { throw new Error("save failed"); });
  };
  const saveNote = (id: string, html: string) => {
    if (isEmptyHtml(html)) {
      const tile = tiles.find((t) => t.type === "note" && t.id === id);
      if (tile) handleDelete(tile);
      return;
    }
    persistNote(id, html).catch(() => {});
  };

  const persistTitle = async (id: string, text: string) => {
    patchTileContent("title", id, { content: text });
    await fetch(`/api/visits/${visitId}/titles/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: text }) }).catch(() => { throw new Error("save failed"); });
  };
  const saveTitle = (id: string, text: string) => {
    if (!text.trim()) {
      const tile = tiles.find((t) => t.type === "title" && t.id === id);
      if (tile) handleDelete(tile);
      return;
    }
    persistTitle(id, text).catch(() => {});
  };

  const persistQuote = async (id: string, text: string) => {
    patchTileContent("quote", id, { content: text });
    await fetch(`/api/visits/${visitId}/quotes/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: text }) }).catch(() => { throw new Error("save failed"); });
  };
  const saveQuote = (id: string, text: string) => {
    if (!text.trim()) {
      const tile = tiles.find((t) => t.type === "quote" && t.id === id);
      if (tile) handleDelete(tile);
      return;
    }
    persistQuote(id, text).catch(() => {});
  };

  const persistAudioTranscript = async (audioId: string, transcript: string) => {
    patchTileContent("audio", audioId, { transcript });
    const res = await fetch(`/api/visits/${visitId}/audio/${audioId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ transcript }) }).catch(() => null);
    if (!res?.ok) throw new Error("save failed");
  };

  const saveImage = (id: string, title: string, author: string, year: string) => {
    const trimmedTitle = title.trim() || "Sans titre";
    const y = year ? parseInt(year, 10) : null;
    patchTileContent("image", id, { title: trimmedTitle, author: author.trim() || null, year: y });
    const body: Record<string, unknown> = { title: trimmedTitle };
    if (author.trim()) body.author = author.trim();
    if (y) body.year = y;
    fetch(`/api/inspirations/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => {});
  };

  const saveEmbed = (id: string, title: string, description: string) => {
    patchTileContent("embed", id, { title: title.trim() || null, description: description.trim() || null });
    fetch(`/api/visits/${visitId}/embeds/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: title.trim() || null, description: description.trim() || null }),
    }).catch(() => {});
  };

  const saveMap = (id: string, locationName: string, latitude: number, longitude: number) => {
    patchTileContent("map", id, { locationName, latitude, longitude });
    fetch(`/api/visits/${visitId}/map/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locationName, latitude, longitude }),
    }).catch(() => {});
  };

  return (
    <JournalAuthorProvider value={{ name: authorName ?? null, image: authorImage ?? null }}>
      <BentoGrid
        tiles={tiles}
        editable
        sortable={sortable}
        onOpenEdit={setEditingTile}
        onResize={handleResize}
        onDelete={handleDelete}
        onPersistAudioTranscript={persistAudioTranscript}
        onAddClick={() => setPickerOpen(true)}
      />

      {pickerOpen && (
        <BlockTypeModal
          onClose={() => setPickerOpen(false)}
          onSelectSimple={addTextTile}
          onSelectAudio={() => { setPickerOpen(false); setVoiceMemoOpen(true); }}
          onSelectEmbed={handleSelectEmbed}
          onSelectMap={handleSelectMap}
        />
      )}

      <VoiceMemoRecorder
        uploadUrl={`/api/visits/${visitId}/audio`}
        offlineQueue={{ visitId }}
        open={voiceMemoOpen}
        onClose={() => setVoiceMemoOpen(false)}
        onCreated={handleAudioCreated}
      />

      <EditDrawer
        tile={editingTile}
        onClose={() => setEditingTile(null)}
        onSaveNote={saveNote}
        onPersistNote={persistNote}
        onSaveTitle={saveTitle}
        onPersistTitle={persistTitle}
        onSaveQuote={saveQuote}
        onPersistQuote={persistQuote}
        onSaveImage={saveImage}
        onSaveEmbed={saveEmbed}
        onSaveMap={saveMap}
      />
    </JournalAuthorProvider>
  );
}
