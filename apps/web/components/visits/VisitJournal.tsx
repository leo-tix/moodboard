"use client";

import { useEffect, useRef, useState } from "react";
import { useSortableGrid } from "@/hooks/useSortableGrid";
import { BentoGrid } from "@/components/visits/bento/BentoGrid";
import { SectionNav } from "@/components/visits/bento/SectionNav";
import { TileSettingsModal, type CartelFormValues, type TicketFormValues } from "@/components/visits/bento/TileSettingsModal";
import { BlockTypeModal } from "@/components/visits/BlockTypeModal";
import { SketchPad } from "@/components/visits/bento/SketchPad";
import { VoiceMemoRecorder, type CreatedAudioBlock } from "@/components/visits/VoiceMemoRecorder";
import { useBackgroundMemo } from "@/components/visits/BackgroundMemoProvider";
import { JournalAuthorProvider } from "@/components/visits/JournalAuthorContext";
import { DEFAULT_SPAN, isAutoHeight, isFicheContent, isNoteType, tileKey, type TileWidth } from "@/lib/visits/bentoSpans";
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
  /** Infos de la visite — servent à pré-remplir certains modules (billet). */
  visitPlace?: string;
  visitExhibition?: string | null;
  visitDate?: string; // ISO
}

const isEmptyHtml = (html: string) => !html.replace(/<[^>]*>/g, "").trim();

export function VisitJournal({ visitId, initialTiles, authorName, authorImage, visitPlace, visitExhibition, visitDate }: VisitJournalProps) {
  const [tiles, setTiles] = useState<BentoTile[]>(initialTiles);
  const tilesRef = useRef(tiles);
  tilesRef.current = tiles;

  const [settingsKey, setSettingsKey] = useState<string | null>(null);
  const [editingContentKey, setEditingContentKey] = useState<string | null>(null);
  const settingsTile = tiles.find((t) => tileKey(t) === settingsKey) ?? null;
  const [pickerOpen, setPickerOpen] = useState(false);
  const [voiceMemoOpen, setVoiceMemoOpen] = useState(false);
  const bg = useBackgroundMemo();
  const [sketchPadOpen, setSketchPadOpen] = useState(false);
  const [sketchReplaceId, setSketchReplaceId] = useState<string | null>(null);
  const [sketchSaving, setSketchSaving] = useState(false);

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
    tilesRef.current = initialTiles;
    setTiles(initialTiles);
    if (isFirstSync.current) { isFirstSync.current = false; return; }
    persistLayout(initialTiles);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTiles]);

  const persistLayout = (list: BentoTile[]) => {
    fetch(`/api/visits/${visitId}/layout`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        layout: list.map((t) => ({
          type: t.type, id: t.id, w: t.w, h: t.h,
          ...(t.hideTitle ? { hideTitle: true } : {}),
          ...(t.hideImage ? { hideImage: true } : {}),
          ...(t.hideInfo ? { hideInfo: true } : {}),
          ...(t.hideParagraph ? { hideParagraph: true } : {}),
          ...(t.type === "separator" ? { label: t.content.type === "separator" ? t.content.label : (t.label ?? "") } : {}),
          ...(t.fitContain ? { fitContain: true } : {}),
        })),
      }),
    }).catch(() => {});
  };

  // `tilesRef` est la source de vérité SYNCHRONE du layout : chaque mutation de
  // disposition la met à jour AVANT le re-render React, pour que le drop, la
  // persistance et les mutations suivantes lisent toujours l'état final. Sans
  // ça, un drag/resize suivi de trop près par un autre (ou par le drop)
  // repartait de l'état d'avant → réordonnancement/redimensionnement perdus par
  // intermittence (retour utilisateur 2026-07-19).
  const commitLayout = (next: BentoTile[], persist = true) => {
    tilesRef.current = next;
    setTiles(next);
    if (persist) persistLayout(next);
  };

  const sortable = useSortableGrid({
    onReorder: (draggedKey, targetKey) => {
      const prev = tilesRef.current;
      const from = prev.findIndex((t) => tileKey(t) === draggedKey);
      const to = prev.findIndex((t) => tileKey(t) === targetKey);
      if (from === -1 || to === -1 || from === to) return;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      // Réordonnancement en direct sans persister chaque étape — onDrop persiste
      // l'ordre FINAL une fois (tilesRef est déjà à jour de façon synchrone).
      commitLayout(next, false);
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
    const next = [...tilesRef.current, tile];
    commitLayout(next);
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
      content: { type: "audio", id: created.id, storageKey: created.storageKey, durationSec: created.durationSec, transcript: created.transcript ?? null, wordTimings: created.wordTimings ?? null },
    };
    const next = [...tilesRef.current, tile];
    commitLayout(next);
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
    const next = [...tilesRef.current, tile];
    commitLayout(next);
  };

  const handleSelectArtist = async (payload: { title?: string; name?: string }) => {
    const res = await fetch(`/api/visits/${visitId}/artist`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => null);
    setPickerOpen(false);
    if (!res?.ok) {
      alert("Page introuvable sur Wikipédia. Vérifie l'orthographe.");
      return;
    }
    const c = await res.json();
    const span = DEFAULT_SPAN.embed;
    const tile: BentoTile = {
      type: "embed", id: c.id, w: span.w, h: span.h,
      content: { type: "embed", id: c.id, kind: c.kind, url: c.url, title: c.title, description: c.description, image: c.image, siteName: c.siteName, data: c.data ?? null },
    };
    const next = [...tilesRef.current, tile];
    commitLayout(next);
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
    const next = [...tilesRef.current, tile];
    commitLayout(next);
  };

  // Séparateur : pas de table dédiée — le texte vit dans le layout (tile.label).
  // Id généré côté client (unique dans le layout, pas de ligne en base).
  const addSeparator = () => {
    setPickerOpen(false);
    const id = crypto.randomUUID();
    const span = DEFAULT_SPAN.separator;
    const tile: BentoTile = {
      type: "separator", id, w: span.w, h: span.h, label: "",
      content: { type: "separator", id, label: "" },
    };
    commitLayout([...tilesRef.current, tile]);
    setSettingsKey(tileKey(tile)); // ouvre aussitôt pour saisir le titre
  };

  const saveSeparator = (id: string, label: string) => {
    const next = tilesRef.current.map((t) =>
      t.id === id && t.type === "separator"
        ? { ...t, label, content: { ...t.content, label } as BentoTile["content"] }
        : t
    );
    commitLayout(next);
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
    const next = [...tilesRef.current, tile];
    commitLayout(next);
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
    const next = [...tilesRef.current, tile];
    commitLayout(next);
    setSettingsKey(tileKey(tile));
  };

  const addTimeline = async () => {
    setPickerOpen(false);
    const res = await fetch(`/api/visits/${visitId}/timeline`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }).catch(() => null);
    if (!res?.ok) return;
    const created = await res.json();
    const span = DEFAULT_SPAN.timeline;
    const tile: BentoTile = {
      type: "timeline", id: created.id, w: span.w, h: span.h,
      content: { type: "timeline", id: created.id, title: created.title ?? null, events: [] },
    };
    const next = [...tilesRef.current, tile];
    commitLayout(next);
    setSettingsKey(tileKey(tile));
  };

  const addCartel = async () => {
    setPickerOpen(false);
    const res = await fetch(`/api/visits/${visitId}/cartel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }).catch(() => null);
    if (!res?.ok) return;
    const c = await res.json();
    const span = DEFAULT_SPAN.cartel;
    const tile: BentoTile = {
      type: "cartel", id: c.id, w: span.w, h: span.h,
      content: { type: "cartel", id: c.id, artworkTitle: c.artworkTitle, artist: c.artist, dateText: c.dateText, medium: c.medium, dimensions: c.dimensions, room: c.room, notes: c.notes, storageKey: c.storageKey, thumbnailKey: c.thumbnailKey, width: c.width, height: c.height },
    };
    const next = [...tilesRef.current, tile];
    commitLayout(next);
    setSettingsKey(tileKey(tile));
  };

  const addTicket = async () => {
    setPickerOpen(false);
    // Pré-remplissage depuis la visite : nom de l'expo (ou lieu à défaut), lieu,
    // et date formatée — l'utilisateur n'a plus qu'à compléter prix/tarif.
    const prefill = {
      eventName: (visitExhibition || visitPlace || "").trim(),
      place: (visitPlace ?? "").trim() || undefined,
      dateText: visitDate
        ? new Date(visitDate).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })
        : undefined,
    };
    const res = await fetch(`/api/visits/${visitId}/ticket`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(prefill),
    }).catch(() => null);
    if (!res?.ok) return;
    const c = await res.json();
    const span = DEFAULT_SPAN.ticket;
    const tile: BentoTile = {
      type: "ticket", id: c.id, w: span.w, h: span.h,
      content: { type: "ticket", id: c.id, eventName: c.eventName, place: c.place, dateText: c.dateText, price: c.price, category: c.category, storageKey: c.storageKey, thumbnailKey: c.thumbnailKey, width: c.width, height: c.height },
    };
    const next = [...tilesRef.current, tile];
    commitLayout(next);
    setSettingsKey(tileKey(tile));
  };

  const addPalette = async () => {
    setPickerOpen(false);
    const res = await fetch(`/api/visits/${visitId}/palette`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }).catch(() => null);
    if (!res?.ok) return;
    const c = await res.json();
    const span = DEFAULT_SPAN.palette;
    const tile: BentoTile = {
      type: "palette", id: c.id, w: span.w, h: span.h,
      content: { type: "palette", id: c.id, title: c.title ?? null, colors: [], sourceKey: c.sourceKey ?? null },
    };
    const next = [...tilesRef.current, tile];
    commitLayout(next);
    setSettingsKey(tileKey(tile));
  };

  const openSketchPad = () => { setPickerOpen(false); setSketchReplaceId(null); setSketchPadOpen(true); };

  const handleSketchSave = async (blob: Blob) => {
    setSketchSaving(true);
    const fd = new FormData();
    fd.append("file", new File([blob], "croquis.png", { type: "image/png" }));
    const url = sketchReplaceId
      ? `/api/visits/${visitId}/sketch/${sketchReplaceId}`
      : `/api/visits/${visitId}/sketch`;
    const res = await fetch(url, { method: "POST", body: fd }).catch(() => null);
    setSketchSaving(false);
    if (!res?.ok) { alert("Échec de l'enregistrement du croquis."); return; }
    const c = await res.json();
    if (sketchReplaceId) {
      patchTileContent(sketchReplaceId, { storageKey: c.storageKey, thumbnailKey: c.thumbnailKey, width: c.width, height: c.height });
    } else {
      const span = DEFAULT_SPAN.sketch;
      const tile: BentoTile = {
        type: "sketch", id: c.id, w: span.w, h: span.h,
        content: { type: "sketch", id: c.id, storageKey: c.storageKey, thumbnailKey: c.thumbnailKey, width: c.width, height: c.height },
      };
      const next = [...tiles, tile];
      setTiles(next);
      persistLayout(next);
    }
    setSketchPadOpen(false);
    setSketchReplaceId(null);
  };

  const redrawSketch = (id: string) => { setSettingsKey(null); setSketchReplaceId(id); setSketchPadOpen(true); };

  // ── Suppression ───────────────────────────────────────────────────────────

  const DELETE_ROUTE: Record<Exclude<BentoTile["type"], "image" | "separator">, string> = {
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
    const next = tilesRef.current.filter((t) => tileKey(t) !== tileKey(tile));
    commitLayout(next);
    if (settingsKey === tileKey(tile)) setSettingsKey(null);
    if (editingContentKey === tileKey(tile)) setEditingContentKey(null);
    if (tile.type === "image") {
      await fetch(`/api/visits/${visitId}/inspirations/${tile.id}`, { method: "DELETE" }).catch(() => {});
    } else if (tile.type !== "separator") {
      // Le séparateur n'a pas de table : sa suppression se limite au layout.
      await fetch(`/api/visits/${visitId}/${DELETE_ROUTE[tile.type]}/${tile.id}`, { method: "DELETE" }).catch(() => {});
    }
  };

  // ── Format & auto-hauteur ──────────────────────────────────────────────────

  const setFormat = (tile: BentoTile, w: TileWidth, h: 1 | 2) => {
    const next = tilesRef.current.map((t) =>
      // Auto-hauteur (texte/checklist/frise) : seule la largeur est réglable,
      // la hauteur reste automatique.
      tileKey(t) === tileKey(tile) ? { ...t, w, h: isAutoHeight(t.type) || isFicheContent(t.content) ? t.h : h } : t
    );
    commitLayout(next);
  };

  const setAutoRows = (tile: BentoTile, rows: number) => {
    if (tile.h === rows) return;
    const next = tilesRef.current.map((t) => (tileKey(t) === tileKey(tile) ? { ...t, h: rows } : t));
    commitLayout(next);
  };

  // ── Édition de texte ───────────────────────────────────────────────────────

  // Mise à jour de CONTENU (pas de layout) — on garde tilesRef synchrone quand
  // même pour qu'une mutation de disposition juste après lise le contenu à jour.
  const patchTileContent = (id: string, patch: Record<string, unknown>) => {
    const next = tilesRef.current.map((t) => (t.id === id ? ({ ...t, content: { ...t.content, ...patch } } as BentoTile) : t));
    tilesRef.current = next;
    setTiles(next);
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
    // L'édition manuelle invalide l'alignement mot-à-mot → on efface aussi les
    // timings localement (le serveur fait de même, voir la route PATCH audio).
    patchTileContent(audioId, { transcript, wordTimings: null });
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

  // Affichage du cartel (titre/auteur/année) sur la tuile image — flag porté par
  // le layout (par tuile, pas par image partagée).
  const setImageHideTitle = (id: string, hide: boolean) => {
    const next = tilesRef.current.map((t) => (t.id === id && t.type === "image" ? { ...t, hideTitle: hide } : t));
    commitLayout(next);
  };

  // Ratio d'origine (contain) — image ou croquis.
  const setFitContain = (id: string, fit: boolean) => {
    const next = tilesRef.current.map((t) => (t.id === id ? { ...t, fitContain: fit } : t));
    commitLayout(next);
  };

  // Fiche wiki : toggles d'affichage (portrait / infobox / résumé) portés par le
  // layout de la tuile.
  const setFicheFlags = (id: string, patch: { hideImage?: boolean; hideInfo?: boolean; hideParagraph?: boolean }) => {
    const next = tilesRef.current.map((t) => (t.id === id ? { ...t, ...patch } : t));
    commitLayout(next);
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

  const saveTimeline = (id: string, title: string, events: { id: string; dateText: string; label: string; description?: string }[]) => {
    patchTileContent(id, { title: title.trim() || null, events });
    fetch(`/api/visits/${visitId}/timeline/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: title.trim() || null, events }) }).catch(() => {});
  };

  const saveCartel = (id: string, v: CartelFormValues) => {
    const patch = {
      artworkTitle: v.artworkTitle,
      artist: v.artist.trim() || null,
      dateText: v.dateText.trim() || null,
      medium: v.medium.trim() || null,
      dimensions: v.dimensions.trim() || null,
      room: v.room.trim() || null,
      notes: v.notes.trim() || null,
    };
    patchTileContent(id, patch);
    fetch(`/api/visits/${visitId}/cartel/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) }).catch(() => {});
  };

  const saveTicket =(id: string, v: TicketFormValues) => {
    const patch = {
      eventName: v.eventName,
      place: v.place.trim() || null,
      dateText: v.dateText.trim() || null,
      price: v.price.trim() || null,
      category: v.category.trim() || null,
    };
    patchTileContent(id, patch);
    fetch(`/api/visits/${visitId}/ticket/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) }).catch(() => {});
  };

  const uploadTicketPhoto = async (id: string, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`/api/visits/${visitId}/ticket/${id}/photo`, { method: "POST", body: fd }).catch(() => null);
    if (!res?.ok) return;
    const updated = await res.json();
    patchTileContent(id, { storageKey: updated.storageKey, thumbnailKey: updated.thumbnailKey, width: updated.width, height: updated.height });
  };

  const savePalette = (id: string, title: string, colors: string[]) => {
    patchTileContent(id, { title: title.trim() || null, colors });
    fetch(`/api/visits/${visitId}/palette/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: title.trim() || null, colors }) }).catch(() => {});
  };

  const uploadPaletteSource = async (id: string, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`/api/visits/${visitId}/palette/${id}/photo`, { method: "POST", body: fd }).catch(() => null);
    if (!res?.ok) return;
    const updated = await res.json();
    patchTileContent(id, { sourceKey: updated.sourceKey });
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
      <SectionNav tiles={tiles} />
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
          onSelectTimeline={addTimeline}
          onSelectCartel={addCartel}
          onSelectTicket={addTicket}
          onSelectPalette={addPalette}
          onSelectArtist={handleSelectArtist}
          onSelectSketch={openSketchPad}
          onSelectSeparator={addSeparator}
        />
      )}

      <VoiceMemoRecorder
        // Même traitement de fond que le FAB (via le provider de la page) : la
        // feuille se ferme dès « Terminer », la tuile apparaît puis se transcrit.
        onRecorded={bg?.processMemo}
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
        onSetImageHideTitle={setImageHideTitle}
        onSetFitContain={setFitContain}
        onSetFicheFlags={setFicheFlags}
        onSaveEmbed={saveEmbed}
        onSaveMap={saveMap}
        onSaveHighlight={saveHighlight}
        onSaveChecklist={saveChecklist}
        onSaveTimeline={saveTimeline}
        onSaveCartel={saveCartel}
        onSaveTicket={saveTicket}
        onUploadTicketPhoto={uploadTicketPhoto}
        onSavePalette={savePalette}
        onUploadPaletteSource={uploadPaletteSource}
        onRedrawSketch={redrawSketch}
        onSaveSeparator={saveSeparator}
      />

      <SketchPad
        open={sketchPadOpen}
        saving={sketchSaving}
        onClose={() => { setSketchPadOpen(false); setSketchReplaceId(null); }}
        onSave={handleSketchSave}
      />
    </JournalAuthorProvider>
  );
}
