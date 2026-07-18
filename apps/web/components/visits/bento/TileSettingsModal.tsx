"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X, Trash2, Star, Plus, CheckCircle2, Circle } from "lucide-react";
import { NoteEditor } from "@/components/visits/NoteEditor";
import { PlaceAutocomplete, type PlaceGeo } from "@/components/visits/PlaceAutocomplete";
import { FormatPicker } from "@/components/visits/bento/FormatPicker";
import { isNoteType, type TileWidth } from "@/lib/visits/bentoSpans";
import type { BentoTile, ChecklistItem } from "@/lib/visits/bentoTypes";

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
