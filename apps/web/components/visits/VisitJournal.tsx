"use client";

import { useEffect, useRef, useState } from "react";
import { useSortableGrid } from "@/hooks/useSortableGrid";
import { BentoGrid } from "@/components/visits/bento/BentoGrid";
import { TileSettingsModal } from "@/components/visits/bento/TileSettingsModal";
import { BlockTypeModal } from "@/components/visits/BlockTypeModal";
import { VoiceMemoRecorder, type CreatedAudioBlock } from "@/components/visits/VoiceMemoRecorder";
import { JournalAuthorProvider } from "@/components/visits/JournalAuthorContext";
import { DEFAULT_SPAN, isAutoHeight, isNoteType, tileKey, type TileWidth } from "@/lib/visits/bentoSpans";
import type { BentoTile } from "@/lib/visits/bentoTypes";

// ── Carnet de visite — grille modulaire façon Bento.me ──────────────────────
// Blocs texte : largeur choisie, hauteur automatique (paliers de grille),
// édition inline (desktop) ou pop-up central (mobile). Médias : 4 formats
// uniformes. Format via icônes au survol (desktop) / pop-up central (mobile).

interface VisitJournalProps {
  visitId: string;
  initialTiles: BentoTile[];
  authorName?: string | null;
  authorImage?: string | null;
}

const isEmptyHtml = (html: string) => !html.replace(/<[^>]*>/g, "").trim();

export function VisitJournal({ visitId, initialTiles, authorName, authorImage }: VisitJournalProps) {
  const [tiles, setTiles] = useState<BentoTile[]>(initialTiles);
  const tilesRef = useRef(tiles);
  tilesRef.current = tiles;

  const [settingsKey, setSettingsKey] = useState<string | null>(null);
  const [editingContentKey, setEditingContentKey] = useState<string | null>(null);
  const settingsTile = tiles.find((t) => tileKey(t) === settingsKey) ?? null;
  const [pickerOpen, setPickerOpen] = useState(false);
  const [voiceMemoOpen, setVoiceMemoOpen] = useState(false);

  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  const isFirstSync = useRef(true);
  useEffect(() => {
    setTiles(initialTiles);
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
    onDrop: () => persistLayout(tilesRef.current),
  });

  // ── Création ──────────────────────────────────────────────────────────────

  const addText = async () => {
    setPickerOpen(false);
    const res = await fetch(`/api/visits/${visitId}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "" }),
    }).catch(() => null);
    if (!res?.ok) return;
    const created = await res.json();
    const span = DEFAULT_SPAN.note;
    const tile: BentoTile = { type: "note", id: created.id, w: span.w, h: span.h, content: { type: "note", id: created.id, content: "" } };
    const next = [...tiles, tile];
    setTiles(next);
    persistLayout(next);
    // Édition immédiate : inline sur desktop, pop-up central sur mobile.
    if (isMobile) setSettingsKey(tileKey(tile));
    else setEditingContentKey(tileKey(tile));
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

  const addHighlight = async () => {
    setPickerOpen(false);
    const res = await fetch(`/api/visits/${visitId}/highlight`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }).catch(() => null);
    if (!res?.ok) return;
    const created = await res.json();
    const span = DEFAULT_SPAN.highlight;
    const tile: BentoTile = {
      type: "highlight", id: created.id, w: span.w, h: span.h,
      content: { type: "highlight", id: created.id, title: created.title, rating: created.rating, note: created.note },
    };
    const next = [...tiles, tile];
    setTiles(next);
    persistLayout(next);
    // Édition immédiate via le pop-up (pas d'édition inline pour ce module).
    setSettingsKey(tileKey(tile));
  };

  const addChecklist = async () => {
    setPickerOpen(false);
    const res = await fetch(`/api/visits/${visitId}/checklist`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }).catch(() => null);
    if (!res?.ok) return;
    const created = await res.json();
    const span = DEFAULT_SPAN.checklist;
    const tile: BentoTile = {
      type: "checklist", id: created.id, w: span.w, h: span.h,
      content: { type: "checklist", id: created.id, title: created.title ?? null, items: [] },
    };
    const next = [...tiles, tile];
    setTiles(next);
    persistLayout(next);
    setSettingsKey(tileKey(tile));
  };

  // ── Suppression ───────────────────────────────────────────────────────────

  const DELETE_ROUTE: Record<Exclude<BentoTile["type"], "image">, string> = {
    note: "notes",
    audio: "audio",
    embed: "embeds",
    map: "map",
    cartel: "cartel",
    palette: "palette",
    ticket: "ticket",
    sketch: "sketch",
    highlight: "highlight",
    checklist: "checklist",
    timeline: "timeline",
  };

  const handleDelete = async (tile: BentoTile) => {
    const next = tiles.filter((t) => tileKey(t) !== tileKey(tile));
    setTiles(next);
    persistLayout(next);
    if (settingsKey === tileKey(tile)) setSettingsKey(null);
    if (editingContentKey === tileKey(tile)) setEditingContentKey(null);
    if (tile.type === "image") {
      await fetch(`/api/visits/${visitId}/inspirations/${tile.id}`, { method: "DELETE" }).catch(() => {});
    } else {
      await fetch(`/api/visits/${visitId}/${DELETE_ROUTE[tile.type]}/${tile.id}`, { method: "DELETE" }).catch(() => {});
    }
  };

  // ── Format & auto-hauteur ──────────────────────────────────────────────────

  const setFormat = (tile: BentoTile, w: TileWidth, h: 1 | 2) => {
    const next = tilesRef.current.map((t) =>
      // Auto-hauteur (texte/checklist/frise) : seule la largeur est réglable,
      // la hauteur reste automatique.
      tileKey(t) === tileKey(tile) ? { ...t, w, h: isAutoHeight(t.type) ? t.h : h } : t
    );
    setTiles(next);
    persistLayout(next);
  };

  const setAutoRows = (tile: BentoTile, rows: number) => {
    if (tile.h === rows) return;
    const next = tilesRef.current.map((t) => (tileKey(t) === tileKey(tile) ? { ...t, h: rows } : t));
    setTiles(next);
    persistLayout(next);
  };

  // ── Édition de texte ───────────────────────────────────────────────────────

  const patchTileContent = (id: string, patch: Record<string, unknown>) => {
    setTiles((prev) => prev.map((t) => (t.id === id ? ({ ...t, content: { ...t.content, ...patch } } as BentoTile) : t)));
  };

  const persistText = (tile: BentoTile, value: string): Promise<void> => {
    if (!isNoteType(tile.type)) return Promise.resolve();
    patchTileContent(tile.id, { content: value });
    return fetch(`/api/visits/${visitId}/notes/${tile.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: value }),
    }).then((r) => { if (!r.ok) throw new Error("save failed"); });
  };

  const saveText = (tile: BentoTile, value: string) => {
    if (isEmptyHtml(value)) { handleDelete(tile); return; }
    persistText(tile, value).catch(() => {});
  };

  const persistAudioTranscript = async (audioId: string, transcript: string) => {
    patchTileContent(audioId, { transcript });
    const res = await fetch(`/api/visits/${visitId}/audio/${audioId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ transcript }) }).catch(() => null);
    if (!res?.ok) throw new Error("save failed");
  };

  const saveImage = (id: string, title: string, author: string, year: string) => {
    const trimmedTitle = title.trim() || "Sans titre";
    const y = year ? parseInt(year, 10) : null;
    patchTileContent(id, { title: trimmedTitle, author: author.trim() || null, year: y });
    const body: Record<string, unknown> = { title: trimmedTitle };
    if (author.trim()) body.author = author.trim();
    if (y) body.year = y;
    fetch(`/api/inspirations/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => {});
  };

  const saveEmbed = (id: string, title: string, description: string) => {
    patchTileContent(id, { title: title.trim() || null, description: description.trim() || null });
    fetch(`/api/visits/${visitId}/embeds/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: title.trim() || null, description: description.trim() || null }) }).catch(() => {});
  };

  const saveMap = (id: string, locationName: string, latitude: number, longitude: number) => {
    patchTileContent(id, { locationName, latitude, longitude });
    fetch(`/api/visits/${visitId}/map/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ locationName, latitude, longitude }) }).catch(() => {});
  };

  const saveHighlight = (id: string, title: string, rating: number, note: string) => {
    patchTileContent(id, { title, rating, note: note.trim() || null });
    fetch(`/api/visits/${visitId}/highlight/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, rating, note: note.trim() || null }) }).catch(() => {});
  };

  const saveChecklist = (id: string, title: string, items: { id: string; text: string; done: boolean }[]) => {
    patchTileContent(id, { title: title.trim() || null, items });
    fetch(`/api/visits/${visitId}/checklist/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: title.trim() || null, items }) }).catch(() => {});
  };

  const toggleChecklistItem = (checklistId: string, itemId: string) => {
    const tile = tilesRef.current.find((t) => t.id === checklistId && t.content.type === "checklist");
    if (!tile || tile.content.type !== "checklist") return;
    const items = tile.content.items.map((it) => (it.id === itemId ? { ...it, done: !it.done } : it));
    patchTileContent(checklistId, { items });
    fetch(`/api/visits/${visitId}/checklist/${checklistId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items }) }).catch(() => {});
  };

  return (
    <JournalAuthorProvider value={{ name: authorName ?? null, image: authorImage ?? null }}>
      <BentoGrid
        tiles={tiles}
        editable
        sortable={sortable}
        isMobile={isMobile}
        selectedKey={settingsKey}
        editingContentKey={editingContentKey}
        onSetFormat={setFormat}
        onOpenSettings={(tile) => setSettingsKey(tileKey(tile))}
        onStartInlineEdit={(tile) => setEditingContentKey(tileKey(tile))}
        onEndInlineEdit={() => setEditingContentKey(null)}
        onSaveText={saveText}
        onPersistText={persistText}
        onPersistAudioTranscript={persistAudioTranscript}
        onToggleChecklistItem={toggleChecklistItem}
        onAutoRows={setAutoRows}
        onAddClick={() => setPickerOpen(true)}
      />

      {pickerOpen && (
        <BlockTypeModal
          onClose={() => setPickerOpen(false)}
          onSelectText={addText}
          onSelectAudio={() => { setPickerOpen(false); setVoiceMemoOpen(true); }}
          onSelectEmbed={handleSelectEmbed}
          onSelectMap={handleSelectMap}
          onSelectHighlight={addHighlight}
          onSelectChecklist={addChecklist}
        />
      )}

      <VoiceMemoRecorder
        uploadUrl={`/api/visits/${visitId}/audio`}
        offlineQueue={{ visitId }}
        open={voiceMemoOpen}
        onClose={() => setVoiceMemoOpen(false)}
        onCreated={handleAudioCreated}
      />

      <TileSettingsModal
        tile={settingsTile}
        isMobile={isMobile}
        onClose={() => setSettingsKey(null)}
        onSetFormat={setFormat}
        onDelete={handleDelete}
        onSaveText={saveText}
        onPersistText={persistText}
        onSaveImage={saveImage}
        onSaveEmbed={saveEmbed}
        onSaveMap={saveMap}
        onSaveHighlight={saveHighlight}
        onSaveChecklist={saveChecklist}
      />
    </JournalAuthorProvider>
  );
}
