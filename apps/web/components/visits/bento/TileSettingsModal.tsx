"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X, Trash2, Star, Plus, CheckCircle2, Circle, ScanText, ImagePlus, Loader2, Palette, Pencil, Camera } from "lucide-react";
import { NoteEditor } from "@/components/visits/NoteEditor";
import { PlaceAutocomplete, type PlaceGeo } from "@/components/visits/PlaceAutocomplete";
import { FormatPicker } from "@/components/visits/bento/FormatPicker";
import { cn } from "@/lib/utils";
import { isAutoHeight, isFicheContent, isNoteType, type TileWidth } from "@/lib/visits/bentoSpans";
import { getThumbnailUrl } from "@/lib/storage/urls";
import { type CartelFields } from "@/lib/visits/cartelOcr";
import { CartelScanModal } from "@/components/visits/bento/CartelScanModal";
import { extractPalette } from "@/lib/visits/colorExtract";
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
  onSetImageHideTitle: (id: string, hide: boolean) => void;
  onSetFicheFlags: (id: string, patch: { hideImage?: boolean; hideInfo?: boolean; hideParagraph?: boolean }) => void;
  onSaveEmbed: (id: string, title: string, description: string) => void;
  onSaveMap: (id: string, locationName: string, latitude: number, longitude: number) => void;
  onSaveHighlight: (id: string, title: string, rating: number, note: string) => void;
  onSaveChecklist: (id: string, title: string, items: ChecklistItem[]) => void;
  onSaveTimeline: (id: string, title: string, events: TimelineEvent[]) => void;
  onSaveCartel: (id: string, values: CartelFormValues) => void;
  onSaveTicket: (id: string, values: TicketFormValues) => void;
  onUploadTicketPhoto: (id: string, file: File) => Promise<void>;
  onSavePalette: (id: string, title: string, colors: string[]) => void;
  onUploadPaletteSource: (id: string, file: File) => Promise<void>;
  onRedrawSketch: (id: string) => void;
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
  onSetImageHideTitle,
  onSetFicheFlags,
  onSaveEmbed,
  onSaveMap,
  onSaveHighlight,
  onSaveChecklist,
  onSaveTimeline,
  onSaveCartel,
  onSaveTicket,
  onUploadTicketPhoto,
  onSavePalette,
  onUploadPaletteSource,
  onRedrawSketch,
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
              <FormatPicker type={tile.type} w={tile.w} h={tile.h} autoHeight={isAutoHeight(tile.type) || isFicheContent(tile.content)} onChange={(w, h) => onSetFormat(tile, w, h)} />

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
                <ImageForm
                  key={tile.id}
                  title={tile.content.title}
                  author={tile.content.author ?? ""}
                  year={tile.content.year ?? null}
                  hideTitle={!!tile.hideTitle}
                  onSave={(t, a, y) => onSaveImage(tile.id, t, a, y)}
                  onToggleHideTitle={(hide) => onSetImageHideTitle(tile.id, hide)}
                />
              )}
              {tile.content.type === "embed" && tile.content.kind === "LINK" && (
                <EmbedForm key={tile.id} title={tile.content.title ?? ""} description={tile.content.description ?? ""} onSave={(t, d) => onSaveEmbed(tile.id, t, d)} />
              )}
              {tile.content.type === "embed" && tile.content.kind === "ARTIST" && (
                <FicheForm
                  key={tile.id}
                  hasImage={!!tile.content.image}
                  hasInfo={!!tile.content.data}
                  hasParagraph={!!tile.content.description}
                  hideImage={!!tile.hideImage}
                  hideInfo={!!tile.hideInfo}
                  hideParagraph={!!tile.hideParagraph}
                  onChange={(patch) => onSetFicheFlags(tile.id, patch)}
                />
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
              {tile.content.type === "palette" && (
                <PaletteForm
                  key={tile.id}
                  content={tile.content}
                  onSave={(title, colors) => onSavePalette(tile.id, title, colors)}
                  onUploadSource={(file) => onUploadPaletteSource(tile.id, file)}
                />
              )}
              {tile.content.type === "sketch" && (
                <button
                  onClick={() => onRedrawSketch(tile.id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-[var(--bg-surface)] border border-[var(--border-default)] text-[var(--text-primary)] transition-colors hover:border-[var(--border-strong)]"
                >
                  <Pencil size={13} strokeWidth={2} /> Redessiner
                </button>
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

function ImageForm({ title, author, year, hideTitle, onSave, onToggleHideTitle }: {
  title: string; author: string; year: number | null; hideTitle: boolean;
  onSave: (title: string, author: string, year: string) => void;
  onToggleHideTitle: (hide: boolean) => void;
}) {
  const [t, setT] = useState(title);
  const [a, setA] = useState(author);
  const [y, setY] = useState(year ? String(year) : "");
  const [scanFile, setScanFile] = useState<File | null>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) setScanFile(file);
  };

  // OCR d'un cartel → métadonnées de l'image. Le scan ÉCRASE les infos
  // existantes (retour utilisateur 2026-07-19) : une valeur trouvée par l'OCR
  // remplace le champ ; un champ non trouvé garde sa valeur (pas de blanc).
  const applyOcr = (f: CartelFields) => {
    const yr = f.dateText?.match(/(1[0-9]{3}|20[0-9]{2})/)?.[1] ?? "";
    const nt = f.artworkTitle || t;
    const na = f.artist || a;
    const ny = yr || y;
    setT(nt); setA(na); setY(ny);
    onSave(nt, na, ny);
  };

  return (
    <div className="space-y-3">
      {/* Scan d'un cartel pour pré-remplir (même OCR que le module Cartel). */}
      <div>
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={() => galleryRef.current?.click()} className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg bg-[var(--bg-surface)] border border-[var(--border-default)] text-[var(--text-primary)] transition-colors">
            <ImagePlus size={13} strokeWidth={2} /> Galerie
          </button>
          <button type="button" onClick={() => cameraRef.current?.click()} className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg bg-[var(--text-primary)] text-[var(--bg-base)] transition-opacity">
            <ScanText size={13} strokeWidth={2} /> Scanner le cartel
          </button>
        </div>
        <p className="text-[10px] text-[var(--text-tertiary)] mt-1 leading-snug">Prends le cartel en photo pour pré-remplir titre / auteur / année.</p>
        <input ref={galleryRef} type="file" accept="image/*" onChange={onPick} className="hidden" />
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" onChange={onPick} className="hidden" />
      </div>
      {scanFile && (
        <CartelScanModal file={scanFile} onCancel={() => setScanFile(null)} onResult={(fields) => { setScanFile(null); applyOcr(fields); }} />
      )}

      <Field label="Titre"><input value={t} onChange={(e) => setT(e.target.value)} onBlur={() => onSave(t, a, y)} className={inputClass} /></Field>
      <Field label="Auteur"><input value={a} onChange={(e) => setA(e.target.value)} onBlur={() => onSave(t, a, y)} className={inputClass} /></Field>
      <Field label="Année"><input value={y} onChange={(e) => setY(e.target.value.replace(/[^0-9]/g, ""))} onBlur={() => onSave(t, a, y)} className={inputClass} inputMode="numeric" /></Field>

      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-[var(--text-secondary)]">Afficher le cartel sur l&apos;image</span>
        <Toggle on={!hideTitle} onChange={(v) => onToggleHideTitle(!v)} label="Afficher le cartel" />
      </div>
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

// Fiche wiki : uniquement des toggles d'affichage (le contenu vient de
// Wikipédia). On masque une ligne quand la donnée correspondante n'existe pas.
function FicheForm({
  hasImage, hasInfo, hasParagraph, hideImage, hideInfo, hideParagraph, onChange,
}: {
  hasImage: boolean; hasInfo: boolean; hasParagraph: boolean;
  hideImage: boolean; hideInfo: boolean; hideParagraph: boolean;
  onChange: (patch: { hideImage?: boolean; hideInfo?: boolean; hideParagraph?: boolean }) => void;
}) {
  return (
    <div className="space-y-3">
      <p className="text-[11px] text-[var(--text-tertiary)] uppercase tracking-wide">Affichage</p>
      {hasImage && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-[var(--text-secondary)]">Portrait</span>
          <Toggle on={!hideImage} onChange={(v) => onChange({ hideImage: !v })} label="Afficher le portrait" />
        </div>
      )}
      {hasInfo && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-[var(--text-secondary)]">Informations</span>
          <Toggle on={!hideInfo} onChange={(v) => onChange({ hideInfo: !v })} label="Afficher les informations" />
        </div>
      )}
      {hasParagraph && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-[var(--text-secondary)]">Résumé de l&apos;article</span>
          <Toggle on={!hideParagraph} onChange={(v) => onChange({ hideParagraph: !v })} label="Afficher le résumé" />
        </div>
      )}
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
}: {
  content: Extract<BentoTile["content"], { type: "cartel" }>;
  onSave: (values: CartelFormValues) => void;
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
  const [scanFile, setScanFile] = useState<File | null>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const set = (k: keyof CartelFormValues, val: string) => setV((p) => ({ ...p, [k]: val }));

  // Résultat de l'OCR (après recadrage) → on ne remplit QUE les champs vides,
  // pour ne pas écraser une correction manuelle. La photo n'est pas conservée.
  const applyOcr = (f: CartelFields) => {
    setV((prev) => {
      const next: CartelFormValues = {
        artworkTitle: prev.artworkTitle || f.artworkTitle || "",
        artist: prev.artist || f.artist || "",
        dateText: prev.dateText || f.dateText || "",
        medium: prev.medium || f.medium || "",
        dimensions: prev.dimensions || f.dimensions || "",
        room: prev.room,
        notes: prev.notes || f.notes || "",
      };
      onSave(next);
      return next;
    });
  };

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) setScanFile(file);
  };

  return (
    <div className="space-y-3">
      {/* Scan du cartel : galerie (sans capture) ou photo (capture) →
          recadrage → OCR → pré-remplissage. L'image n'est PAS stockée. */}
      <div>
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={() => galleryRef.current?.click()} className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg bg-[var(--bg-surface)] border border-[var(--border-default)] text-[var(--text-primary)] transition-colors">
            <ImagePlus size={13} strokeWidth={2} /> Galerie
          </button>
          <button type="button" onClick={() => cameraRef.current?.click()} className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg bg-[var(--text-primary)] text-[var(--bg-base)] transition-opacity">
            <ScanText size={13} strokeWidth={2} /> Scanner un cartel
          </button>
        </div>
        <p className="text-[10px] text-[var(--text-tertiary)] mt-1 leading-snug">Recadre la zone du cartel, l&apos;OCR pré-remplit les champs (image non conservée).</p>
        <input ref={galleryRef} type="file" accept="image/*" onChange={onPick} className="hidden" />
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" onChange={onPick} className="hidden" />
      </div>

      {scanFile && (
        <CartelScanModal
          file={scanFile}
          onCancel={() => setScanFile(null)}
          onResult={(fields) => { setScanFile(null); applyOcr(fields); }}
        />
      )}

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
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
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
        {/* Deux options : choisir dans la galerie (input sans `capture`) ou
            prendre une photo (input `capture="environment"`). */}
        <div className="flex flex-col gap-1.5 min-w-0">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => galleryRef.current?.click()}
              disabled={photoBusy}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg bg-[var(--bg-surface)] border border-[var(--border-default)] text-[var(--text-primary)] disabled:opacity-50 transition-opacity"
            >
              {photoBusy ? <Loader2 size={13} className="animate-spin" /> : <ImagePlus size={13} strokeWidth={2} />} Galerie
            </button>
            <button
              type="button"
              onClick={() => cameraRef.current?.click()}
              disabled={photoBusy}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg bg-[var(--bg-surface)] border border-[var(--border-default)] text-[var(--text-primary)] disabled:opacity-50 transition-opacity"
            >
              <Camera size={13} strokeWidth={2} /> Photo
            </button>
          </div>
          {content.thumbnailKey && <span className="text-[10px] text-[var(--text-tertiary)]">Remplacer la photo du billet</span>}
        </div>
        <input ref={galleryRef} type="file" accept="image/*" onChange={onPick} className="hidden" />
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" onChange={onPick} className="hidden" />
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

function PaletteForm({
  content,
  onSave,
  onUploadSource,
}: {
  content: Extract<BentoTile["content"], { type: "palette" }>;
  onSave: (title: string, colors: string[]) => void;
  onUploadSource: (file: File) => Promise<void>;
}) {
  const [title, setTitle] = useState(content.title ?? "");
  const [colors, setColors] = useState<string[]>(content.colors);
  const [busy, setBusy] = useState(false);
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  const onExtract = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    try {
      const extracted = await extractPalette(file, 6);
      if (extracted.length) {
        setColors(extracted);
        onSave(title, extracted);
      }
      await onUploadSource(file);
    } catch {
      /* extraction/upload échoué → l'utilisateur peut réessayer */
    }
    setBusy(false);
  };

  const removeAt = (i: number) => {
    const next = colors.filter((_, idx) => idx !== i);
    setColors(next);
    onSave(title, next);
  };
  const addColor = () => {
    const next = [...colors, "#888888"];
    setColors(next);
    onSave(title, next);
  };
  const setColorAt = (i: number, hex: string) => setColors((c) => c.map((x, idx) => (idx === i ? hex : x)));

  return (
    <div className="space-y-3">
      <Field label="Titre"><input value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => onSave(title, colors)} className={inputClass} placeholder="Ex. Nymphéas" /></Field>

      {/* Deux sources : galerie (input sans capture) ou photo (capture). */}
      <div className="flex items-center gap-1.5">
        <button type="button" onClick={() => galleryRef.current?.click()} disabled={busy} className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg bg-[var(--bg-surface)] border border-[var(--border-default)] text-[var(--text-primary)] disabled:opacity-50 transition-opacity">
          {busy ? <Loader2 size={13} className="animate-spin" /> : <ImagePlus size={13} strokeWidth={2} />} Galerie
        </button>
        <button type="button" onClick={() => cameraRef.current?.click()} disabled={busy} className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg bg-[var(--text-primary)] text-[var(--bg-base)] disabled:opacity-50 transition-opacity">
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Palette size={13} strokeWidth={2} />}
          {busy ? "Extraction…" : "Photo"}
        </button>
      </div>
      <input ref={galleryRef} type="file" accept="image/*" onChange={onExtract} className="hidden" />
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" onChange={onExtract} className="hidden" />

      {colors.length > 0 && (
        <div className="space-y-1.5">
          {colors.map((c, i) => (
            <div key={i} className="flex items-center gap-2">
              <input type="color" value={c} onChange={(e) => setColorAt(i, e.target.value)} onBlur={() => onSave(title, colors)} className="w-8 h-8 rounded border border-[var(--border-subtle)] bg-transparent cursor-pointer flex-shrink-0 p-0" />
              <span className="text-xs font-mono text-[var(--text-secondary)] uppercase flex-1">{c}</span>
              <button type="button" onClick={() => removeAt(i)} className="w-7 h-7 flex items-center justify-center text-[var(--text-tertiary)] hover:text-red-400 transition-colors" aria-label="Retirer la couleur">
                <X size={13} strokeWidth={2} />
              </button>
            </div>
          ))}
        </div>
      )}
      <button type="button" onClick={addColor} className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
        <Plus size={14} strokeWidth={2} /> Ajouter une couleur
      </button>
    </div>
  );
}

const inputClass =
  "w-full bg-[var(--bg-base)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--text-tertiary)] placeholder:text-[var(--text-tertiary)] resize-none";

// Interrupteur façon iOS : piste arrondie + pastille qui coulisse, verte à ON.
function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={cn(
        "relative w-[46px] h-[28px] rounded-full transition-colors duration-200 flex-shrink-0 outline-none",
        on ? "bg-[#34c759]" : "bg-[var(--border-strong)]"
      )}
    >
      <span
        className={cn(
          "absolute top-[2px] left-[2px] w-[24px] h-[24px] rounded-full bg-white shadow-md transition-transform duration-200",
          on && "translate-x-[18px]"
        )}
      />
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] text-[var(--text-tertiary)] uppercase tracking-wide">{label}</span>
      {children}
    </label>
  );
}
