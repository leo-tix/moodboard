"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X, Trash2, Star, Plus, CheckCircle2, Circle, ScanText, ImagePlus, Loader2 } from "lucide-react";
import { NoteEditor } from "@/components/visits/NoteEditor";
import { PlaceAutocomplete, type PlaceGeo } from "@/components/visits/PlaceAutocomplete";
import { FormatPicker } from "@/components/visits/bento/FormatPicker";
import { isNoteType, type TileWidth } from "@/lib/visits/bentoSpans";
import { getThumbnailUrl } from "@/lib/storage/urls";
import { runCartelOcr, type CartelFields } from "@/lib/visits/cartelOcr";
import type { BentoTile, ChecklistItem, TimelineEvent } from "@/lib/visits/bentoTypes";

// Champs éditables d'un cartel (miroir des colonnes texte de VisitCartel).
export interface CartelFormValues {
  artworkTitle: string;
  artist: string;
  dateText: string;
  medium: string;
  dimensions: string;
  room: string;
  notes: string;
}

// Champs éditables d'un billet (miroir des colonnes texte de VisitTicket).
export interface TicketFormValues {
  eventName: string;
  place: string;
  dateText: string;
  price: string;
  category: string;
}

interface TileSettingsModalProps {
  tile: BentoTile | null;
  isMobile: boolean;
  onClose: () => void;
  onSetFormat: (tile: BentoTile, w: TileWidth, h: 1 | 2) => void;
  onDelete: (tile: BentoTile) => void;
  onSaveText: (tile: BentoTile, value: string) => void;
  onPersistText: (tile: BentoTile, value: string) => Promise<void>;
  onSaveImage: (id: string, title: string, author: string, year: string) => void;
  onSaveEmbed: (id: string, title: string, description: string) => void;
  onSaveMap: (id: string, locationName: string, latitude: number, longitude: number) => void;
  onSaveHighlight: (id: string, title: string, rating: number, note: string) => void;
  onSaveChecklist: (id: string, title: string, items: ChecklistItem[]) => void;
  onSaveTimeline: (id: string, title: string, events: TimelineEvent[]) => void;
  onSaveCartel: (id: string, values: CartelFormValues) => void;
  onUploadCartelPhoto: (id: string, file: File) => Promise<void>;
  onSaveTicket: (id: string, values: TicketFormValues) => void;
  onUploadTicketPhoto: (id: string, file: File) => Promise<void>;
}

// Pop-up CENTRAL de réglages d'une tuile (demande utilisateur 2026-07-18 :
// "la sélection du format doit se faire via une pop-up centrale"). Contient le
// format, les champs propres au type, et la suppression. L'édition du texte se
// fait ici UNIQUEMENT sur mobile (sur desktop elle est inline dans la tuile).
export function TileSettingsModal({
  tile,
  isMobile,
  onClose,
  onSetFormat,
  onDelete,
  onSaveText,
  onPersistText,
  onSaveImage,
  onSaveEmbed,
  onSaveMap,
  onSaveHighlight,
  onSaveChecklist,
  onSaveTimeline,
  onSaveCartel,
  onUploadCartelPhoto,
  onSaveTicket,
  onUploadTicketPhoto,
}: TileSettingsModalProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!tile) return;
    setConfirmDelete(false);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [tile, onClose]);

  if (typeof document === "undefined") return null;

  const editTextHere = tile ? isNoteType(tile.type) && isMobile : false;

  return createPortal(
    <AnimatePresence>
      {tile && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[80]"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}
            className="fixed z-[81] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100vw-2rem)] max-w-sm bg-[var(--bg-elevated)] border border-[var(--border-default)] rounded-2xl shadow-2xl flex flex-col overflow-hidden"
            style={{ maxHeight: "min(85vh, 640px)" }}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-subtle)] flex-shrink-0">
              <p className="text-sm font-medium text-[var(--text-primary)]">{DRAWER_TITLES[tile.type]}</p>
              <button onClick={onClose} className="w-8 h-8 flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors" aria-label="Fermer">
                <X size={16} strokeWidth={2} />
              </button>
            </div>

            <div className="p-4 overflow-y-auto flex-1 space-y-5">
              <FormatPicker type={tile.type} w={tile.w} h={tile.h} onChange={(w, h) => onSetFormat(tile, w, h)} />

              {editTextHere && tile.content.type === "note" && (
                <NoteEditor
                  key={tile.id}
                  content={tile.content.content}
                  editable
                  showToolbar
                  onBlurSave={(html) => onSaveText(tile, html)}
                  onAutoSave={(html) => onPersistText(tile, html)}
                  placeholder="Écris… (titre, paragraphe, citation via la barre)"
                />
              )}

              {tile.content.type === "image" && (
                <ImageForm key={tile.id} title={tile.content.title} author={tile.content.author ?? ""} year={tile.content.year ?? null} onSave={(t, a, y) => onSaveImage(tile.id, t, a, y)} />
              )}
              {tile.content.type === "embed" && tile.content.kind === "LINK" && (
                <EmbedForm key={tile.id} title={tile.content.title ?? ""} description={tile.content.description ?? ""} onSave={(t, d) => onSaveEmbed(tile.id, t, d)} />
              )}
              {tile.content.type === "embed" && tile.content.kind === "YOUTUBE" && (
                <p className="text-xs text-[var(--text-tertiary)]">Vidéo YouTube — supprime et réajoute la tuile pour changer le lien.</p>
              )}
              {tile.content.type === "audio" && (
                <p className="text-xs text-[var(--text-tertiary)]">Mémo vocal — passe la tuile en format « Grand » pour voir et éditer la transcription.</p>
              )}
              {tile.content.type === "map" && (
                <MapForm key={tile.id} locationName={tile.content.locationName} latitude={tile.content.latitude} longitude={tile.content.longitude} onSave={(n, la, lo) => onSaveMap(tile.id, n, la, lo)} />
              )}
              {tile.content.type === "highlight" && (
                <HighlightForm key={tile.id} title={tile.content.title} rating={tile.content.rating} note={tile.content.note ?? ""} onSave={(t, r, n) => onSaveHighlight(tile.id, t, r, n)} />
              )}
              {tile.content.type === "checklist" && (
                <ChecklistForm key={tile.id} title={tile.content.title ?? ""} items={tile.content.items} onSave={(t, items) => onSaveChecklist(tile.id, t, items)} />
              )}
              {tile.content.type === "timeline" && (
                <TimelineForm key={tile.id} title={tile.content.title ?? ""} events={tile.content.events} onSave={(t, events) => onSaveTimeline(tile.id, t, events)} />
              )}
              {tile.content.type === "cartel" && (
                <CartelForm
                  key={tile.id}
                  content={tile.content}
                  onSave={(v) => onSaveCartel(tile.id, v)}
                  onUploadPhoto={(file) => onUploadCartelPhoto(tile.id, file)}
                />
              )}
              {tile.content.type === "ticket" && (
                <TicketForm
                  key={tile.id}
                  content={tile.content}
                  onSave={(v) => onSaveTicket(tile.id, v)}
                  onUploadPhoto={(file) => onUploadTicketPhoto(tile.id, file)}
                />
              )}
            </div>

            <div className="px-4 py-3 border-t border-[var(--border-subtle)] flex-shrink-0">
              {confirmDelete ? (
                <div className="flex items-center gap-2">
                  <button onClick={() => { onDelete(tile); onClose(); }} className="flex-1 px-3 py-2 text-xs rounded-lg bg-red-500/90 text-white hover:bg-red-500 transition-colors">
                    {tile.type === "image" ? "Retirer du carnet" : "Supprimer définitivement"}
                  </button>
                  <button onClick={() => setConfirmDelete(false)} className="px-3 py-2 text-xs rounded-lg text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors">Annuler</button>
                </div>
              ) : (
                <button onClick={() => setConfirmDelete(true)} className="flex items-center gap-2 px-3 py-2 text-xs rounded-lg text-red-400 hover:bg-[var(--bg-surface)] transition-colors">
                  <Trash2 size={13} strokeWidth={1.75} />
                  {tile.type === "image" ? "Retirer du carnet" : "Supprimer"}
                </button>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body
  );
}

const DRAWER_TITLES: Record<BentoTile["type"], string> = {
  image: "Image",
  note: "Texte",
  audio: "Mémo vocal",
  embed: "Lien",
  map: "Carte",
  cartel: "Cartel",
  palette: "Palette",
  ticket: "Billet",
  sketch: "Croquis",
  highlight: "Coup de cœur",
  checklist: "Checklist",
  timeline: "Frise",
};

function ImageForm({ title, author, year, onSave }: { title: string; author: string; year: number | null; onSave: (title: string, author: string, year: string) => void }) {
  const [t, setT] = useState(title);
  const [a, setA] = useState(author);
  const [y, setY] = useState(year ? String(year) : "");
  return (
    <div className="space-y-3">
      <Field label="Titre"><input value={t} onChange={(e) => setT(e.target.value)} onBlur={() => onSave(t, a, y)} className={inputClass} /></Field>
      <Field label="Auteur"><input value={a} onChange={(e) => setA(e.target.value)} onBlur={() => onSave(t, a, y)} className={inputClass} /></Field>
      <Field label="Année"><input value={y} onChange={(e) => setY(e.target.value.replace(/[^0-9]/g, ""))} onBlur={() => onSave(t, a, y)} className={inputClass} inputMode="numeric" /></Field>
    </div>
  );
}

function EmbedForm({ title, description, onSave }: { title: string; description: string; onSave: (title: string, description: string) => void }) {
  const [t, setT] = useState(title);
  const [d, setD] = useState(description);
  return (
    <div className="space-y-3">
      <Field label="Titre"><input value={t} onChange={(e) => setT(e.target.value)} onBlur={() => onSave(t, d)} className={inputClass} /></Field>
      <Field label="Description"><textarea value={d} onChange={(e) => setD(e.target.value)} onBlur={() => onSave(t, d)} rows={3} className={inputClass} /></Field>
    </div>
  );
}

function MapForm({ locationName, latitude, longitude, onSave }: { locationName: string; latitude: number; longitude: number; onSave: (locationName: string, latitude: number, longitude: number) => void }) {
  const [value, setValue] = useState(locationName);
  const [geo, setGeo] = useState<PlaceGeo | null>({ latitude, longitude, address: locationName });
  return (
    <div className="space-y-3">
      <Field label="Lieu">
        <PlaceAutocomplete value={value} onChange={setValue} onSelectGeo={(g) => { setGeo(g); if (g) onSave(value.trim() || g.address, g.latitude, g.longitude); }} className={inputClass} />
      </Field>
      <button type="button" onClick={() => geo && onSave(value.trim() || geo.address, geo.latitude, geo.longitude)} className="text-xs px-3 py-1.5 rounded-lg bg-[var(--text-primary)] text-[var(--bg-base)] transition-opacity hover:opacity-90">
        Enregistrer le nom
      </button>
    </div>
  );
}

function HighlightForm({ title, rating, note, onSave }: { title: string; rating: number; note: string; onSave: (title: string, rating: number, note: string) => void }) {
  const [t, setT] = useState(title);
  const [r, setR] = useState(rating);
  const [n, setN] = useState(note);
  // La note d'étoiles s'enregistre immédiatement au clic (pas de blur).
  const setRating = (value: number) => { const nr = value === r ? 0 : value; setR(nr); onSave(t, nr, n); };
  return (
    <div className="space-y-3">
      <Field label="Œuvre / titre">
        <input value={t} onChange={(e) => setT(e.target.value)} onBlur={() => onSave(t, r, n)} className={inputClass} placeholder="Titre de l'œuvre" />
      </Field>
      <Field label="Note">
        <div className="flex items-center gap-1">
          {Array.from({ length: 5 }).map((_, i) => (
            <button key={i} type="button" onClick={() => setRating(i + 1)} className="p-0.5" aria-label={`${i + 1} étoile${i > 0 ? "s" : ""}`}>
              <Star size={22} strokeWidth={1.75} className={i < r ? "text-[#f5a623] fill-[#f5a623]" : "text-[var(--border-strong)] hover:text-[var(--text-tertiary)]"} />
            </button>
          ))}
        </div>
      </Field>
      <Field label="Commentaire">
        <textarea value={n} onChange={(e) => setN(e.target.value)} onBlur={() => onSave(t, r, n)} rows={3} className={inputClass} placeholder="Pourquoi ce coup de cœur ?" />
      </Field>
    </div>
  );
}

function ChecklistForm({ title, items, onSave }: { title: string; items: ChecklistItem[]; onSave: (title: string, items: ChecklistItem[]) => void }) {
  const [t, setT] = useState(title);
  const [list, setList] = useState<ChecklistItem[]>(items);

  const commit = (nextT: string, nextList: ChecklistItem[]) => { setList(nextList); onSave(nextT, nextList); };
  const addItem = () => commit(t, [...list, { id: crypto.randomUUID(), text: "", done: false }]);
  const setText = (id: string, text: string) => setList((l) => l.map((it) => (it.id === id ? { ...it, text } : it)));
  const toggle = (id: string) => commit(t, list.map((it) => (it.id === id ? { ...it, done: !it.done } : it)));
  const remove = (id: string) => commit(t, list.filter((it) => it.id !== id));

  return (
    <div className="space-y-3">
      <Field label="Titre">
        <input value={t} onChange={(e) => setT(e.target.value)} onBlur={() => onSave(t, list)} className={inputClass} placeholder="Ex. Œuvres à revoir" />
      </Field>
      <div className="space-y-1.5">
        {list.map((it) => (
          <div key={it.id} className="flex items-center gap-2">
            <button type="button" onClick={() => toggle(it.id)} className="flex-shrink-0" aria-label={it.done ? "Décocher" : "Cocher"}>
              {it.done ? <CheckCircle2 size={18} strokeWidth={2} className="text-[var(--accent)]" /> : <Circle size={18} strokeWidth={2} className="text-[var(--text-tertiary)]" />}
            </button>
            <input
              value={it.text}
              onChange={(e) => setText(it.id, e.target.value)}
              onBlur={() => onSave(t, list)}
              placeholder="Élément…"
              className="flex-1 bg-[var(--bg-base)] border border-[var(--border-subtle)] rounded-lg px-2.5 py-1.5 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--text-tertiary)] placeholder:text-[var(--text-tertiary)]"
            />
            <button type="button" onClick={() => remove(it.id)} className="flex-shrink-0 w-7 h-7 flex items-center justify-center text-[var(--text-tertiary)] hover:text-red-400 transition-colors" aria-label="Supprimer l'élément">
              <X size={14} strokeWidth={2} />
            </button>
          </div>
        ))}
      </div>
      <button type="button" onClick={addItem} className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
        <Plus size={14} strokeWidth={2} /> Ajouter un élément
      </button>
    </div>
  );
}

function TimelineForm({ title, events, onSave }: { title: string; events: TimelineEvent[]; onSave: (title: string, events: TimelineEvent[]) => void }) {
  const [t, setT] = useState(title);
  const [list, setList] = useState<TimelineEvent[]>(events);

  const commit = (nextList: TimelineEvent[]) => { setList(nextList); onSave(t, nextList); };
  const addEvent = () => commit([...list, { id: crypto.randomUUID(), dateText: "", label: "", description: "" }]);
  const patch = (id: string, key: "dateText" | "label" | "description", value: string) =>
    setList((l) => l.map((ev) => (ev.id === id ? { ...ev, [key]: value } : ev)));
  const remove = (id: string) => commit(list.filter((ev) => ev.id !== id));

  return (
    <div className="space-y-3">
      <Field label="Titre">
        <input value={t} onChange={(e) => setT(e.target.value)} onBlur={() => onSave(t, list)} className={inputClass} placeholder="Ex. Périodes de Monet" />
      </Field>
      <div className="space-y-3">
        {list.map((ev) => (
          <div key={ev.id} className="rounded-lg border border-[var(--border-subtle)] p-2.5 space-y-2 relative">
            <button type="button" onClick={() => remove(ev.id)} className="absolute top-1.5 right-1.5 w-6 h-6 flex items-center justify-center text-[var(--text-tertiary)] hover:text-red-400 transition-colors" aria-label="Supprimer le jalon">
              <X size={13} strokeWidth={2} />
            </button>
            <input value={ev.dateText} onChange={(e) => patch(ev.id, "dateText", e.target.value)} onBlur={() => onSave(t, list)} placeholder="Date (ex. 1872)" className="w-full bg-[var(--bg-base)] border border-[var(--border-subtle)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--text-tertiary)] placeholder:text-[var(--text-tertiary)]" />
            <input value={ev.label} onChange={(e) => patch(ev.id, "label", e.target.value)} onBlur={() => onSave(t, list)} placeholder="Titre du jalon" className="w-full bg-[var(--bg-base)] border border-[var(--border-subtle)] rounded-lg px-2.5 py-1.5 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--text-tertiary)] placeholder:text-[var(--text-tertiary)]" />
            <textarea value={ev.description ?? ""} onChange={(e) => patch(ev.id, "description", e.target.value)} onBlur={() => onSave(t, list)} rows={2} placeholder="Description (facultatif)" className={inputClass} />
          </div>
        ))}
      </div>
      <button type="button" onClick={addEvent} className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
        <Plus size={14} strokeWidth={2} /> Ajouter un jalon
      </button>
    </div>
  );
}

function CartelForm({
  content,
  onSave,
  onUploadPhoto,
}: {
  content: Extract<BentoTile["content"], { type: "cartel" }>;
  onSave: (values: CartelFormValues) => void;
  onUploadPhoto: (file: File) => Promise<void>;
}) {
  const [v, setV] = useState<CartelFormValues>({
    artworkTitle: content.artworkTitle ?? "",
    artist: content.artist ?? "",
    dateText: content.dateText ?? "",
    medium: content.medium ?? "",
    dimensions: content.dimensions ?? "",
    room: content.room ?? "",
    notes: content.notes ?? "",
  });
  const [ocrBusy, setOcrBusy] = useState(false);
  const [pct, setPct] = useState(0);
  const [photoBusy, setPhotoBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const set = (k: keyof CartelFormValues, val: string) => setV((p) => ({ ...p, [k]: val }));

  const applyOcr = (f: CartelFields) => {
    setV((prev) => {
      const next: CartelFormValues = {
        ...prev,
        artworkTitle: f.artworkTitle || prev.artworkTitle,
        artist: f.artist || prev.artist,
        dateText: f.dateText || prev.dateText,
        medium: f.medium || prev.medium,
        dimensions: f.dimensions || prev.dimensions,
      };
      onSave(next);
      return next;
    });
  };

  const onScan = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setOcrBusy(true);
    setPct(0);
    try {
      const { fields } = await runCartelOcr(file, setPct);
      applyOcr(fields);
    } catch {
      /* OCR indisponible → saisie manuelle */
    }
    setOcrBusy(false);
    setPhotoBusy(true);
    try { await onUploadPhoto(file); } catch { /* upload échoué */ }
    setPhotoBusy(false);
  };

  return (
    <div className="space-y-3">
      {/* Aperçu photo + scan */}
      <div className="flex items-center gap-3">
        {content.thumbnailKey ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={getThumbnailUrl(content.thumbnailKey)} alt="" className="w-14 h-14 rounded-lg object-cover border border-[var(--border-subtle)] flex-shrink-0" />
        ) : (
          <div className="w-14 h-14 rounded-lg bg-[var(--bg-base)] border border-dashed border-[var(--border-default)] flex items-center justify-center flex-shrink-0">
            <ImagePlus size={18} className="text-[var(--text-tertiary)]" />
          </div>
        )}
        <div className="min-w-0">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={ocrBusy || photoBusy}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-[var(--text-primary)] text-[var(--bg-base)] disabled:opacity-50 transition-opacity"
          >
            {ocrBusy ? <Loader2 size={13} className="animate-spin" /> : <ScanText size={13} strokeWidth={2} />}
            {ocrBusy ? `Lecture… ${pct}%` : photoBusy ? "Envoi…" : "Scanner un cartel"}
          </button>
          <p className="text-[10px] text-[var(--text-tertiary)] mt-1 leading-snug">Photographie le cartel : les champs se pré-remplissent.</p>
        </div>
        <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={onScan} className="hidden" />
      </div>

      <Field label="Titre de l'œuvre"><input value={v.artworkTitle} onChange={(e) => set("artworkTitle", e.target.value)} onBlur={() => onSave(v)} className={inputClass} /></Field>
      <Field label="Artiste"><input value={v.artist} onChange={(e) => set("artist", e.target.value)} onBlur={() => onSave(v)} className={inputClass} /></Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Date"><input value={v.dateText} onChange={(e) => set("dateText", e.target.value)} onBlur={() => onSave(v)} className={inputClass} placeholder="1503-1519" /></Field>
        <Field label="Dimensions"><input value={v.dimensions} onChange={(e) => set("dimensions", e.target.value)} onBlur={() => onSave(v)} className={inputClass} placeholder="77 × 53 cm" /></Field>
      </div>
      <Field label="Technique"><input value={v.medium} onChange={(e) => set("medium", e.target.value)} onBlur={() => onSave(v)} className={inputClass} placeholder="Huile sur toile" /></Field>
      <Field label="Salle / section"><input value={v.room} onChange={(e) => set("room", e.target.value)} onBlur={() => onSave(v)} className={inputClass} /></Field>
      <Field label="Notes"><textarea value={v.notes} onChange={(e) => set("notes", e.target.value)} onBlur={() => onSave(v)} rows={2} className={inputClass} /></Field>
    </div>
  );
}

function TicketForm({
  content,
  onSave,
  onUploadPhoto,
}: {
  content: Extract<BentoTile["content"], { type: "ticket" }>;
  onSave: (values: TicketFormValues) => void;
  onUploadPhoto: (file: File) => Promise<void>;
}) {
  const [v, setV] = useState<TicketFormValues>({
    eventName: content.eventName ?? "",
    place: content.place ?? "",
    dateText: content.dateText ?? "",
    price: content.price ?? "",
    category: content.category ?? "",
  });
  const [photoBusy, setPhotoBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const set = (k: keyof TicketFormValues, val: string) => setV((p) => ({ ...p, [k]: val }));

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setPhotoBusy(true);
    try { await onUploadPhoto(file); } catch { /* upload échoué */ }
    setPhotoBusy(false);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        {content.thumbnailKey ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={getThumbnailUrl(content.thumbnailKey)} alt="" className="w-14 h-14 rounded-lg object-cover border border-[var(--border-subtle)] flex-shrink-0" />
        ) : (
          <div className="w-14 h-14 rounded-lg bg-[var(--bg-base)] border border-dashed border-[var(--border-default)] flex items-center justify-center flex-shrink-0">
            <ImagePlus size={18} className="text-[var(--text-tertiary)]" />
          </div>
        )}
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={photoBusy}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-[var(--bg-surface)] border border-[var(--border-default)] text-[var(--text-primary)] disabled:opacity-50 transition-opacity"
        >
          {photoBusy ? <Loader2 size={13} className="animate-spin" /> : <ImagePlus size={13} strokeWidth={2} />}
          {photoBusy ? "Envoi…" : content.thumbnailKey ? "Remplacer la photo" : "Photo du billet"}
        </button>
        <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={onPick} className="hidden" />
      </div>

      <Field label="Événement / expo"><input value={v.eventName} onChange={(e) => set("eventName", e.target.value)} onBlur={() => onSave(v)} className={inputClass} /></Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Lieu"><input value={v.place} onChange={(e) => set("place", e.target.value)} onBlur={() => onSave(v)} className={inputClass} /></Field>
        <Field label="Date"><input value={v.dateText} onChange={(e) => set("dateText", e.target.value)} onBlur={() => onSave(v)} className={inputClass} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Prix"><input value={v.price} onChange={(e) => set("price", e.target.value)} onBlur={() => onSave(v)} className={inputClass} placeholder="12 €" /></Field>
        <Field label="Tarif"><input value={v.category} onChange={(e) => set("category", e.target.value)} onBlur={() => onSave(v)} className={inputClass} placeholder="Plein tarif" /></Field>
      </div>
    </div>
  );
}

const inputClass =
  "w-full bg-[var(--bg-base)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--text-tertiary)] placeholder:text-[var(--text-tertiary)] resize-none";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] text-[var(--text-tertiary)] uppercase tracking-wide">{label}</span>
      {children}
    </label>
  );
}
